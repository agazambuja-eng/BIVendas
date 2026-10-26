/**
 * Controle de acesso no servidor.
 *
 *  - exigirUsuario(permissao): protege as rotas da API Savwin. Só responde
 *    para quem está logado, ativo e com a permissão pedida.
 *  - registrarRotasUsuarios(app): criar usuário e redefinir senha. Essas duas
 *    operações precisam da chave SECRETA do Supabase, que fica só aqui no
 *    servidor (variável de ambiente SUPABASE_SECRET_KEY no Render) e nunca
 *    vai para o navegador.
 *
 * Usa a API HTTP do Supabase direto (fetch nativo do Node 18+).
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://uumttubexjtgzeualqnz.supabase.co').replace(/\/+$/, '');
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_o177jMO-LmlRF6sY-cx4tA_fv5KIEKa';
const DOMINIO_LOGIN = 'bivendas.local';

const PERMISSOES = ['acessar_bi', 'gerenciar_usuarios', 'criar_metas', 'alterar_metas', 'excluir_metas'];

function chaveSecreta() {
  return String(process.env.SUPABASE_SECRET_KEY || '').trim();
}

// ---------------------------------------------------------------- regras
function normalizarLogin(login) {
  return String(login || '').trim().toLowerCase();
}

function validarLogin(login) {
  if (!/^[a-z0-9._-]{3,30}$/.test(login)) {
    return 'Login deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado (sem espaço e sem acento).';
  }
  return '';
}

function validarSenha(senha) {
  const s = String(senha || '');
  if (s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return 'A senha precisa ter letras e números.';
  return '';
}

function emailDoLogin(login) {
  return `${normalizarLogin(login)}@${DOMINIO_LOGIN}`;
}

// ------------------------------------------------- quem está chamando?
const cachePerfis = new Map(); // token -> { perfil, expira }
const CACHE_MS = 60 * 1000;

async function perfilDoToken(token) {
  if (!token) return null;
  const agora = Date.now();
  const emCache = cachePerfis.get(token);
  if (emCache && emCache.expira > agora) return emCache.perfil;

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/meu_usuario`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  if (!resp.ok) return null;                 // token inválido ou vencido
  const linhas = await resp.json();
  const perfil = Array.isArray(linhas) && linhas[0] ? linhas[0] : null;

  // Lojas liberadas (se não tiver "todas as lojas")
  if (perfil && perfil.todas_lojas !== true) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/minhas_lojas`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    const lojas = r.ok ? await r.json() : [];
    perfil.lojas_liberadas = (Array.isArray(lojas) ? lojas : []).map(n => String(parseInt(n, 10)));
  }

  if (cachePerfis.size > 500) cachePerfis.clear();
  cachePerfis.set(token, { perfil, expira: agora + CACHE_MS });
  return perfil;
}

function temPermissao(perfil, permissao) {
  if (!perfil || !perfil.ativo) return false;
  if (!permissao) return true;
  return perfil['pode_' + permissao] === true;
}

function tokenDaRequisicao(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/** Middleware Express: exige login ativo (e a permissão, se informada). */
function exigirUsuario(permissao) {
  return async (req, res, next) => {
    try {
      const perfil = await perfilDoToken(tokenDaRequisicao(req));
      if (!perfil) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
      if (!perfil.ativo) return res.status(403).json({ error: 'Usuário inativo.' });
      if (!temPermissao(perfil, permissao)) return res.status(403).json({ error: 'Sem permissão para esta operação.' });
      req.usuario = perfil;
      next();
    } catch (err) {
      console.error('Erro ao validar usuário:', err.message);
      res.status(500).json({ error: 'Não foi possível validar o usuário.' });
    }
  };
}

/**
 * Middleware: limita o campo LOJAS da consulta às lojas do usuário.
 *  - "todas as lojas": passa como veio.
 *  - senão: mantém só as lojas liberadas; vazio = todas as liberadas.
 */
function restringirLojas(req, res, next) {
  const perfil = req.usuario;
  if (!perfil || perfil.todas_lojas === true) return next();

  const liberadas = perfil.lojas_liberadas || [];
  if (!liberadas.length) {
    return res.status(403).json({ error: 'Nenhuma loja liberada para o seu usuário. Fale com o administrador.' });
  }
  const pedidas = String((req.body && req.body.LOJAS) || '')
    .split(/[,;\s]+/)
    .map(t => t.replace(/\D/g, ''))
    .filter(Boolean)
    .map(t => String(parseInt(t, 10)));

  const permitidas = pedidas.length ? pedidas.filter(c => liberadas.includes(c)) : liberadas;
  if (!permitidas.length) {
    return res.status(403).json({ error: 'Você não tem acesso a essa(s) loja(s).' });
  }
  req.body = { ...(req.body || {}), LOJAS: [...new Set(permitidas)].join(',') };
  next();
}

// ------------------------------------------- chamadas com a chave secreta
function tipoDaChave(chave) {
  if (!chave) return 'vazia';
  if (chave.startsWith('sb_secret_')) return 'secreta nova (sb_secret_)';
  if (chave.startsWith('sb_publishable_')) return 'PUBLICÁVEL (sb_publishable_) - errada';
  if (chave.startsWith('eyJ')) return 'JWT (service_role legada?)';
  return 'formato desconhecido';
}

/**
 * Chamada ao Supabase com a chave secreta.
 * Chave nova (sb_secret_...): primeiro só no "apikey"; se o Supabase pedir
 * Bearer (401), repete também com "Authorization: Bearer". Chave legada
 * service_role (JWT eyJ...): sempre nos dois cabeçalhos.
 */
async function chamarSupabaseAdmin(caminho, { method = 'GET', body, prefer } = {}) {
  const chave = chaveSecreta();
  const tentativas = chave.startsWith('eyJ') ? [true] : [false, true];
  let ultimoErro = null;

  for (const comBearer of tentativas) {
    const headers = { apikey: chave, 'Content-Type': 'application/json' };
    if (comBearer) headers.Authorization = `Bearer ${chave}`;
    if (prefer) headers.Prefer = prefer;

    const resp = await fetch(`${SUPABASE_URL}${caminho}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const texto = await resp.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    if (resp.ok) return dados;

    const msg = (dados && (dados.msg || dados.message || dados.error_description || dados.error)) || `HTTP ${resp.status}`;
    ultimoErro = new Error(msg);
    ultimoErro.status = resp.status;
    ultimoErro.dados = dados;
    if (resp.status !== 401) break;   // só repete quando o problema é de autenticação
  }
  if (ultimoErro.status === 401 || ultimoErro.status === 403) {
    ultimoErro.message += ` [HTTP ${ultimoErro.status}, chave no Render: ${tipoDaChave(chave)}]`;
  }
  throw ultimoErro;
}

function permissoesDoCorpo(corpo) {
  const p = {};
  PERMISSOES.forEach(nome => {
    if (typeof corpo['pode_' + nome] === 'boolean') p['pode_' + nome] = corpo['pode_' + nome];
  });
  return p;
}

// ---------------------------------------------------------------- rotas
function registrarRotasUsuarios(app) {
  const soGestor = exigirUsuario('gerenciar_usuarios');

  const exigirChaveSecreta = (req, res, next) => {
    if (!chaveSecreta()) {
      return res.status(503).json({
        error: 'Servidor sem a chave secreta do Supabase. Configure SUPABASE_SECRET_KEY nas variáveis de ambiente do Render.'
      });
    }
    if (chaveSecreta().startsWith('sb_publishable_')) {
      return res.status(503).json({
        error: 'A SUPABASE_SECRET_KEY no Render é a chave PUBLICÁVEL (sb_publishable_). Troque pela chave secreta (sb_secret_) ou pela service_role.'
      });
    }
    next();
  };

  // Criar usuário: login + senha no Supabase Auth e cadastro na tabela usuarios
  app.post('/api/usuarios', soGestor, exigirChaveSecreta, async (req, res) => {
    const corpo = req.body || {};
    const login = normalizarLogin(corpo.login);
    const nome = String(corpo.nome || '').trim();
    const senha = String(corpo.senha || '');

    const erroValidacao = validarLogin(login) || (nome ? '' : 'Informe o nome.') || validarSenha(senha);
    if (erroValidacao) return res.status(400).json({ error: erroValidacao });

    let idCriado = null;
    try {
      const criado = await chamarSupabaseAdmin('/auth/v1/admin/users', {
        method: 'POST',
        body: { email: emailDoLogin(login), password: senha, email_confirm: true, user_metadata: { login, nome } }
      });
      idCriado = criado && (criado.id || (criado.user && criado.user.id));
      if (!idCriado) throw new Error('Supabase não devolveu o id do usuário.');

      const linhas = await chamarSupabaseAdmin('/rest/v1/usuarios', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id: idCriado,
          login,
          nome,
          email_contato: String(corpo.email_contato || '').trim() || null,
          ativo: corpo.ativo !== false,
          trocar_senha: corpo.trocar_senha !== false,
          pode_acessar_bi: true,
          ...(corpo.todas_lojas === true ? { todas_lojas: true } : {}),
          ...permissoesDoCorpo(corpo)
        }
      });
      res.status(201).json(Array.isArray(linhas) ? linhas[0] : linhas);
    } catch (err) {
      // Desfaz o login criado se o cadastro na tabela falhou
      if (idCriado) {
        chamarSupabaseAdmin(`/auth/v1/admin/users/${idCriado}`, { method: 'DELETE' })
          .catch(e => console.error('Falha ao desfazer usuário:', e.message));
      }
      const jaExiste = err.status === 422 || /already|registered|exists|duplicate/i.test(err.message);
      res.status(jaExiste ? 409 : 500).json({
        error: jaExiste ? `O login "${login}" já existe.` : 'Erro ao criar usuário: ' + err.message
      });
    }
  });

  // Redefinir senha de outro usuário (obriga a trocar no próximo login)
  app.post('/api/usuarios/:id/senha', soGestor, exigirChaveSecreta, async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Usuário inválido.' });
    const senha = String((req.body || {}).senha || '');
    const erro = validarSenha(senha);
    if (erro) return res.status(400).json({ error: erro });

    try {
      await chamarSupabaseAdmin(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: { password: senha } });
      await chamarSupabaseAdmin(`/rest/v1/usuarios?id=eq.${id}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { trocar_senha: true }
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao redefinir senha: ' + err.message });
    }
  });
}

module.exports = {
  exigirUsuario,
  restringirLojas,
  registrarRotasUsuarios,
  // exportados para testes
  validarLogin, validarSenha, normalizarLogin, emailDoLogin, temPermissao, perfilDoToken, cachePerfis
};
