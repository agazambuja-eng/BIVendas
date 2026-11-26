/**
 * Estoque encalhado pelo painel do SavWin (Dashboard Gestor · Estoque).
 *
 * A API externa (EstoqueAnaliticoGrid) leva ~10 min; o painel interno do
 * SavWin responde em ~40 s, já resumido. Ele exige uma sessão do sistema:
 *  - cada usuário do BI cadastra o SEU acesso ao SavWin (identificadorsav,
 *    loginsav e senhasav, na tabela usuarios) pelo botão "Conexão SavWin";
 *  - a senha é gravada cifrada (AES-256-GCM, chave derivada da
 *    SUPABASE_SECRET_KEY); se alguém digitar a senha pura direto na tabela,
 *    ela também funciona;
 *  - o servidor entra no SavWin com esse acesso, guarda a chave de sessão em
 *    memória (uma por usuário do BI) e reconecta sozinho quando ela vence.
 * Cada usuário do BI recebe o painel apenas das lojas liberadas para ele.
 *
 * API interna, não oficial: pode mudar sem aviso.
 */
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

const BASE = process.env.SAVWIN_GATEWAY_URL || 'https://apigat.savwinweb.com.br';
const URL_APP = 'https://appsav.savwinweb.com.br';
const TELA = '/tela/FRMDASHBOARDGESTOR';
const VALIDADE_PAINEL_MS = 30 * 60 * 1000;
const LIMITE_MS = 5 * 60 * 1000;

const sessoes = new Map();       // id do usuário do BI -> { chave, identificador, usuarioSavwin, loja, conectadoEm, lojasSavwin }
const conectando = new Map();    // id do usuário do BI -> login em andamento
const paineis = new Map();       // chaveCache -> { quando, dados }
const buscas = new Map();        // chaveCache -> { inicio }
const errosBusca = new Map();    // chaveCache -> { mensagem, quando }
const cachePrecos = new Map();   // código do produto -> { quando, dados }

/** "3.072,00" / "0.00" / 1080 -> número. */
function numeroBR(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').trim();
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

// ------------------------------------------------------------------ http
function postar(caminho, corpo, { chave, identificador } = {}, tela = TELA) {
  return new Promise((ok, falha) => {
    const dados = Buffer.from(JSON.stringify(corpo || {}));
    const headers = {
      'Content-Type': 'application/json', Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate', 'Content-Length': dados.length,
      Origin: URL_APP, Referer: URL_APP + tela
    };
    if (chave) {
      headers.Chave = chave;
      headers.ChaveValidacao = String(identificador || '').toUpperCase();
      headers['X-Tela'] = tela;
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

function esquecerSessao(s) {
  sessoes.forEach((v, k) => { if (v === s) sessoes.delete(k); });
}

async function postarComSessao(s, caminho, corpo, tela = TELA) {
  if (!s) throw new SessaoExpirada('O BI não está conectado ao SavWin.');
  const r = await postar(caminho, corpo, s, tela);
  if (r.status === 401 || r.status === 403) {
    esquecerSessao(s);
    throw new SessaoExpirada('A sessão do SavWin expirou.');
  }
  if (r.status < 200 || r.status >= 300) throw new Error(`SavWin respondeu ${r.status}: ${r.texto.slice(0, 200)}`);
  let j;
  try { j = JSON.parse(r.texto); } catch { throw new Error(`Resposta inesperada da SavWin: ${r.texto.slice(0, 150)}`); }
  if (j && j.Liberado === false && /sess[aã]o|login|chave/i.test(String(j.Mensagem || ''))) {
    esquecerSessao(s);
    throw new SessaoExpirada(`SavWin: ${j.Mensagem}`);
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

async function mapaLojas(s) {
  if (s.lojasSavwin && Date.now() - s.lojasSavwin.quando < 6 * 60 * 60 * 1000) return s.lojasSavwin;
  const f = await postarComSessao(s, 'api/Comercial/EstoqueGestor/RetornaFiltros', {});
  const porCodigo = new Map();
  (f.Lojas || []).forEach(l => { const c = codigoDaDescricao(l.Descricao); if (c) porCodigo.set(c, { id: String(l.Id), nome: l.Descricao }); });
  s.lojasSavwin = { quando: Date.now(), porCodigo };
  return s.lojasSavwin;
}

// ------------------------------------------------------------------ credenciais do usuário
function chaveCifra() {
  const base = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!base) throw new Error('Falta a variável SUPABASE_SECRET_KEY no Render (usada para cifrar a senha do SavWin).');
  return crypto.createHash('sha256').update('bivendas-savwin|' + base).digest();
}
/** Senha -> "v1:iv.tag.texto" (base64). */
function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chaveCifra(), iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
/** Volta a senha; se não estiver cifrada (digitada direto na tabela), usa como está. */
function decifrar(valor) {
  const v = String(valor || '');
  if (!v.startsWith('v1:')) return v;
  const [iv, tag, enc] = v.slice(3).split('.').map(x => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', chaveCifra(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
function credenciaisDo(perfil) {
  const p = perfil || {};
  return { identificador: String(p.identificadorsav || '').trim(), login: String(p.loginsav || '').trim(), senhaCifrada: p.senhasav || '' };
}
const configurado = perfil => { const c = credenciaisDo(perfil); return !!(c.identificador && c.login && c.senhaCifrada); };

/** Sessão do SavWin do usuário do BI: reaproveita a que existe ou entra com o acesso cadastrado. */
async function obterSessao(req, forcar = false) {
  const perfil = req.usuario || {};
  const id = String(perfil.id || '');
  if (!forcar && sessoes.has(id)) return sessoes.get(id);
  if (!configurado(perfil)) {
    throw Object.assign(new Error('Configure sua conexão com o SavWin (botão "🔌 Conexão SavWin", ao lado de Trocar senha).'), { semCredencial: true });
  }
  if (conectando.has(id)) return conectando.get(id);
  const c = credenciaisDo(perfil);
  const promessa = (async () => {
    let senha;
    try { senha = decifrar(c.senhaCifrada); } catch { throw Object.assign(new Error('Não foi possível ler a senha do SavWin cadastrada. Informe de novo em "🔌 Conexão SavWin".'), { semCredencial: true }); }
    const s = await conectar({ identificador: c.identificador, login: c.login, senha });
    const nova = { ...s, conectadoEm: new Date().toISOString() };
    sessoes.set(id, nova);
    console.log(`SavWin conectado para ${perfil.login || id} (usuário SavWin ${s.usuarioSavwin})`);
    return nova;
  })();
  conectando.set(id, promessa);
  try { return await promessa; } finally { conectando.delete(id); }
}

/** Roda a função com a sessão do usuário; se a sessão tiver vencido, reconecta uma vez e repete. */
async function comSessao(req, fn) {
  let s = await obterSessao(req);
  try { return await fn(s); } catch (e) {
    if (!(e instanceof SessaoExpirada)) throw e;
    s = await obterSessao(req, true);
    return fn(s);
  }
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

function iniciarBusca(s, chaveCache, corpo) {
  buscas.set(chaveCache, { inicio: Date.now() });
  postarComSessao(s, 'api/Comercial/EstoqueGestor/RetornaPainel', corpo)
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
async function lojasDoPedido(req, s) {
  const perfil = req.usuario || {};
  const pedidas = String((req.body && req.body.LOJAS) || '').split(/[,;\s]+/).map(codigoDaDescricao).filter(Boolean);
  if (!pedidas.length && perfil.todas_lojas === true) return { ids: [], codigos: [] };   // todas
  if (!pedidas.length) throw Object.assign(new Error('Nenhuma loja liberada para o seu usuário.'), { http: 403 });
  const mapa = await mapaLojas(s);
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
  if (err.semCredencial) return res.status(409).json({ error: err.message, precisaConfigurar: true });
  if (err instanceof SessaoExpirada) return res.status(409).json({ error: err.message, precisaConectar: true });
  res.status(err.http || 500).json({ error: err.message });
}

function situacao(req) {
  const perfil = req.usuario || {};
  const c = credenciaisDo(perfil);
  const s = sessoes.get(String(perfil.id || ''));
  return {
    configurado: configurado(perfil), identificador: c.identificador, usuarioSavwin: c.login,
    conectado: !!s, loja: s ? s.loja : '', conectadoEm: s ? s.conectadoEm : ''
  };
}

// ------------------------------------------------------------------ rotas
function registrarRotasPainelSavwin(app, { exigirUsuario, restringirLojas, exigirAba = () => (q, r, n) => n(), chamarSupabaseAdmin, cachePerfis }) {
  app.post('/savwin/situacao', exigirUsuario('acessar_bi'), (req, res) => res.json(situacao(req)));

  /** Conecta (ou reconecta) com o acesso cadastrado no usuário. */
  app.post('/savwin/conectar', exigirUsuario('acessar_bi'), async (req, res) => {
    try {
      await obterSessao(req, req.body && req.body.FORCAR === true);
      res.json(situacao(req));
    } catch (err) {
      console.error('Falha ao conectar no SavWin:', err.message);
      if (err.semCredencial) return res.status(409).json({ ...situacao(req), error: err.message, precisaConfigurar: true });
      res.status(400).json({ ...situacao(req), error: err.message });
    }
  });

  app.post('/savwin/desconectar', exigirUsuario('acessar_bi'), (req, res) => {
    sessoes.delete(String((req.usuario || {}).id || ''));
    res.json(situacao(req));
  });

  /**
   * Cadastra/troca o acesso do usuário ao SavWin (identificadorsav, loginsav, senhasav).
   * Testa o login antes de gravar. Senha em branco = mantém a que já está cadastrada.
   * { remover: true } apaga o acesso.
   */
  app.post('/savwin/minha-conexao', exigirUsuario('acessar_bi'), async (req, res) => {
    const perfil = req.usuario || {};
    const id = String(perfil.id || '');
    try {
      if (!id) throw new Error('Usuário sem identificação.');
      if (typeof chamarSupabaseAdmin !== 'function') throw new Error('Servidor sem acesso de gravação ao Supabase.');
      const b = req.body || {};
      let campos;
      if (b.remover === true) {
        campos = { identificadorsav: null, loginsav: null, senhasav: null };
        sessoes.delete(id);
      } else {
        const identificador = String(b.identificador || '').trim();
        const login = String(b.login || '').trim();
        let senha = String(b.senha || '');
        if (!identificador || !login) throw new Error('Preencha identificador e login.');
        if (!senha) {
          const c = credenciaisDo(perfil);
          if (!c.senhaCifrada) throw new Error('Informe a senha do SavWin.');
          senha = decifrar(c.senhaCifrada);
        }
        const s = await conectar({ identificador, login, senha });           // testa antes de gravar
        sessoes.set(id, { ...s, conectadoEm: new Date().toISOString() });
        campos = { identificadorsav: identificador, loginsav: login, senhasav: cifrar(senha) };
      }
      await chamarSupabaseAdmin(`/rest/v1/usuarios?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: campos, prefer: 'return=minimal' });
      if (cachePerfis && cachePerfis.clear) cachePerfis.clear();             // o próximo pedido relê o cadastro
      Object.assign(perfil, campos);
      res.json(situacao(req));
    } catch (err) {
      console.error('Falha ao salvar a conexão SavWin:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  /** Administrador ou quem tem a permissão "Conexão SavWin" (pode_conexao_savwin). */
  const exigirGestorConexao = [exigirUsuario(), (req, res, next) => {
    const u = req.usuario || {};
    if (u.pode_gerenciar_usuarios === true || u.pode_conexao_savwin === true) return next();
    res.status(403).json({ error: 'Sem permissão para a Conexão SavWin dos usuários.' });
  }];

  /** Lista os usuários ativos e a situação da conexão SavWin (a senha nunca sai do servidor). */
  app.get('/savwin/conexao-usuarios', ...exigirGestorConexao, async (req, res) => {
    try {
      if (typeof chamarSupabaseAdmin !== 'function') throw new Error('Servidor sem acesso de leitura ao Supabase.');
      const linhas = await chamarSupabaseAdmin('/rest/v1/usuarios?select=id,nome,login,ativo,identificadorsav,loginsav,senhasav&order=nome', { method: 'GET' });
      res.json((Array.isArray(linhas) ? linhas : []).filter(u => u.ativo !== false).map(u => ({
        id: u.id, nome: u.nome, login: u.login, identificadorsav: u.identificadorsav || null, loginsav: u.loginsav || null,
        configurada: !!(u.identificadorsav && u.loginsav && u.senhasav)
      })));
    } catch (err) {
      console.error('Falha ao listar conexões SavWin:', err.message);
      res.status(500).json({ error: 'Não foi possível listar os usuários: ' + err.message });
    }
  });

  /** Cadastra / troca / remove o acesso SavWin de OUTRO usuário (testa o login antes de gravar). */
  app.post('/savwin/conexao-usuario', ...exigirGestorConexao, async (req, res) => {
    try {
      if (typeof chamarSupabaseAdmin !== 'function') throw new Error('Servidor sem acesso de gravação ao Supabase.');
      const b = req.body || {};
      const alvo = String(b.usuarioId || '');
      if (!/^[0-9a-f-]{36}$/i.test(alvo)) throw new Error('Usuário inválido.');
      let campos;
      if (b.remover === true) {
        campos = { identificadorsav: null, loginsav: null, senhasav: null };
      } else {
        const identificador = String(b.identificador || '').trim();
        const login = String(b.login || '').trim();
        let senha = String(b.senha || '');
        if (!identificador || !login) throw new Error('Preencha identificador e login.');
        if (!senha) {
          const atual = await chamarSupabaseAdmin(`/rest/v1/usuarios?id=eq.${encodeURIComponent(alvo)}&select=senhasav`, { method: 'GET' });
          const cif = Array.isArray(atual) && atual[0] ? atual[0].senhasav : '';
          if (!cif) throw new Error('Informe a senha do SavWin.');
          senha = decifrar(cif);
        }
        await conectar({ identificador, login, senha });                      // testa antes de gravar
        campos = { identificadorsav: identificador, loginsav: login, senhasav: cifrar(senha) };
      }
      await chamarSupabaseAdmin(`/rest/v1/usuarios?id=eq.${encodeURIComponent(alvo)}`, { method: 'PATCH', body: campos, prefer: 'return=minimal' });
      sessoes.delete(alvo);                                                    // o usuário reconecta com o acesso novo
      if (cachePerfis && cachePerfis.clear) cachePerfis.clear();
      res.json({ ok: true, configurado: !!campos.loginsav, identificador: campos.identificadorsav, usuarioSavwin: campos.loginsav });
    } catch (err) {
      console.error('Falha ao salvar a conexão SavWin de outro usuário:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/savwin/estoque', exigirUsuario('acessar_bi'), exigirAba('produtos'), restringirLojas, async (req, res) => {
    try {
      const s = await obterSessao(req);
      const meses = [3, 6, 12].includes(Number(req.body.MESES)) ? Number(req.body.MESES) : 12;
      const { ids } = await comSessao(req, sx => lojasDoPedido(req, sx));
      const chaveCache = `${s.identificador}|${s.usuarioSavwin}|${meses}|${ids.join(',')}`;
      const pronto = paineis.get(chaveCache);
      const forcar = req.body.ATUALIZAR === true && pronto && Date.now() - pronto.quando > 2 * 60 * 1000;
      if (pronto && !forcar && Date.now() - pronto.quando < VALIDADE_PAINEL_MS) {
        return enviarCompactado(req, res, { quando: new Date(pronto.quando).toISOString(), meses, ...pronto.dados });
      }
      const erro = errosBusca.get(chaveCache);
      if (erro && !buscas.has(chaveCache)) {
        errosBusca.delete(chaveCache);
        if (erro.expirou) {
          // a sessão venceu durante a busca: reconecta e busca de novo
          const nova = await obterSessao(req, true);
          iniciarBusca(nova, chaveCache, { ...janela(meses), Lojas: ids, Tipos: [], Grifes: [], MesesCobertura: meses, Widgets: ['estCobertura'] });
          return res.status(202).json({ carregando: true, segundos: 0 });
        }
        if (Date.now() - erro.quando < 2 * 60 * 1000) return res.status(502).json({ error: erro.mensagem });
      }
      if (!buscas.has(chaveCache)) iniciarBusca(sessoes.get(String(req.usuario.id)) || s, chaveCache, { ...janela(meses), Lojas: ids, Tipos: [], Grifes: [], MesesCobertura: meses, Widgets: ['estCobertura'] });
      res.status(202).json({ carregando: true, segundos: Math.round((Date.now() - buscas.get(chaveCache).inicio) / 1000) });
    } catch (err) { responderErro(res, err); }
  });

  /**
   * Preço de venda e promoção de produtos (tela Consulta Preço Estoque do SavWin),
   * pelo código do produto. ~0,1 s por produto; cache de 6 h.
   */
  app.post('/savwin/precos', exigirUsuario('acessar_bi'), async (req, res) => {
    try {
      const codigos = [...new Set([].concat(req.body.CODIGOS || []).map(c => String(c).replace(/\D/g, '').replace(/^0+/, '')).filter(Boolean))].slice(0, 80);
      const precos = {};
      const fila = codigos.filter(c => {
        const em = cachePrecos.get(c);
        if (em && Date.now() - em.quando < 6 * 60 * 60 * 1000) { precos[c] = em.dados; return false; }
        return true;
      });
      const trabalhar = async () => {
        for (let c = fila.shift(); c; c = fila.shift()) {
          const j = await comSessao(req, s => postarComSessao(s, 'api/Comercial/ConsultaPrecoEstoque/ConsultaPrecoEstoque', { loja: '', pesquisa: c, tipo: 'SEQUENCIAL' }));
          const lista = typeof j === 'string' ? (() => { try { return JSON.parse(j); } catch { return []; } })() : j;
          const x = (Array.isArray(lista) ? lista : []).find(l => String(l.MATSEQUENCIAL).replace(/^0+/, '') === c) || (lista || [])[0];
          const dados = x ? {
            venda: numeroBR(x.PRECOVENDA), promocao: numeroBR(x.PRECOPROMOCAO), matid: String(x.MATID || ''),
            modelo: String(x.ARMDESCRICAO || '').trim(), cor: String(x.ARCDESCRICAO || '').trim().replace(/^\.$/, ''),
            tamanho: String(x.ATODESCRICAO || '').trim(), linha: String(x.ARLDESCRICAO || '').trim(),
            cadastro: String(x.MATDTCADASTRO || '')
          } : null;
          precos[c] = dados;
          cachePrecos.set(c, { quando: Date.now(), dados });
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, fila.length) }, trabalhar));   // 6 consultas por vez
      if (cachePrecos.size > 20000) cachePrecos.clear();
      res.json({ precos });
    } catch (err) { responderErro(res, err); }
  });

  /** Comissão (espelho do relatório do SavWin) para as lojas e o período do BI. */
  app.post('/savwin/comissao', exigirUsuario('acessar_bi'), exigirAba('comissao'), restringirLojas, async (req, res) => {
    try {
      const b = req.body || {};
      const inicio = dataBR(b.DATAINICIAL), fim = dataBR(b.DATAFINAL);
      if (!inicio || !fim) return res.status(400).json({ error: 'Informe o período.' });
      const o = b.OPCOES || {};
      const opcoes = {
        incluiSaldoReceber: o.incluiSaldoReceber === true,
        consideraOSSaldoReceber: o.consideraOSSaldoReceber !== false,
        consideraOSSemEntrega: o.consideraOSSemEntrega !== false,
        subtraiTaxaAdm: o.subtraiTaxaAdm === true
      };
      const codigos = String(b.LOJAS || '').split(/[,;\s]+/).map(codigoDaDescricao).filter(Boolean).sort((x, y) => x - y);
      const s0 = await obterSessao(req);
      const chave = `${s0.identificador}|${s0.usuarioSavwin}|${codigos.join(',')}|${inicio}|${fim}|${JSON.stringify(opcoes)}`;
      const em = cacheComissao.get(chave);
      if (em && b.ATUALIZAR !== true && Date.now() - em.quando < 5 * 60 * 1000) {
        return enviarCompactado(req, res, { quando: new Date(em.quando).toISOString(), inicio, fim, opcoes, linhas: em.linhas });
      }
      const linhas = await comSessao(req, s => consultarComissao(s, { codigos, inicio, fim, opcoes }));
      if (cacheComissao.size > 200) cacheComissao.clear();
      cacheComissao.set(chave, { quando: Date.now(), linhas });
      enviarCompactado(req, res, { quando: new Date().toISOString(), inicio, fim, opcoes, linhas });
    } catch (err) { responderErro(res, err); }
  });

  /** Produtos × lojas de uma grife (bloco "O que está encalhado"). */
  app.post('/savwin/estoque/detalhe', exigirUsuario('acessar_bi'), exigirAba('produtos'), restringirLojas, async (req, res) => {
    try {
      const meses = [3, 6, 12].includes(Number(req.body.MESES)) ? Number(req.body.MESES) : 12;
      const j = await comSessao(req, async s => {
        const { ids } = await lojasDoPedido(req, s);
        return postarComSessao(s, 'api/Comercial/EstoqueGestor/RetornaDetalhe', {
          ...janela(meses), Lojas: ids, Tipos: [], Grifes: [], MesesCobertura: meses, Widgets: [],
          Bloco: 'estCobertura', Chave: String(req.body.CHAVE || '')
        });
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

// ------------------------------------------------------------------ comissão
const TELA_COMISSAO = '/tela/FRMRELATORIOCOMISSAO';
const API_COMISSAO = 'api/Relatorios/RelatoriosComissao';
const cacheComissao = new Map();     // 5 min por usuário SavWin + filtros
const comoLista = j => {
  let v = j;
  if (typeof v === 'string') { try { v = v.trim() ? JSON.parse(v) : []; } catch { v = []; } }
  return Array.isArray(v) ? v : (v && Array.isArray(v.Resultado) ? v.Resultado : []);
};
const dataBR = d => {
  const t = String(d || '').trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return /^\d{2}\/\d{2}\/\d{4}$/.test(t) ? t : '';
};
const sn = v => (v ? 'S' : 'N');

/** Lojas e vendedores (ativos) da tela de comissão; guardados 6 h na sessão. */
async function listasComissao(s) {
  if (s.listasComissao && Date.now() - s.listasComissao.quando < 6 * 60 * 60 * 1000) return s.listasComissao;
  const l = await postarComSessao(s, `${API_COMISSAO}/RetornaListasComissao`, {}, TELA_COMISSAO);
  const v = await postarComSessao(s, `${API_COMISSAO}/RetornaVendedoresComissao`, { Valor: '1' }, TELA_COMISSAO);
  const lj = typeof l === 'string' ? JSON.parse(l || '{}') : (l || {});
  const vd = typeof v === 'string' ? JSON.parse(v || '{}') : (v || {});
  const porCodigo = new Map();
  (lj.ListaLoja || []).forEach(x => { const c = codigoDaDescricao(x.DESCRICAO); if (c) porCodigo.set(c, String(x.ID)); });
  const vendedores = (vd.ListaVendedor || []).map(x => String(x.ID)).filter(Boolean);
  s.listasComissao = { quando: Date.now(), porCodigo, vendedores };
  return s.listasComissao;
}

/**
 * Relatório de comissão "POR FAIXA · ANALÍTICO · FATURAMENTO" do SavWin (o mesmo da tela
 * Relatórios de Comissão), uma linha por OS. Base de comissão = o que o cliente pagou da OS
 * (com "Considera OS pendente (saldo a receber)"); percentual pela faixa do vendedor.
 */
async function consultarComissao(s, { codigos, inicio, fim, opcoes }) {
  const { porCodigo, vendedores } = await listasComissao(s);
  const ids = codigos.map(c => porCodigo.get(c)).filter(Boolean);
  if (codigos.length && !ids.length) throw Object.assign(new Error('Suas lojas do BI não foram encontradas na comissão do SavWin.'), { http: 404 });
  const filtro = {
    SUBTRAITXADM: sn(opcoes.subtraiTaxaAdm),
    VENDEDOR: vendedores.length ? `|${vendedores.join('|')}|` : null,   // só vendedores ativos, como na tela
    VENDEDOR2: null,
    FILIDLOJA: ids.length ? `|${ids.join('|')}|` : '',
    INCLUIOSSEMENTREGA: sn(opcoes.consideraOSSemEntrega),
    DATAENTRADAINICIO: inicio, DATAENTRADAFINAL: fim,
    INCLUIOSCOMSALDORECEBER: sn(opcoes.consideraOSSaldoReceber),
    INCLUISALDORECEBER: sn(opcoes.incluiSaldoReceber)
  };
  const j = await postarComSessao(s, `${API_COMISSAO}/RetornaComissaoPorFaixaAnaliticoFaturamento`, { sObjetoJSON: JSON.stringify(filtro) }, TELA_COMISSAO);
  if (j && j.Liberado === false) throw new Error(`SavWin: ${j.Mensagem || 'relatório de comissão não liberado'}`);
  return comoLista(j).map(x => ({
    loja: String(x.LOJANOME || ''), lojaId: String(x.FILID || ''),
    os: String(x.PEDSEQUENCIAL || ''), pedid: String(x.PEDID || ''), data: String(x.PEDDATAENTRADA || ''),
    vendedor: String(x.VENDEDOR || ''), vendedorId: String(x.VNDID || ''), tabela: String(x.COMID || ''),
    pecas: numeroBR(x.QTDEPECAS), servico: numeroBR(x.SERVICO), bruto: numeroBR(x.VALORBRUTO),
    liquido: numeroBR(x.VALORLIQUIDOVENDA), base: numeroBR(x.BASECOMISSAO),
    percentual: numeroBR(x.COMPERCENTUAL), comissao: numeroBR(x.COMISSAO),
    totalVendedor: numeroBR(x.VALORTOTALVENDAS)
  }));
}

module.exports = { registrarRotasPainelSavwin, consultarComissao, codigoDaDescricao, textoSimples, janela, numeroBR, cifrar, decifrar };
