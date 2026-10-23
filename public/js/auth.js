/**
 * Acesso: login, sessão, permissões, troca de senha e chamadas autenticadas.
 * Usado por login.html, inicio.html, usuarios.html e index.html (BI).
 * Depende de supabase-config.js (supabaseBI).
 *
 * O usuário digita só o login (ex.: "darllan"); por dentro o Supabase Auth
 * usa o e-mail "darllan@bivendas.local" (não recebe mensagens).
 */

const DOMINIO_LOGIN = 'bivendas.local';
let perfilAtual = null;

const NOMES_PERMISSOES = {
  acessar_bi: 'Acessar BI',
  gerenciar_usuarios: 'Gerenciar usuários',
  criar_metas: 'Incluir metas',
  alterar_metas: 'Alterar metas',
  excluir_metas: 'Excluir metas'
};

function emailDoLogin(login) {
  const l = String(login || '').trim().toLowerCase();
  return l.includes('@') ? l : `${l}@${DOMINIO_LOGIN}`;
}

/** Regra de senha (igual à do servidor): 8+ caracteres com letras e números. */
function validarSenhaNova(senha) {
  const s = String(senha || '');
  if (s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return 'A senha precisa ter letras e números.';
  return '';
}

/** Senha provisória fácil de ditar: sem 0/O, 1/l/I. Ex.: "Kmpa-7348" */
function gerarSenhaProvisoria() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const rnd = n => {
    const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n;
  };
  let parte1 = letras[rnd(letras.length)].toUpperCase();
  for (let i = 0; i < 3; i++) parte1 += letras[rnd(letras.length)];
  let parte2 = '';
  for (let i = 0; i < 4; i++) parte2 += '23456789'[rnd(8)];
  return `${parte1}-${parte2}`;
}

function escHTML(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------- sessão
async function obterPerfil() {
  const { data } = await supabaseBI.auth.getSession();
  if (!data || !data.session) return null;
  const { data: linhas, error } = await supabaseBI.rpc('meu_usuario');
  if (error) { console.error('meu_usuario:', error.message); return null; }
  return Array.isArray(linhas) && linhas[0] ? linhas[0] : null;
}

function temPermissao(permissao, perfil = perfilAtual) {
  return !!(perfil && perfil.ativo && perfil['pode_' + permissao] === true);
}

/**
 * Garante que há usuário logado e ativo (e com a permissão, se pedida).
 * Senão, redireciona. Se a senha for provisória, obriga a troca antes.
 */
async function exigirLogin(permissao) {
  const perfil = await obterPerfil();
  if (!perfil || !perfil.ativo) {
    await supabaseBI.auth.signOut();
    location.replace('/login.html' + (perfil ? '?inativo=1' : ''));
    return new Promise(() => {});
  }
  if (permissao && !temPermissao(permissao, perfil)) {
    location.replace('/inicio.html?semAcesso=' + encodeURIComponent(permissao));
    return new Promise(() => {});
  }
  perfilAtual = perfil;
  document.documentElement.classList.add('logado');
  if (perfil.trocar_senha) await abrirTrocarSenha(true);
  return perfil;
}

async function sair() {
  await supabaseBI.auth.signOut();
  location.replace('/login.html');
}

/** fetch para o nosso servidor levando o token do usuário. */
async function fetchAutenticado(url, opcoes = {}) {
  const { data } = await supabaseBI.auth.getSession();
  const token = data && data.session ? data.session.access_token : '';
  const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` };
  const resp = await fetch(url, { ...opcoes, headers });
  if (resp.status === 401) {
    alert('Sua sessão expirou. Faça login novamente.');
    await sair();
  }
  return resp;
}

// ------------------------------------------------ barra do usuário (topo)
/** Coloca "Nome · Início · Trocar senha · Sair" dentro do elemento. */
function montarBarraUsuario(elemento, { mostrarInicio = true } = {}) {
  if (!elemento || !perfilAtual) return;
  elemento.innerHTML = `
    <span class="usuario-nome" title="Login: ${escHTML(perfilAtual.login)}">👤 ${escHTML(perfilAtual.nome)}</span>
    ${mostrarInicio ? '<a href="/inicio.html" class="usuario-link">Início</a>' : ''}
    <button type="button" class="usuario-link" onclick="abrirTrocarSenha(false)">Trocar senha</button>
    <button type="button" class="usuario-link" onclick="sair()">Sair</button>`;
}

// ------------------------------------------------------- trocar senha
function injetarModalSenha() {
  if (document.getElementById('modalTrocarSenha')) return;
  const div = document.createElement('div');
  div.id = 'modalTrocarSenha';
  div.className = 'acesso-modal-fundo';
  div.innerHTML = `
    <form class="acesso-modal" id="formTrocarSenha" autocomplete="off">
      <h3 id="tituloTrocarSenha">Trocar senha</h3>
      <p id="textoTrocarSenha" class="acesso-ajuda"></p>
      <label>Senha atual <input type="password" id="senhaAtual" autocomplete="current-password" required></label>
      <label>Nova senha <input type="password" id="senhaNova" autocomplete="new-password" required></label>
      <label>Repita a nova senha <input type="password" id="senhaNova2" autocomplete="new-password" required></label>
      <p class="acesso-ajuda">Mínimo de 8 caracteres, com letras e números.</p>
      <div id="msgTrocarSenha" class="acesso-msg"></div>
      <div class="acesso-botoes">
        <button type="button" id="btnCancelarSenha" class="acesso-btn-sec">Cancelar</button>
        <button type="submit" id="btnSalvarSenha" class="acesso-btn">Salvar nova senha</button>
      </div>
    </form>`;
  document.body.appendChild(div);
}

/** Abre a troca de senha. Obrigatório = não dá para cancelar. Resolve ao concluir. */
function abrirTrocarSenha(obrigatorio = false) {
  injetarModalSenha();
  const modal = document.getElementById('modalTrocarSenha');
  const form = document.getElementById('formTrocarSenha');
  const msg = document.getElementById('msgTrocarSenha');
  const btnCancelar = document.getElementById('btnCancelarSenha');
  form.reset();
  msg.textContent = '';
  msg.className = 'acesso-msg';
  document.getElementById('textoTrocarSenha').textContent = obrigatorio
    ? 'Sua senha é provisória. Crie uma senha pessoal para continuar.'
    : 'Informe a senha atual e a nova senha.';
  btnCancelar.style.display = obrigatorio ? 'none' : '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('senhaAtual').focus(), 50);

  return new Promise(resolve => {
    btnCancelar.onclick = () => { modal.style.display = 'none'; resolve(false); };
    form.onsubmit = async e => {
      e.preventDefault();
      const atual = document.getElementById('senhaAtual').value;
      const nova = document.getElementById('senhaNova').value;
      const nova2 = document.getElementById('senhaNova2').value;
      const erro = validarSenhaNova(nova)
        || (nova !== nova2 ? 'As duas senhas novas não são iguais.' : '')
        || (nova === atual ? 'A nova senha precisa ser diferente da atual.' : '');
      if (erro) { msg.textContent = erro; msg.className = 'acesso-msg erro'; return; }

      const btn = document.getElementById('btnSalvarSenha');
      btn.disabled = true;
      msg.textContent = 'Salvando...'; msg.className = 'acesso-msg';
      try {
        // Confere a senha atual antes de trocar
        const email = emailDoLogin(perfilAtual.login);
        const { error: errLogin } = await supabaseBI.auth.signInWithPassword({ email, password: atual });
        if (errLogin) throw new Error('Senha atual incorreta.');
        const { error } = await supabaseBI.auth.updateUser({ password: nova });
        if (error) throw error;
        await supabaseBI.rpc('marcar_senha_trocada');
        perfilAtual.trocar_senha = false;
        msg.textContent = 'Senha alterada com sucesso.'; msg.className = 'acesso-msg ok';
        setTimeout(() => { modal.style.display = 'none'; resolve(true); }, 900);
      } catch (err) {
        msg.textContent = err.message || 'Não foi possível trocar a senha.';
        msg.className = 'acesso-msg erro';
      } finally {
        btn.disabled = false;
      }
    };
  });
}
