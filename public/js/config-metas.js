/**
 * ⚙ Configurações > Metas por Loja
 * Incluir, alterar e excluir registros da tabela `metas_loja` (Supabase).
 *
 * Por enquanto sem login (CFG_EXIGE_LOGIN = false): as políticas RLS do
 * script database/02_metas_vendedor_e_edicao.sql liberam leitura e gravação
 * com a chave publishable. Quando existir o cadastro de usuários, ligar o
 * login e trocar as políticas para "somente autenticado".
 *
 * Depende de metas.js (metasClient, escaparHTML, nomeCompetencia,
 * recarregarAbaMetas) e de main.js (formatarMoedaBR, lojasDisponiveis).
 */

// Login desligado por enquanto: o acesso à configuração será controlado pela
// futura tela de login/cadastro de usuários. Para religar, troque para true e
// rode o bloco "COM LOGIN" de database/02_metas_vendedor_e_edicao.sql.
const CFG_EXIGE_LOGIN = false;

let cfgMetasEmEdicao = null;   // id do registro sendo alterado (null = inclusão)
let cfgMetasLista = [];

// ---------- utilidades ----------
function cfgEl(id) { return document.getElementById(id); }

/** "2026-10" (input month) -> 202610 */
function mesParaCompetencia(valorMes) {
  if (!valorMes) return null;
  const [a, m] = valorMes.split('-').map(Number);
  return a * 100 + m;
}
/** 202610 -> "2026-10" */
function competenciaParaMes(c) {
  return `${Math.floor(c / 100)}-${String(c % 100).padStart(2, '0')}`;
}
function mesAtualInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function mesAnterior(c) {
  const a = Math.floor(c / 100), m = c % 100;
  return m === 1 ? (a - 1) * 100 + 12 : a * 100 + (m - 1);
}
function numeroOuNulo(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function cfgMensagem(texto, tipo = 'info') {
  const el = cfgEl('cfgMetasMensagem');
  if (!el) return;
  const cores = {
    info: ['#e8f4fd', '#b8daff', '#004085'],
    ok: ['#e9f7ef', '#b7e1c4', '#1e6b34'],
    erro: ['#fdecea', '#f5c2c0', '#8a1f1b']
  }[tipo];
  el.style.display = texto ? 'block' : 'none';
  el.style.background = cores[0];
  el.style.borderColor = cores[1];
  el.style.color = cores[2];
  el.innerHTML = texto || '';
}

function traduzirErro(error) {
  if (!error) return '';
  if (/valor_meta_ticket/.test(error.message || '')) {
    return 'A coluna valor_meta_ticket ainda não existe. Rode database/03_meta_ticket_medio.sql no Supabase.';
  }
  if (error.code === '23505') return 'Já existe meta para esta loja nesta competência. Use "Alterar" na lista.';
  if (error.code === '42501' || /row-level security/i.test(error.message)) {
    return 'Sem permissão para gravar. Rode o script database/02_metas_vendedor_e_edicao.sql no Supabase.';
  }
  if (/Invalid login credentials/i.test(error.message)) return 'E-mail ou senha inválidos.';
  return error.message;
}

// ---------- abrir / fechar ----------
async function abrirConfigMetas() {
  cfgEl('modalConfigMetas').style.display = 'flex';
  cfgMensagem('');
  if (!cfgEl('cfgFiltroCompetencia').value) {
    cfgEl('cfgFiltroCompetencia').value = mesAtualInput();
  }
  await cfgAtualizarSessao();
}

function fecharConfigMetas() {
  cfgEl('modalConfigMetas').style.display = 'none';
}

// ---------- login ----------
async function cfgAtualizarSessao() {
  if (!CFG_EXIGE_LOGIN) {
    cfgEl('cfgAreaLogin').style.display = 'none';
    cfgEl('cfgAreaMetas').style.display = 'flex';
    cfgEl('cfgBarraUsuario').style.display = 'none';
    cfgLimparFormulario();
    await cfgCarregarMetas();
    return;
  }
  const { data } = await metasClient.auth.getSession();
  const logado = !!(data && data.session);
  cfgEl('cfgBarraUsuario').style.display = logado ? 'flex' : 'none';
  cfgEl('cfgAreaLogin').style.display = logado ? 'none' : 'block';
  cfgEl('cfgAreaMetas').style.display = logado ? 'flex' : 'none';
  cfgEl('cfgUsuarioLogado').textContent = logado ? data.session.user.email : '';
  if (logado) {
    cfgLimparFormulario();
    await cfgCarregarMetas();
  }
}

async function cfgEntrar(event) {
  if (event) event.preventDefault();
  const email = cfgEl('cfgEmail').value.trim();
  const senha = cfgEl('cfgSenha').value;
  if (!email || !senha) { cfgMensagem('Informe e-mail e senha.', 'erro'); return; }
  cfgMensagem('Entrando...');
  const { error } = await metasClient.auth.signInWithPassword({ email, password: senha });
  if (error) { cfgMensagem(traduzirErro(error), 'erro'); return; }
  cfgEl('cfgSenha').value = '';
  cfgMensagem('');
  await cfgAtualizarSessao();
}

async function cfgSair() {
  await metasClient.auth.signOut();
  cfgMensagem('Sessão encerrada.', 'info');
  await cfgAtualizarSessao();
}

// ---------- listar ----------
async function cfgCarregarMetas() {
  const competencia = mesParaCompetencia(cfgEl('cfgFiltroCompetencia').value);
  if (!competencia) return;
  const corpo = cfgEl('cfgTabelaMetasCorpo');
  corpo.innerHTML = '<tr><td colspan="5" style="padding:10px; color:#666;">Carregando...</td></tr>';

  const { data, error } = await metasClient
    .from('metas_loja')
    .select('*')
    .eq('competencia', competencia)
    .order('codigo', { ascending: true });

  if (error) {
    corpo.innerHTML = '';
    cfgMensagem(traduzirErro(error), 'erro');
    return;
  }
  cfgMetasLista = data || [];
  cfgEl('cfgTituloLista').textContent =
    `Metas de ${nomeCompetencia(competencia)} (${cfgMetasLista.length} loja${cfgMetasLista.length === 1 ? '' : 's'})`;

  if (!cfgMetasLista.length) {
    corpo.innerHTML = `<tr><td colspan="5" style="padding:10px; color:#666;">Nenhuma meta cadastrada para ${nomeCompetencia(competencia)}.</td></tr>`;
    return;
  }

  const fmt = v => (v === null || v === undefined) ? '—' : formatarMoedaBR(Number(v));
  corpo.innerHTML = cfgMetasLista.map(m => `
    <tr style="${cfgMetasEmEdicao === m.id ? 'background:#fff8e1;' : ''}">
      <td style="padding:6px 8px;"><strong>${escaparHTML(m.codigo)}</strong> – ${escaparHTML(m.descricao)}</td>
      <td style="padding:6px 8px; text-align:right;">${fmt(m.valor_meta)}</td>
      <td style="padding:6px 8px; text-align:right;">${fmt(m.valor_meta_vendedor)}</td>
      <td style="padding:6px 8px; text-align:right;">${fmt(m.valor_meta_ticket)}</td>
      <td style="padding:6px 8px; text-align:center; white-space:nowrap;">
        <button type="button" class="cfg-btn-mini" onclick="cfgEditar(${m.id})" title="Alterar">✏️</button>
        <button type="button" class="cfg-btn-mini cfg-btn-perigo" onclick="cfgExcluir(${m.id})" title="Excluir">🗑️</button>
      </td>
    </tr>`).join('');
}

// ---------- formulário ----------
function cfgLimparFormulario() {
  cfgMetasEmEdicao = null;
  cfgEl('cfgFormTitulo').textContent = 'Incluir meta';
  cfgEl('cfgBtnSalvar').textContent = 'Incluir';
  cfgEl('cfgBtnCancelarEdicao').style.display = 'none';
  cfgEl('cfgCodigo').value = '';
  cfgEl('cfgCodigo').disabled = false;
  cfgEl('cfgDescricao').value = '';
  cfgEl('cfgValorMeta').value = '';
  cfgEl('cfgValorMetaVendedor').value = '';
  cfgEl('cfgValorMetaTicket').value = '';
  cfgEl('cfgCompetencia').value = cfgEl('cfgFiltroCompetencia').value || mesAtualInput();
  cfgEl('cfgCompetencia').disabled = false;
}

/** Preenche a descrição automaticamente pelo código da loja. */
function cfgSugerirDescricao() {
  const codigo = parseInt(cfgEl('cfgCodigo').value, 10);
  if (isNaN(codigo) || cfgEl('cfgDescricao').value.trim()) return;
  const daLista = cfgMetasLista.find(m => m.codigo === codigo);
  const doCadastro = (typeof lojasDisponiveis !== 'undefined' ? lojasDisponiveis : [])
    .find(l => Number(l.id) === codigo);
  const nome = (daLista && daLista.descricao) || (doCadastro && doCadastro.nome);
  if (nome) cfgEl('cfgDescricao').value = nome;
}

function cfgEditar(id) {
  const m = cfgMetasLista.find(x => x.id === id);
  if (!m) return;
  cfgMetasEmEdicao = id;
  cfgEl('cfgFormTitulo').textContent = `Alterar meta – Loja ${m.codigo}`;
  cfgEl('cfgBtnSalvar').textContent = 'Salvar alteração';
  cfgEl('cfgBtnCancelarEdicao').style.display = 'inline-block';
  cfgEl('cfgCodigo').value = m.codigo;
  cfgEl('cfgDescricao').value = m.descricao || '';
  cfgEl('cfgValorMeta').value = m.valor_meta ?? '';
  cfgEl('cfgValorMetaVendedor').value = m.valor_meta_vendedor ?? '';
  cfgEl('cfgValorMetaTicket').value = m.valor_meta_ticket ?? '';
  cfgEl('cfgCompetencia').value = competenciaParaMes(m.competencia);
  cfgMensagem('');
  cfgCarregarMetas(); // destaca a linha em edição
  cfgEl('cfgDescricao').focus();
}

async function cfgSalvar(event) {
  if (event) event.preventDefault();
  const registro = {
    codigo: parseInt(cfgEl('cfgCodigo').value, 10),
    descricao: cfgEl('cfgDescricao').value.trim(),
    competencia: mesParaCompetencia(cfgEl('cfgCompetencia').value),
    valor_meta: numeroOuNulo(cfgEl('cfgValorMeta').value),
    valor_meta_vendedor: numeroOuNulo(cfgEl('cfgValorMetaVendedor').value),
    valor_meta_ticket: numeroOuNulo(cfgEl('cfgValorMetaTicket').value)
  };

  // Se a coluna de ticket ainda não existe no banco e o campo está vazio, não envia
  const linhaAtual = cfgMetasEmEdicao ? cfgMetasLista.find(x => x.id === cfgMetasEmEdicao) : cfgMetasLista[0];
  if (registro.valor_meta_ticket === null && !(linhaAtual && 'valor_meta_ticket' in linhaAtual)) {
    delete registro.valor_meta_ticket;
  }

  if (isNaN(registro.codigo)) return cfgMensagem('Informe o código da loja.', 'erro');
  if (!registro.descricao) return cfgMensagem('Informe a descrição da loja.', 'erro');
  if (!registro.competencia) return cfgMensagem('Informe a competência (mês/ano).', 'erro');
  if (registro.valor_meta === null || registro.valor_meta < 0) return cfgMensagem('Informe a meta da loja (R$).', 'erro');
  if (registro.valor_meta_ticket !== null && registro.valor_meta_ticket < 0) {
    return cfgMensagem('A meta de ticket médio não pode ser negativa.', 'erro');
  }
  if (registro.valor_meta_vendedor !== null && registro.valor_meta_vendedor < 0) {
    return cfgMensagem('A meta do vendedor não pode ser negativa.', 'erro');
  }

  cfgEl('cfgBtnSalvar').disabled = true;
  const resp = cfgMetasEmEdicao
    ? await metasClient.from('metas_loja').update(registro).eq('id', cfgMetasEmEdicao).select()
    : await metasClient.from('metas_loja').insert(registro).select();
  cfgEl('cfgBtnSalvar').disabled = false;

  if (resp.error) return cfgMensagem(traduzirErro(resp.error), 'erro');
  if (!resp.data || !resp.data.length) {
    return cfgMensagem('Nada foi gravado. Confira as permissões (RLS) de gravação no Supabase.', 'erro');
  }

  cfgMensagem(cfgMetasEmEdicao ? 'Meta alterada.' : 'Meta incluída.', 'ok');
  cfgEl('cfgFiltroCompetencia').value = competenciaParaMes(registro.competencia);
  cfgLimparFormulario();
  await cfgCarregarMetas();
  if (typeof recarregarAbaMetas === 'function') recarregarAbaMetas();
}

async function cfgExcluir(id) {
  const m = cfgMetasLista.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Excluir a meta da loja ${m.codigo} – ${m.descricao} (${nomeCompetencia(m.competencia)})?`)) return;

  const { data, error } = await metasClient.from('metas_loja').delete().eq('id', id).select();
  if (error) return cfgMensagem(traduzirErro(error), 'erro');
  if (!data || !data.length) {
    return cfgMensagem('Nada foi excluído. Confira as permissões (RLS) de exclusão no Supabase.', 'erro');
  }
  if (cfgMetasEmEdicao === id) cfgLimparFormulario();
  cfgMensagem('Meta excluída.', 'ok');
  await cfgCarregarMetas();
  if (typeof recarregarAbaMetas === 'function') recarregarAbaMetas();
}

/** Copia para o mês do filtro as metas do mês anterior (só lojas que ainda não têm meta). */
async function cfgCopiarMesAnterior() {
  const destino = mesParaCompetencia(cfgEl('cfgFiltroCompetencia').value);
  if (!destino) return;
  const origem = mesAnterior(destino);

  const { data: anteriores, error } = await metasClient
    .from('metas_loja')
    .select('*')
    .eq('competencia', origem);
  if (error) return cfgMensagem(traduzirErro(error), 'erro');
  if (!anteriores || !anteriores.length) {
    return cfgMensagem(`Não há metas em ${nomeCompetencia(origem)} para copiar.`, 'info');
  }

  const jaExistem = new Set(cfgMetasLista.map(m => m.codigo));
  const novos = anteriores
    .filter(m => !jaExistem.has(m.codigo))
    .map(({ id, created_at, ...resto }) => ({ ...resto, competencia: destino }));
  if (!novos.length) {
    return cfgMensagem(`Todas as lojas de ${nomeCompetencia(origem)} já têm meta em ${nomeCompetencia(destino)}.`, 'info');
  }
  if (!confirm(`Copiar ${novos.length} meta(s) de ${nomeCompetencia(origem)} para ${nomeCompetencia(destino)}?`)) return;

  const { error: errIns } = await metasClient.from('metas_loja').insert(novos);
  if (errIns) return cfgMensagem(traduzirErro(errIns), 'erro');
  cfgMensagem(`${novos.length} meta(s) copiada(s). Ajuste os valores se necessário.`, 'ok');
  await cfgCarregarMetas();
  if (typeof recarregarAbaMetas === 'function') recarregarAbaMetas();
}

// Fecha com ESC
document.addEventListener('keydown', e => {
  const modal = cfgEl('modalConfigMetas');
  if (e.key === 'Escape' && modal && modal.style.display === 'flex') fecharConfigMetas();
});
