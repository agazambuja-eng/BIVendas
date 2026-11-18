/**
 * Estoque encalhado pelo painel do SavWin (Dashboard Gestor · Estoque).
 *
 * A API externa (EstoqueAnaliticoGrid) leva ~10 min; o painel interno do
 * SavWin responde em ~40 s, já resumido. Ele exige uma sessão do sistema:
 *  - um gestor do BI informa identificador, login e senha no card;
 *  - o servidor faz o login no SavWin e guarda SÓ a chave de sessão, em memória
 *    (a senha não é gravada nem registrada em log);
 *  - quando a chave vence (< 1 dia) ou o servidor reinicia, é preciso conectar de novo.
 * Cada usuário do BI recebe o painel apenas das lojas liberadas para ele.
 *
 * API interna, não oficial: pode mudar sem aviso.
 */
const https = require('https');
const zlib = require('zlib');

const BASE = process.env.SAVWIN_GATEWAY_URL || 'https://apigat.savwinweb.com.br';
const URL_APP = 'https://appsav.savwinweb.com.br';
const TELA = '/tela/FRMDASHBOARDGESTOR';
const VALIDADE_PAINEL_MS = 30 * 60 * 1000;
const LIMITE_MS = 5 * 60 * 1000;

let sessao = null;               // { chave, identificador, usuarioSavwin, loja, conectadoEm, conectadoPor }
let lojasSavwin = null;          // { quando, porCodigo: Map(codigo -> {id, nome}) }
const paineis = new Map();       // chaveCache -> { quando, dados }
const buscas = new Map();        // chaveCache -> { inicio }
const errosBusca = new Map();    // chaveCache -> { mensagem, quando }

// ------------------------------------------------------------------ http
function postar(caminho, corpo, { chave, identificador } = {}) {
  return new Promise((ok, falha) => {
    const dados = Buffer.from(JSON.stringify(corpo || {}));
    const headers = {
      'Content-Type': 'application/json', Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate', 'Content-Length': dados.length,
      Origin: URL_APP, Referer: URL_APP + TELA
    };
    if (chave) {
      headers.Chave = chave;
      headers.ChaveValidacao = String(identificador || '').toUpperCase();
      headers['X-Tela'] = TELA;
    }
    const req = https.request(BASE.replace(/\/+$/, '') + '/' + caminho.replace(/^\/+/, ''), { method: 'POST', headers }, resp => {
      let fluxo = resp;
      const enc = String(resp.headers['content-encoding'] || '').toLowerCase();
      if (enc.includes('gzip')) fluxo = resp.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) fluxo = resp.pipe(zlib.createInflate());
      else if (enc.includes('br')) fluxo = resp.pipe(zlib.createBrotliDecompress());
      const partes = [];
      fluxo.on('data', c => partes.push(c));
      fluxo.on('error', falha);
      fluxo.on('end', () => ok({ status: resp.statusCode, headers: resp.headers, texto: Buffer.concat(partes).toString('utf8') }));
    });
    req.setTimeout(LIMITE_MS, () => req.destroy(Object.assign(new Error('A SavWin não respondeu a tempo.'), { code: 'TEMPO' })));
    req.on('error', err => falha(new Error(err.code === 'TEMPO' ? err.message : `Falha ao falar com a SavWin: ${err.message}`)));
    req.end(dados);
  });
}

/** Texto simples das respostas de login ("OK", "NOTOK"...), sem aspas. */
function textoSimples(t) {
  let s = String(t ?? '').trim();
  try { const j = JSON.parse(s); if (typeof j === 'string') s = j.trim(); } catch { /* já é texto */ }
  return s;
}

class SessaoExpirada extends Error {}

async function postarComSessao(caminho, corpo) {
  if (!sessao) throw new SessaoExpirada('O BI não está conectado ao SavWin.');
  const r = await postar(caminho, corpo, sessao);
  if (r.status === 401 || r.status === 403) {
    sessao = null; lojasSavwin = null;
    throw new SessaoExpirada('A sessão do SavWin expirou. Conecte de novo.');
  }
  if (r.status < 200 || r.status >= 300) throw new Error(`SavWin respondeu ${r.status}: ${r.texto.slice(0, 200)}`);
  let j;
  try { j = JSON.parse(r.texto); } catch { throw new Error(`Resposta inesperada da SavWin: ${r.texto.slice(0, 150)}`); }
  if (j && j.Liberado === false && /sess[aã]o|login|chave/i.test(String(j.Mensagem || ''))) {
    sessao = null; lojasSavwin = null;
    throw new SessaoExpirada(`SavWin: ${j.Mensagem}. Conecte de novo.`);
  }
  return j;
}

// ------------------------------------------------------------------ login
async function conectar({ identificador, login, senha }) {
  identificador = String(identificador || '').trim();
  login = String(login || '').trim();
  if (!identificador || !login || !senha) throw new Error('Preencha identificador, login e senha.');

  const r1 = await postar('api/Utilitarios/SavWeb/LoginDireto',
    { Identificador: identificador, Login: login, Password: String(senha), Url: URL_APP, Token: '', Idioma: 'pt' });
  const corpo1 = textoSimples(r1.texto);
  if (r1.status < 200 || r1.status >= 300) throw new Error(`SavWin recusou o login (status ${r1.status}). ${corpo1.slice(0, 150)}`);
  if (corpo1.toLowerCase().includes('logardireto')) throw new Error('Este identificador está configurado para outro servidor do SavWin.');
  if (corpo1 !== 'OK') throw new Error(`Login não aceito pelo SavWin: ${corpo1.replace(/<[^>]+>/g, ' ').slice(0, 200) || 'sem mensagem'}`);
  let chave = r1.headers['x-idsessaocache'];
  if (!chave) throw new Error('O SavWin aceitou o login, mas não devolveu a chave de sessão.');

  // escolhe a loja de entrada (a primeira liberada para o usuário)
  const r2 = await postar('api/Utilitarios/SavWeb/RetornaLojasUsuario', {}, { chave, identificador });
  let lojas = [];
  try { const j = JSON.parse(r2.texto); lojas = typeof j === 'string' ? (j.trim() ? JSON.parse(j) : []) : (j || []); } catch { lojas = []; }
  if (!Array.isArray(lojas) || !lojas.length) throw new Error('O usuário do SavWin não tem loja liberada.');
  const loja = lojas[0];

  const r3 = await postar('api/Utilitarios/SavWeb/EnviaLojaLogar', { Id: String(loja.FiliaID) }, { chave, identificador });
  const corpo3 = textoSimples(r3.texto);
  if (corpo3 === 'NOTOK') throw new Error('O SavWin não liberou a entrada na loja.');
  if (corpo3 === 'INADIMPLENTE') throw new Error('Acesso suspenso no SavWin (inadimplência).');
  if (corpo3.includes('2213/Bloqueio')) throw new Error('Acesso bloqueado no SavWin (aviso 2213).');
  if (!(corpo3.startsWith('OK') || corpo3.includes('2213/Aviso'))) throw new Error(`Entrada na loja não aceita: ${corpo3.replace(/<[^>]+>/g, ' ').slice(0, 200)}`);
  chave = r3.headers['x-idsessaocache'] || chave;

  return { chave, identificador, usuarioSavwin: login, loja: String(loja.LojaCompleta || loja.FiliaID) };
}

// ------------------------------------------------------------------ lojas
/** "0521 - OTICA X" / "00009 - Y" -> "521" / "9" (mesmo código usado no BI). */
function codigoDaDescricao(desc) {
  const m = String(desc || '').match(/^\s*0*(\d+)/);
  return m ? m[1] : '';
}

async function mapaLojas() {
  if (lojasSavwin && Date.now() - lojasSavwin.quando < 6 * 60 * 60 * 1000) return lojasSavwin;
  const f = await postarComSessao('api/Comercial/EstoqueGestor/RetornaFiltros', {});
  const porCodigo = new Map();
  (f.Lojas || []).forEach(l => { const c = codigoDaDescricao(l.Descricao); if (c) porCodigo.set(c, { id: String(l.Id), nome: l.Descricao }); });
  lojasSavwin = { quando: Date.now(), porCodigo };
  return lojasSavwin;
}

// ------------------------------------------------------------------ painel
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
/** "Hoje" no horário de Brasília (o Render roda em UTC). */
function hojeBrasilia() {
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  return new Date(a, m - 1, d);
}
function janela(meses) {
  const fim = hojeBrasilia();
  const ini = new Date(fim); ini.setMonth(ini.getMonth() - meses); ini.setDate(ini.getDate() + 1);
  return { DataInicial: iso(ini), DataFinal: iso(fim) };
}

const CAMPOS_PAINEL = ['Resumo', 'Cobertura', 'PorLoja', 'PorFornecedor', 'PorTipo', 'TipoGrife', 'GrifeArmacao', 'GrifeLente', 'GrifeOutros', 'CustoLiberado', 'TemposMs'];

function iniciarBusca(chaveCache, corpo) {
  buscas.set(chaveCache, { inicio: Date.now() });
  postarComSessao('api/Comercial/EstoqueGestor/RetornaPainel', corpo)
    .then(j => {
      if (j.Liberado === false) throw new Error(`SavWin: ${j.Mensagem || 'painel não liberado'}`);
      const dados = {};
      CAMPOS_PAINEL.forEach(k => { if (j[k] !== undefined) dados[k] = j[k]; });
      paineis.set(chaveCache, { quando: Date.now(), dados });
      console.log(`Painel SavWin: ${(j.Cobertura || []).length} grifes, ${(j.PorLoja || []).length} lojas, ${j.TempoMs || '?'} ms`);
    })
    .catch(err => {
      console.error('Erro no painel SavWin:', err.message);
      errosBusca.set(chaveCache, { mensagem: err.message, quando: Date.now(), expirou: err instanceof SessaoExpirada });
    })
    .finally(() => buscas.delete(chaveCache));
}

/** Lojas do pedido -> ids do SavWin (só as que o usuário do BI pode ver). */
async function lojasDoPedido(req) {
  const perfil = req.usuario || {};
  const pedidas = String((req.body && req.body.LOJAS) || '').split(/[,;\s]+/).map(codigoDaDescricao).filter(Boolean);
  if (!pedidas.length && perfil.todas_lojas === true) return { ids: [], codigos: [] };   // todas
  if (!pedidas.length) throw Object.assign(new Error('Nenhuma loja liberada para o seu usuário.'), { http: 403 });
  const mapa = await mapaLojas();
  const achadas = pedidas.filter(c => mapa.porCodigo.has(c));
  if (!achadas.length) throw Object.assign(new Error('Suas lojas do BI não foram encontradas no SavWin.'), { http: 404 });
  return { ids: achadas.map(c => mapa.porCodigo.get(c).id).sort(), codigos: achadas };
}

function enviarCompactado(req, res, obj) {
  const texto = JSON.stringify(obj);
  if (/\bgzip\b/.test(String((req.headers && req.headers['accept-encoding']) || ''))) {
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    return res.end(zlib.gzipSync(texto));
  }
  res.type('application/json').send(texto);
}

/** 409 = precisa conectar o SavWin (não usar 401: o BI entenderia como sessão do BI expirada). */
function responderErro(res, err) {
  if (err instanceof SessaoExpirada) return res.status(409).json({ error: err.message, precisaConectar: true });
  res.status(err.http || 500).json({ error: err.message });
}

function situacao() {
  return sessao
    ? { conectado: true, usuarioSavwin: sessao.usuarioSavwin, identificador: sessao.identificador, loja: sessao.loja, conectadoEm: sessao.conectadoEm, conectadoPor: sessao.conectadoPor }
    : { conectado: false };
}

// ------------------------------------------------------------------ rotas
function registrarRotasPainelSavwin(app, { exigirUsuario, restringirLojas }) {
  app.post('/savwin/situacao', exigirUsuario('acessar_bi'), (req, res) => res.json(situacao()));

  app.post('/savwin/conectar', exigirUsuario('gerenciar_usuarios'), async (req, res) => {
    try {
      const s = await conectar(req.body || {});
      sessao = { ...s, conectadoEm: new Date().toISOString(), conectadoPor: (req.usuario && (req.usuario.nome || req.usuario.login)) || '' };
      lojasSavwin = null; paineis.clear(); errosBusca.clear();
      console.log(`SavWin conectado (identificador ${s.identificador}, usuário ${s.usuarioSavwin}) por ${sessao.conectadoPor}`);
      res.json(situacao());
    } catch (err) {
      console.error('Falha ao conectar no SavWin:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/savwin/desconectar', exigirUsuario('gerenciar_usuarios'), (req, res) => {
    sessao = null; lojasSavwin = null; paineis.clear();
    res.json(situacao());
  });

  app.post('/savwin/estoque', exigirUsuario('acessar_bi'), restringirLojas, async (req, res) => {
    try {
      if (!sessao) throw new SessaoExpirada('O BI não está conectado ao SavWin.');
      const meses = [3, 6, 12].includes(Number(req.body.MESES)) ? Number(req.body.MESES) : 12;
      const { ids } = await lojasDoPedido(req);
      const chaveCache = `${meses}|${ids.join(',')}`;
      const pronto = paineis.get(chaveCache);
      const forcar = req.body.ATUALIZAR === true && pronto && Date.now() - pronto.quando > 2 * 60 * 1000;
      if (pronto && !forcar && Date.now() - pronto.quando < VALIDADE_PAINEL_MS) {
        return enviarCompactado(req, res, { quando: new Date(pronto.quando).toISOString(), meses, ...pronto.dados });
      }
      const erro = errosBusca.get(chaveCache);
      if (erro && !buscas.has(chaveCache)) {
        errosBusca.delete(chaveCache);
        if (Date.now() - erro.quando < 2 * 60 * 1000) {
          return erro.expirou ? res.status(409).json({ error: erro.mensagem, precisaConectar: true }) : res.status(502).json({ error: erro.mensagem });
        }
      }
      if (!buscas.has(chaveCache)) iniciarBusca(chaveCache, { ...janela(meses), Lojas: ids, Tipos: [], Grifes: [], MesesCobertura: meses, Widgets: ['estCobertura'] });
      res.status(202).json({ carregando: true, segundos: Math.round((Date.now() - buscas.get(chaveCache).inicio) / 1000) });
    } catch (err) { responderErro(res, err); }
  });

  /** Produtos × lojas de uma grife (bloco "O que está encalhado"). */
  app.post('/savwin/estoque/detalhe', exigirUsuario('acessar_bi'), restringirLojas, async (req, res) => {
    try {
      if (!sessao) throw new SessaoExpirada('O BI não está conectado ao SavWin.');
      const meses = [3, 6, 12].includes(Number(req.body.MESES)) ? Number(req.body.MESES) : 12;
      const { ids } = await lojasDoPedido(req);
      const j = await postarComSessao('api/Comercial/EstoqueGestor/RetornaDetalhe', {
        ...janela(meses), Lojas: ids, Tipos: [], Grifes: [], MesesCobertura: meses, Widgets: [],
        Bloco: 'estCobertura', Chave: String(req.body.CHAVE || '')
      });
      if (j.Liberado === false) throw new Error(`SavWin: ${j.Mensagem || 'detalhe não liberado'}`);
      const linhas = (j.Linhas || []).map(l => ({
        produto: l.Cliente || '', codigo: l.Numero || '', loja: l.Loja || '', tipo: l.Situacao || '',
        pecas: Number(l.Saldo) || 0, custoUnit: Number(l.Bruto) || 0, custo: Number(l.Valor) || 0,
        data: l.Data || '', fornecedor: l.Vendedor || ''
      }));
      enviarCompactado(req, res, { tipo: j.Tipo || '', total: j.Total, limitado: j.Limitado === true, linhas });
    } catch (err) { responderErro(res, err); }
  });
}

module.exports = { registrarRotasPainelSavwin, codigoDaDescricao, textoSimples, janela };
