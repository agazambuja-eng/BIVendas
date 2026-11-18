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
const https = require('https');
const zlib = require('zlib');

const VALIDADE_CACHE_MS = 30 * 60 * 1000;      // 30 min
const LIMITE_SAVWIN_MS = 15 * 60 * 1000;       // espera a SavWin até 15 min
const INTERVALO_MIN_ATUALIZAR_MS = 2 * 60 * 1000; // "atualizar agora" no máximo a cada 2 min

let cache = null;          // { quando, linhas, dic, campos }
let buscando = null;       // { inicio, promessa } busca em andamento (só uma por vez)
let ultimoErro = null;     // { mensagem, quando } entregue ao próximo pedido

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
      // PRODUTO vem como "sequencial - fantasia": fica só a fantasia
      indice('produto', String((k.produto && it[k.produto]) ?? '').replace(/^\s*\d+\s*[-–:]?\s+/, '')),
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

/** Explica em português o erro de rede da SavWin. */
function explicarErroRede(err, segundos) {
  const cod = err.code || (err.cause && err.cause.code) || '';
  const tempo = ` (após ${segundos} s)`;
  if (cod === 'ENOTFOUND' || cod === 'EAI_AGAIN') return `Endereço da SavWin não encontrado (${URL_ESTOQUE})${tempo}.`;
  if (cod === 'ECONNREFUSED') return `A SavWin recusou a conexão${tempo}.`;
  if (cod === 'ECONNRESET' || cod === 'EPIPE' || cod === 'UND_ERR_SOCKET') return `A SavWin encerrou a conexão antes de terminar de responder${tempo}. Pode ser limite de tempo do lado deles.`;
  if (cod === 'ETIMEDOUT' || cod === 'TEMPO') return `A SavWin não respondeu a tempo${tempo}.`;
  return `Falha ao falar com a SavWin: ${err.message || err}${cod ? ' [' + cod + ']' : ''}${tempo}.`;
}

/**
 * POST com o módulo https do Node: sem o limite de 5 min do fetch,
 * pedindo a resposta compactada (gzip), que é bem menor.
 */
function postarJSON(url, corpo, headers, limiteMs) {
  return new Promise((ok, falha) => {
    const dados = Buffer.from(JSON.stringify(corpo));
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Length': dados.length, ...headers }
    }, resp => {
      let fluxo = resp;
      const enc = String(resp.headers['content-encoding'] || '').toLowerCase();
      if (enc.includes('gzip')) fluxo = resp.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) fluxo = resp.pipe(zlib.createInflate());
      else if (enc.includes('br')) fluxo = resp.pipe(zlib.createBrotliDecompress());
      const partes = [];
      fluxo.on('data', c => partes.push(c));
      fluxo.on('error', falha);
      fluxo.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
          return falha(Object.assign(new Error(`SavWin respondeu ${resp.statusCode}: ${texto.slice(0, 200)}`), { http: true }));
        }
        try { ok(JSON.parse(texto)); } catch (e) { falha(new Error(`Resposta da SavWin não é JSON válido (${texto.length} bytes): ${texto.slice(0, 120)}`)); }
      });
    });
    req.setTimeout(limiteMs, () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'TEMPO' })));
    req.on('error', falha);
    req.end(dados);
  });
}

async function buscarNaSavwin(headers) {
  const inicio = Date.now();
  let resposta;
  try {
    resposta = await postarJSON(URL_ESTOQUE, { MOSTRAESTOQUEZERO: 'N' }, headers, LIMITE_SAVWIN_MS);
  } catch (err) {
    const seg = Math.round((Date.now() - inicio) / 1000);
    throw new Error(err.http ? `${err.message} (após ${seg} s)` : explicarErroRede(err, seg));
  }
  const lista = listaDaResposta(resposta);
  resposta = null;
  const base = { quando: Date.now(), ...compactar(lista) };
  console.log(`Estoque SavWin: ${lista.length} itens recebidos, ${base.linhas.length} com estoque, ` +
    `${Math.round((Date.now() - inicio) / 1000)} s, memória ${Math.round(process.memoryUsage().rss / 1048576)} MB`);
  return base;
}

/**
 * Situação do estoque sem prender a requisição: devolve o cache pronto,
 * ou inicia/acompanha a busca em segundo plano (o navegador pergunta de novo).
 */
function situacaoEstoque(headers, forcar) {
  const idade = cache ? Date.now() - cache.quando : Infinity;
  const vencido = idade > VALIDADE_CACHE_MS;
  const podeForcar = forcar && idade > INTERVALO_MIN_ATUALIZAR_MS;
  if (cache && !vencido && !podeForcar) return { pronto: cache };
  if (buscando) return { carregando: Math.round((Date.now() - buscando.inicio) / 1000) };
  if (ultimoErro && Date.now() - ultimoErro.quando < 2 * 60 * 1000) {
    const e = ultimoErro; ultimoErro = null;          // entrega o erro uma vez; o próximo clique tenta de novo
    return { erro: e.mensagem };
  }
  ultimoErro = null;
  const inicio = Date.now();
  buscando = {
    inicio,
    promessa: buscarNaSavwin(headers)
      .then(r => { cache = r; })
      .catch(err => {
        console.error('Erro ao buscar estoque na SavWin:', err.message);
        ultimoErro = { mensagem: err.message, quando: Date.now() };
      })
      .finally(() => { buscando = null; })
  };
  return { carregando: 0 };
}

function registrarRotaEstoque(app, { exigirUsuario, restringirLojas, headersSavwin }) {
  app.post('/consultaestoque', exigirUsuario('acessar_bi'), restringirLojas, async (req, res) => {
    try {
      const pedidas = String((req.body && req.body.LOJAS) || '')
        .split(/[,;\s]+/).map(codigoLoja).filter(Boolean);
      const perfil = req.usuario || {};
      // Usuário sem "todas as lojas" sempre chega aqui com LOJAS preenchido (restringirLojas).
      if (!pedidas.length && perfil.todas_lojas !== true) {
        return res.status(403).json({ error: 'Nenhuma loja liberada para o seu usuário.' });
      }
      const sit = situacaoEstoque(headersSavwin, req.body && req.body.ATUALIZAR === true);
      if (sit.erro) return res.status(502).json({ error: sit.erro });
      if (!sit.pronto) return res.status(202).json({ carregando: true, segundos: sit.carregando });
      const base = sit.pronto;
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
