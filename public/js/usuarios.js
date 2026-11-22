/**
 * Configurações > Usuários: listar, criar, alterar acessos, ativar/inativar
 * e redefinir senha.
 *  - Listar e alterar: direto no Supabase (RLS só permite a quem gerencia usuários).
 *  - Criar e redefinir senha: pelo nosso servidor (/api/usuarios), que tem a
 *    chave secreta do Supabase.
 */

const PERMS_TODAS = ['acessar_bi', 'criar_metas', 'alterar_metas', 'excluir_metas', 'solicitar_compras', 'aprovar_compras', 'configurar_bi', 'gerenciar_usuarios'];
/** "Configuração do BI" só existe depois do 14_permissao_configurar_bi.sql (coluna pode_configurar_bi). */
let PERMS = PERMS_TODAS.filter(p => p !== 'configurar_bi');
const CHIPS = {
  acessar_bi: '📊 BI',
  criar_metas: '➕ Metas',
  alterar_metas: '✏️ Metas',
  excluir_metas: '🗑️ Metas',
  solicitar_compras: '🛒 Solicita',
  aprovar_compras: '✅ Aprova compras',
  configurar_bi: '🛠️ Config. BI',
  gerenciar_usuarios: '⚙️ Administrador'
};

let usuarios = [];
/** A coluna abas_bloqueadas existe? (só depois de rodar o 12_abas_por_usuario.sql) */
const temColunaAbas = () => usuarios.some(u => Object.prototype.hasOwnProperty.call(u, 'abas_bloqueadas'));
function montarAbasForm(bloqueadas) {
  const caixa = $('listaAbasUsuario');
  if (!caixa) return;
  if (!temColunaAbas()) {
    caixa.innerHTML = '<p class="acesso-ajuda" style="margin:0">Para escolher as abas, rode no Supabase o arquivo <b>database/12_abas_por_usuario.sql</b>.</p>';
    return;
  }
  caixa.innerHTML = ABAS_BI.map(([k, rot]) => `<label class="check"><input type="checkbox" id="aba_${k}" ${bloqueadas.includes(k) ? '' : 'checked'}> ${escHTML(rot)}</label>`).join('');
}
const abasBloqueadasForm = () => ABAS_BI.map(([k]) => k).filter(k => $('aba_' + k) && !$('aba_' + k).checked);
let lojasCadastro = [];          // todas as lojas (para marcar no formulário)
let lojasPorUsuario = {};        // usuario_id -> [codigos]
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
  const [resUsu, resLojasUsu] = await Promise.all([
    supabaseBI.from('usuarios').select('*').order('nome'),
    supabaseBI.from('usuarios_lojas').select('usuario_id, loja_codigo')
  ]);
  if (resUsu.error) {
    $('corpoUsuarios').innerHTML = '';
    return mensagem('msgUsuarios', 'Erro ao carregar usuários: ' + resUsu.error.message, 'erro');
  }
  if (resLojasUsu.error) {
    mensagem('msgUsuarios', 'Lojas por usuário indisponíveis. Rode database/06_lojas_por_usuario.sql no Supabase.', 'erro');
  }
  usuarios = resUsu.data || [];
  const temColunaConfigBI = usuarios.some(u => Object.prototype.hasOwnProperty.call(u, 'pode_configurar_bi'));
  PERMS = PERMS_TODAS.filter(p => p !== 'configurar_bi' || temColunaConfigBI);
  const chk = $('perm_configurar_bi');
  if (chk) chk.closest('label').style.display = temColunaConfigBI ? '' : 'none';
  lojasPorUsuario = {};
  (resLojasUsu.data || []).forEach(r => {
    (lojasPorUsuario[r.usuario_id] = lojasPorUsuario[r.usuario_id] || []).push(Number(r.loja_codigo));
  });
  Object.values(lojasPorUsuario).forEach(l => l.sort((a, b) => a - b));
  renderizarUsuarios();
}

async function carregarLojasCadastro() {
  const { data, error } = await supabaseBI.rpc('lojas_para_cadastro');
  lojasCadastro = error ? [] : (data || []);
}

function textoLojasUsuario(u) {
  if (u.todas_lojas) return '<span class="chip">🏬 Todas</span>';
  const lista = lojasPorUsuario[u.id] || [];
  if (!lista.length) return '<span style="color:#d9534f">nenhuma</span>';
  return lista.map(c => `<span class="chip">${c}</span>`).join('');
}

function atualizarListaLojasForm() {
  $('listaLojasUsuario').classList.toggle('desativada', $('usuTodasLojas').checked);
}

function montarListaLojasForm(marcadas) {
  const set = new Set((marcadas || []).map(Number));
  $('listaLojasUsuario').innerHTML = lojasCadastro.length
    ? lojasCadastro.map(l => `
        <label class="check" title="${escHTML(l.nome)}">
          <input type="checkbox" class="chkLojaUsuario" value="${l.codigo}" ${set.has(Number(l.codigo)) ? 'checked' : ''}>
          <span><strong>${l.codigo}</strong> ${escHTML(String(l.nome || '').replace(/^0*\d+\s*/, ''))}
            <small>${l.gerente ? '· ' + escHTML(l.gerente) : ''}</small></span>
        </label>`).join('')
    : '<span class="acesso-ajuda">Nenhuma loja cadastrada (tabela lojas).</span>';
  atualizarListaLojasForm();
}

function lojasMarcadasForm() {
  return [...document.querySelectorAll('.chkLojaUsuario:checked')].map(c => Number(c.value));
}

/** Grava as lojas do usuário (apaga as antigas e insere as marcadas). */
async function salvarLojasUsuario(usuarioId, todas, codigos) {
  const { error: errDel } = await supabaseBI.from('usuarios_lojas').delete().eq('usuario_id', usuarioId);
  if (errDel) throw new Error('Erro ao gravar lojas: ' + errDel.message);
  if (todas || !codigos.length) return;
  const { error: errIns } = await supabaseBI.from('usuarios_lojas')
    .insert(codigos.map(c => ({ usuario_id: usuarioId, loja_codigo: c })));
  if (errIns) throw new Error('Erro ao gravar lojas: ' + errIns.message);
}

function renderizarUsuarios() {
  const busca = $('buscaUsuario').value.trim().toLowerCase();
  const verInativos = $('mostrarInativos').checked;
  const lista = usuarios.filter(u =>
    (verInativos || u.ativo) &&
    (!busca || u.nome.toLowerCase().includes(busca) || u.login.includes(busca)));

  if (!lista.length) {
    $('corpoUsuarios').innerHTML = `<tr><td colspan="6" style="color:#6b7280">Nenhum usuário encontrado.</td></tr>`;
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
      <td>${chips}${Array.isArray(u.abas_bloqueadas) && u.abas_bloqueadas.length ? `<br><span class="chip" title="Abas escondidas: ${escHTML(u.abas_bloqueadas.map(k => (ABAS_BI.find(a => a[0] === k) || [k, k])[1]).join(', '))}">🗂️ ${ABAS_BI.length - u.abas_bloqueadas.filter(k => ABAS_BI.some(a => a[0] === k)).length} de ${ABAS_BI.length} abas</span>` : ''}</td>
      <td>${textoLojasUsuario(u)}</td>
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
  $('usuTodasLojas').checked = u ? !!u.todas_lojas : false;
  montarListaLojasForm(u ? (lojasPorUsuario[u.id] || []) : []);
  montarAbasForm(u && Array.isArray(u.abas_bloqueadas) ? u.abas_bloqueadas : []);

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
  const todasLojas = $('usuTodasLojas').checked;
  const lojasMarcadas = lojasMarcadasForm();

  if (!nome) return mensagem('msgFormUsuario', 'Informe o nome.', 'erro');
  const abasBloqueadas = temColunaAbas() ? abasBloqueadasForm() : null;
  if (perms.pode_acessar_bi && abasBloqueadas && abasBloqueadas.length === ABAS_BI.length) {
    return mensagem('msgFormUsuario', 'Deixe pelo menos uma aba do BI liberada (ou desmarque "Acessar o BI").', 'erro');
  }
  if (perms.pode_acessar_bi && !todasLojas && !lojasMarcadas.length) {
    return mensagem('msgFormUsuario', 'Marque pelo menos uma loja ou "Todas as lojas".', 'erro');
  }

  const btn = $('btnSalvarUsuario');
  btn.disabled = true;
  mensagem('msgFormUsuario', 'Salvando...');
  try {
    if (usuarioEmEdicao) {
      const alteracao = { nome, email_contato: email || null, ...perms, ativo, todas_lojas: todasLojas, ...(abasBloqueadas ? { abas_bloqueadas: abasBloqueadas } : {}) };
      if (usuarioEmEdicao.id === perfilAtual.id) {  // proteção extra
        alteracao.pode_gerenciar_usuarios = true;
        alteracao.ativo = true;
      }
      const { data, error } = await supabaseBI.from('usuarios')
        .update(alteracao).eq('id', usuarioEmEdicao.id).select();
      if (error) throw error;
      if (!data || !data.length) throw new Error('Nada foi alterado (sem permissão?).');
      await salvarLojasUsuario(usuarioEmEdicao.id, todasLojas, lojasMarcadas);
      mensagem('msgUsuarios', `Usuário ${nome} atualizado.`, 'ok');
    } else {
      if (!/^[a-z0-9._-]{3,30}$/.test(login)) throw new Error('Login inválido: use de 3 a 30 letras minúsculas, números, ponto ou hífen.');
      const senha = $('usuSenha').value.trim();
      const erroSenha = validarSenhaNova(senha);
      if (erroSenha) throw new Error(erroSenha);
      const resp = await fetchAutenticado('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, login, senha, email_contato: email, ativo, trocar_senha: true, todas_lojas: todasLojas, ...(abasBloqueadas ? { abas_bloqueadas: abasBloqueadas } : {}), ...perms })
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.error || `Erro ${resp.status}`);
      if (corpo && corpo.id) await salvarLojasUsuario(corpo.id, todasLojas, lojasMarcadas);
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
  montarSubmenuConfig($('submenuConfig'), 'usuarios');
  await Promise.all([carregarLojasCadastro(), carregarUsuarios()]);
})();
