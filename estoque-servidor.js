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

/**
 * Compactador incremental: recebe item a item (sem guardar a lista inteira)
 * e mantém só os campos usados, com textos repetidos em dicionário.
 */
function criarCompactador() {
  let k = null, campos = [], recebidos = 0;
  const dic = { produto: [], fornecedor: [], tipo: [], grife: [] };
  const idx = { produto: new Map(), fornecedor: new Map(), tipo: new Map(), grife: new Map() };
  const indice = (nome, valor) => {
    const s = String(valor ?? '').trim();
    let i = idx[nome].get(s);
    if (i === undefined) { i = dic[nome].length; dic[nome].push(s); idx[nome].set(s, i); }
    return i;
  };
  const linhas = [];
  function adicionar(it) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return;
    recebidos++;
    if (!k) {
      campos = Object.keys(it);
      const campo = pegador(it);
      k = {
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
    }
    const estoque = numero(k.estoque && it[k.estoque]);
    if (!estoque) return;
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
  return { adicionar, resultado: () => ({ linhas, dic, campos, camposUsados: k || {}, recebidos }) };
}

/** Converte uma lista já carregada (usado nos testes). */
function compactar(lista) {
  const c = criarCompactador();
  lista.forEach(c.adicionar);
  return c.resultado();
}

/**
 * Leitor de JSON em pedaços: entrega cada objeto que está dentro de uma lista
 * (ex.: [ {...}, {...} ] ou {"Dados": [ {...} ]}) assim que ele termina de chegar,
 * sem montar o texto inteiro na memória.
 */
function criarLeitorObjetos(aoObjeto) {
  const pilha = [];          // '[' ou '{' abertos fora do objeto sendo capturado
  let dentroTexto = false, escape = false;
  let capturando = false, prof = 0, buf = '';
  return function ler(pedaco) {
    let ini = capturando ? 0 : -1;
    for (let i = 0; i < pedaco.length; i++) {
      const ch = pedaco[i];
      if (dentroTexto) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') dentroTexto = false;
        continue;
      }
      if (ch === '"') { dentroTexto = true; continue; }
      if (capturando) {
        if (ch === '{' || ch === '[') prof++;
        else if (ch === '}' || ch === ']') {
          prof--;
          if (prof === 0) {
            buf += pedaco.slice(ini, i + 1);
            capturando = false; ini = -1;
            const texto = buf; buf = '';
            aoObjeto(JSON.parse(texto));
          }
        }
        continue;
      }
      if (ch === '{' && pilha[pilha.length - 1] === '[') { capturando = true; prof = 1; ini = i; buf = ''; continue; }
      if (ch === '{' || ch === '[') pilha.push(ch);
      else if (ch === '}' || ch === ']') pilha.pop();
    }
    if (capturando && ini >= 0) buf += pedaco.slice(ini);
  };
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
 * POST com o módulo https do Node: sem o limite de 5 min do fetch, pedindo a
 * resposta compactada (gzip) e lendo item a item (pouca memória).
 */
function postarELerObjetos(url, corpo, headers, limiteMs, aoObjeto) {
  return new Promise((ok, falha) => {
    const dados = Buffer.from(JSON.stringify(corpo));
    let bytes = 0;
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Length': dados.length, ...headers }
    }, resp => {
      let fluxo = resp;
      const enc = String(resp.headers['content-encoding'] || '').toLowerCase();
      if (enc.includes('gzip')) fluxo = resp.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) fluxo = resp.pipe(zlib.createInflate());
      else if (enc.includes('br')) fluxo = resp.pipe(zlib.createBrotliDecompress());
      fluxo.setEncoding('utf8');
      const erroHttp = resp.statusCode < 200 || resp.statusCode >= 300;
      let inicioTexto = '';
      const ler = criarLeitorObjetos(aoObjeto);
      fluxo.on('data', pedaco => {
        bytes += pedaco.length;
        if (inicioTexto.length < 300) inicioTexto += pedaco.slice(0, 300);
        if (erroHttp) return;
        try { ler(pedaco); } catch (e) { req.destroy(new Error(`Resposta da SavWin com JSON inválido: ${e.message}`)); }
      });
      fluxo.on('error', falha);
      fluxo.on('end', () => {
        if (erroHttp) return falha(Object.assign(new Error(`SavWin respondeu ${resp.statusCode}: ${inicioTexto.slice(0, 200)}`), { http: true }));
        ok({ bytes, inicioTexto });
      });
    });
    req.setTimeout(limiteMs, () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'TEMPO' })));
    req.on('error', falha);
    req.end(dados);
  });
}

async function buscarNaSavwin(headers) {
  const inicio = Date.now();
  const comp = criarCompactador();
  let info;
  try {
    info = await postarELerObjetos(URL_ESTOQUE, { MOSTRAESTOQUEZERO: 'N' }, headers, LIMITE_SAVWIN_MS, comp.adicionar);
  } catch (err) {
    const seg = Math.round((Date.now() - inicio) / 1000);
    throw new Error(err.http ? `${err.message} (após ${seg} s)` : explicarErroRede(err, seg));
  }
  const r = comp.resultado();
  console.log(`Estoque SavWin: ${r.recebidos} itens recebidos (${Math.round(info.bytes / 1048576)} MB), ${r.linhas.length} com estoque, ` +
    `${Math.round((Date.now() - inicio) / 1000)} s, memória ${Math.round(process.memoryUsage().rss / 1048576)} MB`);
  if (!r.recebidos) throw new Error(`A SavWin respondeu, mas sem lista de itens. Início da resposta: ${info.inicioTexto.slice(0, 150)}`);
  return { quando: Date.now(), ...r };
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

/** Envia o JSON em gzip quando o navegador aceita (o estoque pode ter vários MB). */
function enviarCompactado(req, res, obj) {
  const texto = JSON.stringify(obj);
  if (/\bgzip\b/.test(String(req.headers && req.headers['accept-encoding'] || ''))) {
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
    return res.end(zlib.gzipSync(texto));
  }
  res.type('application/json').send(texto);
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
      enviarCompactado(req, res, {
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

module.exports = { registrarRotaEstoque, compactar, criarLeitorObjetos, criarCompactador, dataISO, numero, codigoLoja, listaDaResposta };
