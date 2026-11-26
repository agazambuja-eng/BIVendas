/**
 * Configurações › 🔌 Conexão SavWin por usuário (administrador ou permissão "Conexão SavWin").
 * Acesso ao SavWin usado no Estoque encalhado e na Comissão: /savwin/conexao-usuario
 * (o servidor testa o login e grava a senha cifrada; ela nunca volta para a tela).
 */
const $c = id => document.getElementById(id);
const cfg = { usuarios: [] };
function cfgMsg(t, tipo = '') { const el = $c('cfgbiMsg'); el.className = 'acesso-msg ' + tipo; el.textContent = t || ''; }

// ------------------------------------------------------------------ 3. conexão SavWin
let svAlvo = null;
function cfgDesenharSavwin() {
  $c('corpoSavwin').innerHTML = cfg.usuarios.map(u => {
    const ok = !!(u.identificadorsav && u.loginsav && u.senhasav);
    return `<tr><td><strong>${escHTML(u.nome)}</strong><br><small>${escHTML(u.login)}</small></td>
      <td>${escHTML(u.identificadorsav || '—')}</td><td>${escHTML(u.loginsav || '—')}</td>
      <td><span class="situacao ${ok ? 'ativo' : 'inativo'}">${ok ? 'Configurada' : 'Sem acesso'}</span></td>
      <td class="acoes"><button type="button" onclick="cfgAbrirSavwin('${u.id}')">${ok ? 'Alterar' : 'Cadastrar'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="5">Nenhum usuário.</td></tr>';
}
function cfgAbrirSavwin(id) {
  const u = cfg.usuarios.find(x => x.id === id);
  if (!u) return;
  svAlvo = u;
  const ok = !!(u.loginsav && u.senhasav);
  $c('tituloSavwin').textContent = `Conexão SavWin · ${u.nome}`;
  $c('svIdent').value = u.identificadorsav || ''; $c('svLogin').value = u.loginsav || ''; $c('svSenha').value = '';
  $c('svSenha').placeholder = ok ? 'em branco = manter a senha cadastrada' : 'senha do SavWin';
  $c('svSenha').required = !ok;
  $c('svRemover').style.display = ok ? '' : 'none';
  $c('svMsg').textContent = '';
  $c('modalSavwin').style.display = 'flex';
}
async function cfgPostSavwin(corpo) {
  const resp = await fetchAutenticado('/savwin/conexao-usuario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
  return j;
}
async function cfgSalvarSavwin(ev) {
  if (ev) ev.preventDefault();
  const bt = $c('svSalvar'); bt.disabled = true; bt.textContent = 'Testando no SavWin…';
  try {
    const j = await cfgPostSavwin({ usuarioId: svAlvo.id, identificador: $c('svIdent').value, login: $c('svLogin').value, senha: $c('svSenha').value });
    Object.assign(svAlvo, { identificadorsav: j.identificador, loginsav: j.usuarioSavwin, senhasav: svAlvo.senhasav || 'x' });
    $c('modalSavwin').style.display = 'none';
    cfgDesenharSavwin();
    cfgMsg(`✅ Conexão SavWin de ${svAlvo.nome} testada e salva.`, 'ok');
  } catch (e) { $c('svMsg').className = 'acesso-msg erro'; $c('svMsg').textContent = e.message; }
  finally { $c('svSenha').value = ''; bt.disabled = false; bt.textContent = 'Testar e salvar'; }
  return false;
}
async function cfgRemoverSavwin() {
  if (!svAlvo || !confirm(`Remover o acesso SavWin de ${svAlvo.nome}?`)) return;
  try {
    await cfgPostSavwin({ usuarioId: svAlvo.id, remover: true });
    Object.assign(svAlvo, { identificadorsav: null, loginsav: null, senhasav: null });
    $c('modalSavwin').style.display = 'none';
    cfgDesenharSavwin();
    cfgMsg(`Acesso SavWin de ${svAlvo.nome} removido.`, 'ok');
  } catch (e) { $c('svMsg').className = 'acesso-msg erro'; $c('svMsg').textContent = e.message; }
}

// ------------------------------------------------------------------ início
(async () => {
  await exigirLogin();
  montarBarraUsuario($c('barraUsuario'));
  montarSubmenuConfig($c('submenuConfig'), 'savwin');
  if (!podeConexaoSavwinUsuarios()) { location.replace('/inicio.html?semAcesso=conexao_savwin'); return; }
  try {
    const resp = await fetchAutenticado('/savwin/conexao-usuarios');
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
    cfg.usuarios = (Array.isArray(j) ? j : []).map(u => ({ ...u, senhasav: u.configurada ? 'x' : null }));
  } catch (e) { cfgMsg('Erro ao carregar usuários: ' + e.message, 'erro'); }
  cfgDesenharSavwin();
  $c('modalSavwin').addEventListener('click', e => { if (e.target.id === 'modalSavwin') e.target.style.display = 'none'; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $c('modalSavwin').style.display = 'none'; });
})();
