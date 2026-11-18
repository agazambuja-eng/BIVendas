/**
 * Estoque encalhado · rota /consultaestoque
 *
 * Fonte: SavWin  POST api/Relatorios/EstoqueAnaliticoGrid  {"MOSTRAESTOQUEZERO":"N"}
 * A API devolve o estoque de TODAS as lojas (não recebe filtro de loja), então:
 *  - guardamos o resultado em cache por alguns minutos (a consulta é pesada);
 *  - cada usuário recebe só as lojas que pode ver (middleware restringirLojas);
 *  - a resposta vai "compacta" (dicionários + linhas em lista) para pesar menos.
 */

const URL_ESTOQUE = process.env.SAVWIN_ESTOQUE_URL ||
  'https://api.savwinweb.com.br/api/Relatorios/EstoqueAnaliticoGrid';
const VALIDADE_CACHE_MS = 30 * 60 * 1000;      // 30 min
const INTERVALO_MIN_ATUALIZAR_MS = 2 * 60 * 1000; // "atualizar agora" no máximo a cada 2 min

let cache = null;          // { quando, linhas, dic, campos }
let buscando = null;       // promessa em andamento (evita duas chamadas iguais à SavWin)

// ------------------------------------------------------------ conversões
function numero(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

/** Devolve 'AAAA-MM-DD' ou '' (datas vazias ou "1900" viram ''). */
function dataISO(v) {
  if (!v) return '';
  const s = String(v).trim();
  let a, m, d;
  let r = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (r) { [, a, m, d] = r; }
  else if ((r = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { [, d, m, a] = r; }
  else return '';
  if (Number(a) < 1950) return '';
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "521 - OTICA X" -> "521"; sem número, devolve o texto. */
function codigoLoja(v) {
  const s = String(v ?? '').trim();
  const r = s.match(/^0*(\d+)/);
  return r ? r[1] : s;
}

/** Acha o valor de um campo sem depender de maiúsculas/minúsculas. */
function pegador(amostra) {
  const mapa = {};
  Object.keys(amostra || {}).forEach(k => { mapa[k.toUpperCase().replace(/[^A-Z0-9]/g, '')] = k; });
  return (...nomes) => {
    for (const n of nomes) {
      const k = mapa[n.toUpperCase().replace(/[^A-Z0-9]/g, '')];
      if (k) return k;
    }
    return null;
  };
}

function listaDaResposta(dados) {
  if (Array.isArray(dados)) return dados;
  if (dados && typeof dados === 'object') {
    for (const k of ['dados', 'Dados', 'data', 'Data', 'result', 'Result', 'resultado', 'Resultado', 'itens', 'Itens', 'lista', 'Lista']) {
      if (Array.isArray(dados[k])) return dados[k];
    }
    const arr = Object.values(dados).find(Array.isArray);
    if (arr) return arr;
  }
  return [];
}

/** Converte a lista da SavWin no formato compacto. */
function compactar(lista) {
  const amostra = lista.find(x => x && typeof x === 'object') || {};
  const campo = pegador(amostra);
  const k = {
    loja: campo('LOJA', 'CODIGOLOJA', 'LOJANOME'),
    matid: campo('MATID'),
    seq: campo('SEQUENCIAL'),
    produto: campo('PRODUTO', 'DESCRICAO'),
    fornecedor: campo('FORNECEDORFABRICANTE', 'FORNECEDOR', 'FABRICANTE'),
    tipo: campo('TIPODEPRODUTO', 'TIPOPRODUTO', 'TIPO'),
    grife: campo('GRIFE', 'MARCA'),
    estoque: campo('ESTOQUE', 'QUANTIDADE', 'SALDO'),
    custo: campo('PRECO_CUSTO', 'PRECOCUSTO', 'CUSTO'),
    valorizacao: campo('VALORIZACAOCUSTO'),
    ultVenda: campo('DATAULTIMAVENDA'),
    ultCompra: campo('DATAULTIMACOMPRA')
  };

  const dic = { produto: [], fornecedor: [], tipo: [], grife: [] };
  const idx = { produto: new Map(), fornecedor: new Map(), tipo: new Map(), grife: new Map() };
  const indice = (nome, valor) => {
    const s = String(valor ?? '').trim();
    let i = idx[nome].get(s);
    if (i === undefined) { i = dic[nome].length; dic[nome].push(s); idx[nome].set(s, i); }
    return i;
  };

  const linhas = [];
  for (const it of lista) {
    if (!it || typeof it !== 'object') continue;
    const estoque = numero(k.estoque && it[k.estoque]);
    if (!estoque) continue;
    const custoUnit = numero(k.custo && it[k.custo]);
    const valor = k.valorizacao ? numero(it[k.valorizacao]) : estoque * custoUnit;
    linhas.push([
      codigoLoja(k.loja && it[k.loja]),
      String((k.matid && it[k.matid]) ?? '').trim(),
      String((k.seq && it[k.seq]) ?? '').trim(),
      indice('produto', k.produto && it[k.produto]),
      indice('fornecedor', k.fornecedor && it[k.fornecedor]),
      indice('tipo', k.tipo && it[k.tipo]),
      Math.round(estoque * 1000) / 1000,
      Math.round(custoUnit * 100) / 100,
      Math.round(valor * 100) / 100,
      dataISO(k.ultVenda && it[k.ultVenda]),
      dataISO(k.ultCompra && it[k.ultCompra]),
      indice('grife', k.grife && it[k.grife])
    ]);
  }
  return { linhas, dic, campos: Object.keys(amostra), camposUsados: k };
}

async function buscarNaSavwin(headers) {
  const resp = await fetch(URL_ESTOQUE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ MOSTRAESTOQUEZERO: 'N' })
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Erro na API externa (Estoque): Status ${resp.status} ${txt.slice(0, 200)}`);
  }
  const lista = listaDaResposta(await resp.json());
  return { quando: Date.now(), ...compactar(lista) };
}

async function estoqueEmCache(headers, forcar) {
  const idade = cache ? Date.now() - cache.quando : Infinity;
  const vencido = idade > VALIDADE_CACHE_MS;
  const podeForcar = forcar && idade > INTERVALO_MIN_ATUALIZAR_MS;
  if (cache && !vencido && !podeForcar) return cache;
  if (!buscando) {
    buscando = buscarNaSavwin(headers)
      .then(r => { cache = r; return r; })
      .finally(() => { buscando = null; });
  }
  return buscando;
}

function registrarRotaEstoque(app, { exigirUsuario, restringirLojas, headersSavwin }) {
  app.post('/consultaestoque', exigirUsuario('acessar_bi'), restringirLojas, async (req, res) => {
    try {
      const base = await estoqueEmCache(headersSavwin, req.body && req.body.ATUALIZAR === true);
      const pedidas = String((req.body && req.body.LOJAS) || '')
        .split(/[,;\s]+/).map(codigoLoja).filter(Boolean);
      const perfil = req.usuario || {};
      // Usuário sem "todas as lojas" sempre chega aqui com LOJAS preenchido (restringirLojas).
      if (!pedidas.length && perfil.todas_lojas !== true) {
        return res.status(403).json({ error: 'Nenhuma loja liberada para o seu usuário.' });
      }
      const filtro = pedidas.length ? new Set(pedidas) : null;
      const linhas = filtro ? base.linhas.filter(l => filtro.has(l[0])) : base.linhas;
      res.json({
        quando: new Date(base.quando).toISOString(),
        colunas: ['loja', 'matid', 'seq', 'produto', 'fornecedor', 'tipo', 'estoque', 'custoUnit', 'custoTotal', 'ultVenda', 'ultCompra', 'grife'],
        dic: base.dic,
        linhas,
        camposApi: base.campos
      });
    } catch (err) {
      console.error('Erro no servidor (/consultaestoque):', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registrarRotaEstoque, compactar, dataISO, numero, codigoLoja, listaDaResposta };
