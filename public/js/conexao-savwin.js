/**
 * "🔌 Conexão SavWin" (ao lado de Trocar senha): o usuário informa o SEU acesso ao
 * SavWin — identificador, login e senha. O servidor testa o login e grava no
 * cadastro do usuário (identificadorsav, loginsav, senhasav; a senha vai cifrada).
 * A senha nunca volta para a tela: em branco = mantém a que já está cadastrada.
 */

function cxModal() {
  let m = document.getElementById('modalConexaoSavwin');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'modalConexaoSavwin';
  m.className = 'acesso-modal-fundo';
  m.innerHTML = `
    <form class="acesso-modal" id="formConexaoSavwin" autocomplete="off" onsubmit="return cxSalvar(event)">
      <h3>🔌 Conexão com o SavWin</h3>
      <p class="acesso-ajuda">Seu acesso ao SavWin, usado no Estoque encalhado (painel, preços de venda e detalhe por loja).
        O BI testa o login antes de salvar. A senha fica gravada cifrada no seu cadastro e não aparece de volta.</p>
      <div id="cxSituacao" class="cx-situacao"></div>
      <label>Identificador <input type="text" id="cxIdentificador" autocomplete="off" placeholder="ex.: 09983-ONE" required></label>
      <label>Login <input type="text" id="cxLogin" autocomplete="off" required></label>
      <label>Senha <input type="password" id="cxSenha" autocomplete="new-password" placeholder=""></label>
      <div id="cxMsg" class="acesso-msg"></div>
      <div class="acesso-botoes">
        <button type="button" class="acesso-btn-sec cx-remover" id="cxBtnRemover" onclick="cxRemover()" style="display:none">Remover acesso</button>
        <button type="button" class="acesso-btn-sec" onclick="fecharConexaoSavwin()">Fechar</button>
        <button type="submit" class="acesso-btn" id="cxBtnSalvar">Testar e salvar</button>
      </div>
    </form>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) fecharConexaoSavwin(); });
  return m;
}
function fecharConexaoSavwin() {
  const m = document.getElementById('modalConexaoSavwin');
  if (m) m.style.display = 'none';
  const s = document.getElementById('cxSenha');
  if (s) s.value = '';
}

function cxMsg(txt, tipo = 'erro') {
  const el = document.getElementById('cxMsg');
  if (!el) return;
  el.className = 'acesso-msg ' + (txt ? (tipo === 'ok' ? 'ok' : 'erro') : '');
  el.textContent = txt || '';
}

async function cxPost(url, corpo) {
  const resp = await fetchAutenticado(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });
  const j = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, j };
}

function cxDesenharSituacao(s) {
  const el = document.getElementById('cxSituacao');
  if (!el) return;
  if (!s || !s.configurado) { el.innerHTML = '<span class="ep-ponto ep-off"></span> Nenhum acesso cadastrado ainda.'; return; }
  el.innerHTML = `<span class="ep-ponto ${s.conectado ? 'ep-on' : ''}"></span> Cadastrado: <b>${escHTML(s.usuarioSavwin)}</b> · ${escHTML(s.identificador)} · ${s.conectado ? 'conectado agora' : 'não conectado no momento'}`;
}

async function abrirConexaoSavwin() {
  const m = cxModal();
  m.style.display = 'flex';
  cxMsg('');
  const sen = document.getElementById('cxSenha');
  sen.value = '';
  const r = await cxPost('/savwin/situacao');
  const s = r.ok ? r.j : null;
  cxDesenharSituacao(s);
  document.getElementById('cxIdentificador').value = (s && s.identificador) || '';
  document.getElementById('cxLogin').value = (s && s.usuarioSavwin) || '';
  sen.placeholder = s && s.configurado ? 'em branco = manter a senha cadastrada' : 'senha do SavWin';
  sen.required = !(s && s.configurado);
  document.getElementById('cxBtnRemover').style.display = s && s.configurado ? '' : 'none';
  (s && s.configurado ? sen : document.getElementById('cxIdentificador')).focus();
}

async function cxSalvar(ev) {
  if (ev) ev.preventDefault();
  const bt = document.getElementById('cxBtnSalvar');
  const sen = document.getElementById('cxSenha');
  bt.disabled = true; bt.textContent = 'Testando no SavWin…';
  cxMsg('');
  try {
    const r = await cxPost('/savwin/minha-conexao', {
      identificador: document.getElementById('cxIdentificador').value,
      login: document.getElementById('cxLogin').value,
      senha: sen.value
    });
    if (!r.ok) throw new Error(r.j.error || `Erro ${r.status}`);
    sen.value = '';
    cxDesenharSituacao(r.j);
    cxMsg('✅ Conectado e salvo. O Estoque encalhado já usa este acesso.', 'ok');
    document.getElementById('cxBtnRemover').style.display = '';
    if (typeof epConexaoAtualizada === 'function') epConexaoAtualizada(r.j);
    setTimeout(fecharConexaoSavwin, 1500);
  } catch (e) {
    cxMsg(e.message);
  } finally {
    sen.value = '';
    bt.disabled = false; bt.textContent = 'Testar e salvar';
  }
  return false;
}

async function cxRemover() {
  if (!confirm('Remover o seu acesso ao SavWin do BI? O Estoque encalhado deixa de carregar até você cadastrar de novo.')) return;
  const r = await cxPost('/savwin/minha-conexao', { remover: true });
  if (!r.ok) { cxMsg(r.j.error || `Erro ${r.status}`); return; }
  cxDesenharSituacao(r.j);
  document.getElementById('cxIdentificador').value = '';
  document.getElementById('cxLogin').value = '';
  document.getElementById('cxBtnRemover').style.display = 'none';
  cxMsg('Acesso removido.', 'ok');
  if (typeof epConexaoAtualizada === 'function') epConexaoAtualizada(r.j);
}
