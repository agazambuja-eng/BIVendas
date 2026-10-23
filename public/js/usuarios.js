/**
 * Configurações > Usuários: listar, criar, alterar acessos, ativar/inativar
 * e redefinir senha.
 *  - Listar e alterar: direto no Supabase (RLS só permite a quem gerencia usuários).
 *  - Criar e redefinir senha: pelo nosso servidor (/api/usuarios), que tem a
 *    chave secreta do Supabase.
 */

const PERMS = ['acessar_bi', 'criar_metas', 'alterar_metas', 'excluir_metas', 'gerenciar_usuarios'];
const CHIPS = {
  acessar_bi: '📊 BI',
  criar_metas: '➕ Metas',
  alterar_metas: '✏️ Metas',
  excluir_metas: '🗑️ Metas',
  gerenciar_usuarios: '⚙️ Administrador'
};

let usuarios = [];
let usuarioEmEdicao = null;   // null = novo
let usuarioResetSenha = null;

const $ = id => document.getElementById(id);

function mensagem(elId, texto, tipo = '') {
  const el = $(elId);
  el.textContent = texto || '';
  el.className = 'acesso-msg ' + tipo;
}

function fecharModal(id) { $(id).style.display = 'none'; }

/** "Darllan Moreira" -> "darllan.moreira" (sugestão de login) */
function sugerirLogin(nome) {
  const partes = String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  const login = partes.length > 1 ? `${partes[0]}.${partes[partes.length - 1]}` : partes[0];
  return login.slice(0, 30);
}

// ------------------------------------------------------------- listar
async function carregarUsuarios() {
  const { data, error } = await supabaseBI.from('usuarios').select('*').order('nome');
  if (error) {
    $('corpoUsuarios').innerHTML = '';
    return mensagem('msgUsuarios', 'Erro ao carregar usuários: ' + error.message, 'erro');
  }
  usuarios = data || [];
  renderizarUsuarios();
}

function renderizarUsuarios() {
  const busca = $('buscaUsuario').value.trim().toLowerCase();
  const verInativos = $('mostrarInativos').checked;
  const lista = usuarios.filter(u =>
    (verInativos || u.ativo) &&
    (!busca || u.nome.toLowerCase().includes(busca) || u.login.includes(busca)));

  if (!lista.length) {
    $('corpoUsuarios').innerHTML = `<tr><td colspan="5" style="color:#6b7280">Nenhum usuário encontrado.</td></tr>`;
    return;
  }
  $('corpoUsuarios').innerHTML = lista.map(u => {
    const chips = PERMS.filter(p => u['pode_' + p])
      .map(p => `<span class="chip ${p === 'gerenciar_usuarios' ? 'admin' : ''}">${CHIPS[p]}</span>`).join('')
      || '<span style="color:#9aa0a6">nenhum</span>';
    const souEu = perfilAtual && u.id === perfilAtual.id;
    return `<tr class="${u.ativo ? '' : 'inativo'}">
      <td><strong>${escHTML(u.nome)}</strong>${souEu ? ' <span class="chip">você</span>' : ''}
        ${u.trocar_senha ? '<br><small style="color:#b07a00">senha provisória</small>' : ''}</td>
      <td>${escHTML(u.login)}</td>
      <td>${chips}</td>
      <td><span class="situacao ${u.ativo ? 'ativo' : 'inativo'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td class="acoes">
        <button type="button" onclick="abrirFormUsuario('${u.id}')">Editar</button>
        <button type="button" onclick="abrirResetSenha('${u.id}')">Redefinir senha</button>
        ${souEu ? '' : `<button type="button" onclick="alternarAtivo('${u.id}')">${u.ativo ? 'Inativar' : 'Ativar'}</button>`}
      </td>
    </tr>`;
  }).join('');
}

// ------------------------------------------------------ novo / editar
function abrirFormUsuario(id = null) {
  const u = id ? usuarios.find(x => x.id === id) : null;
  usuarioEmEdicao = u;
  $('formUsuario').reset();
  mensagem('msgFormUsuario', '');
  $('tituloFormUsuario').textContent = u ? `Editar usuário – ${u.nome}` : 'Novo usuário';
  $('usuNome').value = u ? u.nome : '';
  $('usuLogin').value = u ? u.login : '';
  $('usuLogin').disabled = !!u;
  $('ajudaLogin').textContent = u
    ? 'O login não pode ser alterado. Para outro login, crie um novo usuário e inative este.'
    : 'Letras minúsculas, números, ponto ou hífen, sem espaço e sem acento. Sugestão: nome.sobrenome';
  $('usuEmail').value = u ? (u.email_contato || '') : '';
  $('blocoSenha').style.display = u ? 'none' : '';
  $('usuSenha').value = u ? '' : gerarSenhaProvisoria();
  PERMS.forEach(p => { $('perm_' + p).checked = u ? !!u['pode_' + p] : p === 'acessar_bi'; });
  $('usuAtivo').checked = u ? u.ativo : true;

  // Não deixa o administrador tirar o próprio acesso de administrador/ativo
  const souEu = u && perfilAtual && u.id === perfilAtual.id;
  $('perm_gerenciar_usuarios').disabled = !!souEu;
  $('usuAtivo').disabled = !!souEu;

  $('modalUsuario').style.display = 'flex';
  setTimeout(() => $('usuNome').focus(), 50);
}

$('usuNome').addEventListener('input', () => {
  if (!usuarioEmEdicao && !$('usuLogin').dataset.editado) $('usuLogin').value = sugerirLogin($('usuNome').value);
});
$('usuLogin').addEventListener('input', () => {
  $('usuLogin').dataset.editado = '1';
  $('usuLogin').value = $('usuLogin').value.toLowerCase().replace(/\s/g, '');
});

$('formUsuario').onsubmit = async (e) => {
  e.preventDefault();
  const nome = $('usuNome').value.trim();
  const login = $('usuLogin').value.trim().toLowerCase();
  const email = $('usuEmail').value.trim();
  const perms = {};
  PERMS.forEach(p => { perms['pode_' + p] = $('perm_' + p).checked; });
  const ativo = $('usuAtivo').checked;

  if (!nome) return mensagem('msgFormUsuario', 'Informe o nome.', 'erro');

  const btn = $('btnSalvarUsuario');
  btn.disabled = true;
  mensagem('msgFormUsuario', 'Salvando...');
  try {
    if (usuarioEmEdicao) {
      const alteracao = { nome, email_contato: email || null, ...perms, ativo };
      if (usuarioEmEdicao.id === perfilAtual.id) {  // proteção extra
        alteracao.pode_gerenciar_usuarios = true;
        alteracao.ativo = true;
      }
      const { data, error } = await supabaseBI.from('usuarios')
        .update(alteracao).eq('id', usuarioEmEdicao.id).select();
      if (error) throw error;
      if (!data || !data.length) throw new Error('Nada foi alterado (sem permissão?).');
      mensagem('msgUsuarios', `Usuário ${nome} atualizado.`, 'ok');
    } else {
      if (!/^[a-z0-9._-]{3,30}$/.test(login)) throw new Error('Login inválido: use de 3 a 30 letras minúsculas, números, ponto ou hífen.');
      const senha = $('usuSenha').value.trim();
      const erroSenha = validarSenhaNova(senha);
      if (erroSenha) throw new Error(erroSenha);
      const resp = await fetchAutenticado('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, login, senha, email_contato: email, ativo, trocar_senha: true, ...perms })
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.error || `Erro ${resp.status}`);
      mensagem('msgUsuarios', `Usuário criado. Login: ${login} · Senha provisória: ${senha}`, 'ok');
    }
    fecharModal('modalUsuario');
    await carregarUsuarios();
  } catch (err) {
    mensagem('msgFormUsuario', err.message, 'erro');
  } finally {
    btn.disabled = false;
  }
};

// ---------------------------------------------------- ativar / inativar
async function alternarAtivo(id) {
  const u = usuarios.find(x => x.id === id);
  if (!u) return;
  const acao = u.ativo ? 'INATIVAR' : 'ATIVAR';
  if (!confirm(`${acao} o usuário ${u.nome} (${u.login})?` +
    (u.ativo ? '\n\nEle perde o acesso ao BI imediatamente.' : ''))) return;
  const { data, error } = await supabaseBI.from('usuarios').update({ ativo: !u.ativo }).eq('id', id).select();
  if (error || !data || !data.length) {
    return mensagem('msgUsuarios', 'Não foi possível alterar: ' + (error ? error.message : 'sem permissão'), 'erro');
  }
  mensagem('msgUsuarios', `Usuário ${u.nome} ${u.ativo ? 'inativado' : 'ativado'}.`, 'ok');
  await carregarUsuarios();
}

// ------------------------------------------------------- redefinir senha
function abrirResetSenha(id) {
  usuarioResetSenha = usuarios.find(x => x.id === id);
  if (!usuarioResetSenha) return;
  $('textoResetSenha').textContent = `Usuário: ${usuarioResetSenha.nome} (${usuarioResetSenha.login})`;
  $('resetSenha').value = gerarSenhaProvisoria();
  mensagem('msgResetSenha', '');
  $('btnResetSenha').disabled = false;
  $('modalResetSenha').style.display = 'flex';
}

$('formResetSenha').onsubmit = async (e) => {
  e.preventDefault();
  const senha = $('resetSenha').value.trim();
  const erro = validarSenhaNova(senha);
  if (erro) return mensagem('msgResetSenha', erro, 'erro');
  $('btnResetSenha').disabled = true;
  mensagem('msgResetSenha', 'Redefinindo...');
  try {
    const resp = await fetchAutenticado(`/api/usuarios/${usuarioResetSenha.id}/senha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha })
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(corpo.error || `Erro ${resp.status}`);
    mensagem('msgResetSenha', `Pronto! Passe ao usuário a senha provisória: ${senha}`, 'ok');
    await carregarUsuarios();
  } catch (err) {
    mensagem('msgResetSenha', err.message, 'erro');
    $('btnResetSenha').disabled = false;
  }
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') ['modalUsuario', 'modalResetSenha'].forEach(fecharModal);
});

// ------------------------------------------------------------- início
(async () => {
  await exigirLogin('gerenciar_usuarios');
  montarBarraUsuario($('barraUsuario'));
  await carregarUsuarios();
})();
