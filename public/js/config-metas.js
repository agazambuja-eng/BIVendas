/**
 * ⚙ Configurações > Metas por Loja
 * Incluir, alterar e excluir registros da tabela `metas_loja` (Supabase).
 *
 * Quem pode o quê vem do cadastro de usuários (auth.js / tabela usuarios):
 * pode_criar_metas, pode_alterar_metas, pode_excluir_metas. O Supabase
 * também confere essas permissões (RLS), então esconder botões é só conforto.
 *
 * Depende de metas.js (metasClient, escaparHTML, nomeCompetencia,
 * recarregarAbaMetas) e de main.js (formatarMoedaBR, lojasDisponiveis).
 */

let cfgMetasEmEdicao = null;   // id do registro sendo alterado (null = inclusão)
let cfgMetasLista = [];

// ---------- utilidades ----------
function cfgEl(id) { return document.getElementById(id); }

/**
 * Mês comercial escolhido no filtro ("2026-10") -> período 26/09/2026 a 25/10/2026.
 * Usa periodo-comercial.js (isoData, somarMeses, DIA_FECHAMENTO).
 */
function periodoDoMes(valorMes) {
  if (!valorMes) return null;
  const [a, m] = valorMes.split('-').map(Number);
  const [ai, mi] = somarMeses(a, m, -1);
  return { inicio: isoData(ai, mi, DIA_FECHAMENTO + 1), fim: isoData(a, m, DIA_FECHAMENTO) };
}
/** Mês comercial de hoje no formato do campo mês ("2026-11" em 29/10/2026). */
function mesComercialAtualInput() {
  const c = periodoComercialDe(new Date()).competencia;
  return `${Math.floor(c / 100)}-${String(c % 100).padStart(2, '0')}`;
}
/** "2026-09-26", "2026-10-25" -> "26/09/2026 a 25/10/2026" */
function textoPeriodo(ini, fim) {
  return `${formatarDataISOparaBR(ini)} a ${formatarDataISOparaBR(fim)}`;
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
  if (error.code === '42501' || /row-level security/i.test(error.message || '')) {
    return 'Seu usuário não tem permissão para esta operação nas metas.';
  }
  if (/valor_meta_(bronze|prata|ouro)/.test(error.message || '')) {
    return 'As colunas das metas Bronze/Prata/Ouro ainda não existem. Rode database/07_metas_vendedor_trofeus.sql no Supabase.';
  }
  if (error.code === '23P01' || error.code === '23505') {
    return 'Esta loja já tem meta num período que se cruza com estas datas. Use "Alterar" na lista ou ajuste as datas.';
  }
  if (/data_inicio|data_fim|generated column|competencia/.test(error.message || '')) {
    return 'A tabela de metas ainda está no formato antigo. Rode database/08_metas_periodo_datas.sql no Supabase.';
  }
  return error.message;
}

// ---------- abrir / fechar ----------
async function abrirConfigMetas() {
  cfgEl('modalConfigMetas').style.display = 'flex';
  cfgMensagem('');
  if (!cfgEl('cfgFiltroCompetencia').value) {
    cfgEl('cfgFiltroCompetencia').value = mesComercialAtualInput();
  }
  await cfgAtualizarSessao();
}

function fecharConfigMetas() {
  cfgEl('modalConfigMetas').style.display = 'none';
}

// ---------- login ----------
async function cfgAtualizarSessao() {
  const podeCriar = temPermissao('criar_metas');
  cfgEl('cfgAreaMetas').style.display = 'flex';
  // Formulário aparece para incluir (criar) ou ao clicar em ✏️ (alterar)
  cfgEl('cfgFormMetas').style.display = podeCriar ? '' : 'none';
  cfgEl('cfgBtnCopiar').style.display = podeCriar ? '' : 'none';
  cfgLimparFormulario();
  await cfgCarregarMetas();
}

// ---------- listar ----------
async function cfgCarregarMetas() {
  const periodo = periodoDoMes(cfgEl('cfgFiltroCompetencia').value);
  if (!periodo) return;
  const corpo = cfgEl('cfgTabelaMetasCorpo');
  corpo.innerHTML = '<tr><td colspan="7" style="padding:10px; color:#666;">Carregando...</td></tr>';

  const { data, error } = await metasClient
    .from('metas_loja')
    .select('*')
    .lte('data_inicio', periodo.fim)
    .gte('data_fim', periodo.inicio)
    .order('codigo', { ascending: true });

  if (error) {
    corpo.innerHTML = '';
    cfgMensagem(traduzirErro(error), 'erro');
    return;
  }
  cfgMetasLista = data || [];
  cfgEl('cfgTituloLista').textContent =
    `Metas de ${textoPeriodo(periodo.inicio, periodo.fim)} (${cfgMetasLista.length} loja${cfgMetasLista.length === 1 ? '' : 's'})`;

  if (!cfgMetasLista.length) {
    corpo.innerHTML = `<tr><td colspan="7" style="padding:10px; color:#666;">Nenhuma meta cadastrada para ${textoPeriodo(periodo.inicio, periodo.fim)}.</td></tr>`;
    return;
  }

  const fmt = v => (v === null || v === undefined) ? '—' : formatarMoedaBR(Number(v));
  corpo.innerHTML = cfgMetasLista.map(m => `
    <tr style="${cfgMetasEmEdicao === m.id ? 'background:#fff8e1;' : ''}">
      <td style="padding:6px 8px;"><strong>${escaparHTML(m.codigo)}</strong> – ${escaparHTML(m.descricao)}</td>
      <td style="padding:6px 8px; white-space:nowrap; ${m.data_inicio !== periodo.inicio || m.data_fim !== periodo.fim ? 'color:#b07a00;' : 'color:#555;'}">${textoPeriodo(m.data_inicio, m.data_fim)}</td>
      <td style="padding:6px 8px; text-align:right;">${fmt(m.valor_meta)}</td>
      <td style="padding:6px 8px; text-align:right;">${fmt(m.valor_meta_bronze ?? m.valor_meta_vendedor)}</td>
      <td style="padding:6px 8px; text-align:right;">${fmt(m.valor_meta_prata)}</td>
      <td style="padding:6px 8px; text-align:right;">${fmt(m.valor_meta_ouro)}</td>
      <td style="padding:6px 8px; text-align:center; white-space:nowrap;">
        ${temPermissao('alterar_metas') ? `<button type="button" class="cfg-btn-mini" onclick="cfgEditar(${m.id})" title="Alterar">✏️</button>` : ''}
        ${temPermissao('excluir_metas') ? `<button type="button" class="cfg-btn-mini cfg-btn-perigo" onclick="cfgExcluir(${m.id})" title="Excluir">🗑️</button>` : ''}
      </td>
    </tr>`).join('');
}

// ---------- formulário ----------
function cfgLimparFormulario() {
  cfgMetasEmEdicao = null;
  cfgEl('cfgFormMetas').style.display = temPermissao('criar_metas') ? '' : 'none';
  cfgEl('cfgFormTitulo').textContent = 'Incluir meta';
  cfgEl('cfgBtnSalvar').textContent = 'Incluir';
  cfgEl('cfgBtnCancelarEdicao').style.display = 'none';
  cfgEl('cfgCodigo').value = '';
  cfgEl('cfgCodigo').disabled = false;
  cfgEl('cfgDescricao').value = '';
  cfgEl('cfgValorMeta').value = '';
  cfgEl('cfgValorMetaBronze').value = '';
  cfgEl('cfgValorMetaPrata').value = '';
  cfgEl('cfgValorMetaOuro').value = '';
  const p = periodoDoMes(cfgEl('cfgFiltroCompetencia').value || mesComercialAtualInput());
  cfgEl('cfgDataInicio').value = p.inicio;
  cfgEl('cfgDataFim').value = p.fim;
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
  cfgEl('cfgFormMetas').style.display = '';
  cfgEl('cfgFormTitulo').textContent = `Alterar meta – Loja ${m.codigo}`;
  cfgEl('cfgBtnSalvar').textContent = 'Salvar alteração';
  cfgEl('cfgBtnCancelarEdicao').style.display = 'inline-block';
  cfgEl('cfgCodigo').value = m.codigo;
  cfgEl('cfgDescricao').value = m.descricao || '';
  cfgEl('cfgValorMeta').value = m.valor_meta ?? '';
  cfgEl('cfgValorMetaBronze').value = m.valor_meta_bronze ?? m.valor_meta_vendedor ?? '';
  cfgEl('cfgValorMetaPrata').value = m.valor_meta_prata ?? '';
  cfgEl('cfgValorMetaOuro').value = m.valor_meta_ouro ?? '';
  cfgEl('cfgDataInicio').value = m.data_inicio || '';
  cfgEl('cfgDataFim').value = m.data_fim || '';
  cfgMensagem('');
  cfgCarregarMetas(); // destaca a linha em edição
  cfgEl('cfgDescricao').focus();
}

async function cfgSalvar(event) {
  if (event) event.preventDefault();
  const registro = {
    codigo: parseInt(cfgEl('cfgCodigo').value, 10),
    descricao: cfgEl('cfgDescricao').value.trim(),
    data_inicio: cfgEl('cfgDataInicio').value || null,
    data_fim: cfgEl('cfgDataFim').value || null,
    valor_meta: numeroOuNulo(cfgEl('cfgValorMeta').value),
    valor_meta_bronze: numeroOuNulo(cfgEl('cfgValorMetaBronze').value),
    valor_meta_prata: numeroOuNulo(cfgEl('cfgValorMetaPrata').value),
    valor_meta_ouro: numeroOuNulo(cfgEl('cfgValorMetaOuro').value)
  };

  if (isNaN(registro.codigo)) return cfgMensagem('Informe o código da loja.', 'erro');
  if (!registro.descricao) return cfgMensagem('Informe a descrição da loja.', 'erro');
  if (!registro.data_inicio || !registro.data_fim) return cfgMensagem('Informe a data inicial e a data final da meta.', 'erro');
  if (registro.data_fim < registro.data_inicio) return cfgMensagem('A data final precisa ser depois da inicial.', 'erro');
  if (registro.valor_meta === null || registro.valor_meta < 0) return cfgMensagem('Informe a meta da loja (R$).', 'erro');
  const { valor_meta_bronze: b, valor_meta_prata: p, valor_meta_ouro: o } = registro;
  if ([b, p, o].some(v => v !== null && v < 0)) {
    return cfgMensagem('As metas do vendedor não podem ser negativas.', 'erro');
  }
  if ((b !== null && p !== null && p <= b) || (p !== null && o !== null && o <= p) || (b !== null && o !== null && o <= b)) {
    return cfgMensagem('As metas do vendedor precisam crescer: Bronze < Prata < Ouro.', 'erro');
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
  // Mostra a lista do mês comercial em que a meta fecha
  const c = competenciaComercial(registro.data_fim, false);
  cfgEl('cfgFiltroCompetencia').value = `${Math.floor(c / 100)}-${String(c % 100).padStart(2, '0')}`;
  cfgLimparFormulario();
  await cfgCarregarMetas();
  if (typeof recarregarAbaMetas === 'function') recarregarAbaMetas();
}

async function cfgExcluir(id) {
  const m = cfgMetasLista.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Excluir a meta da loja ${m.codigo} – ${m.descricao} (${textoPeriodo(m.data_inicio, m.data_fim)})?`)) return;

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

/** Copia para o período do filtro as metas do período anterior (só lojas que ainda não têm meta). */
async function cfgCopiarMesAnterior() {
  const destino = periodoDoMes(cfgEl('cfgFiltroCompetencia').value);
  if (!destino) return;
  const origem = periodosAnteriores(destino.inicio, destino.fim, 2)[0];
  const txtOrigem = textoPeriodo(origem.inicio, origem.fim);
  const txtDestino = textoPeriodo(destino.inicio, destino.fim);

  const { data: anteriores, error } = await metasClient
    .from('metas_loja')
    .select('*')
    .lte('data_inicio', origem.fim)
    .gte('data_fim', origem.inicio);
  if (error) return cfgMensagem(traduzirErro(error), 'erro');
  if (!anteriores || !anteriores.length) {
    return cfgMensagem(`Não há metas em ${txtOrigem} para copiar.`, 'info');
  }

  const jaExistem = new Set(cfgMetasLista.map(m => m.codigo));
  const vistos = new Set();
  const novos = anteriores
    .filter(m => !jaExistem.has(m.codigo) && !vistos.has(m.codigo) && vistos.add(m.codigo))
    // competencia é calculada pelo banco: não pode ser enviada
    .map(({ id, created_at, competencia, ...resto }) => ({ ...resto, data_inicio: destino.inicio, data_fim: destino.fim }));
  if (!novos.length) {
    return cfgMensagem(`Todas as lojas de ${txtOrigem} já têm meta em ${txtDestino}.`, 'info');
  }
  if (!confirm(`Copiar ${novos.length} meta(s) de ${txtOrigem} para ${txtDestino}?`)) return;

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
