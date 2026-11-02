/**
 * Cadastro de vendedores (tabela public.vendedores):
 * código do ERP, nome, loja e turno da meta (M = manhã, T = tarde).
 *
 *  - Incluir / alterar / excluir seguem as permissões das metas e as lojas
 *    liberadas ao usuário (RLS no Supabase, script database/09).
 *  - "Importar do ERP" busca as vendas do período comercial atual e lista
 *    os vendedores ainda não cadastrados, com o turno sugerido pela hora
 *    das vendas (maioria antes do corte = manhã).
 */

let vendedores = [];
let lojasVend = [];               // lojas que o usuário vê
let vendedorEmEdicao = null;      // id em edição (null = novo)
let candidatosImportacao = [];    // vendedores vindos do ERP

const $ = id => document.getElementById(id);

function mensagem(elId, texto, tipo = '') {
  const el = $(elId);
  el.textContent = texto || '';
  el.className = 'acesso-msg ' + tipo;
}
function fecharModal(id) { $(id).style.display = 'none'; }

const TURNOS = { M: '☀️ Manhã', T: '🌙 Tarde' };
const podeIncluir = () => temPermissao('criar_metas');
const podeAlterar = () => temPermissao('alterar_metas');
const podeExcluir = () => temPermissao('excluir_metas');

function nomeLoja(codigo) {
  const l = lojasVend.find(x => Number(x.id) === Number(codigo));
  const nome = l ? String(l.nome || '').replace(/^0*\d+\s*[-–]?\s*/, '').trim() : '';
  return `${codigo}${nome ? ' – ' + nome : ''}`;
}

/** "1807 - ANA PAULA" -> { codigo: 1807, nome: "ANA PAULA" } */
function separarVendedorERP(texto) {
  const m = String(texto || '').trim().match(/^0*(\d+)\s*[-–]?\s*(.*)$/);
  if (!m) return null;
  const codigo = parseInt(m[1], 10);
  return codigo > 0 ? { codigo, nome: m[2].replace(/^\*\s*/, '').trim() } : null;
}

// ------------------------------------------------------------- carregar
async function carregarVendedores() {
  const { data, error } = await supabaseBI.from('vendedores').select('*').order('loja_codigo').order('nome');
  if (error) {
    $('corpoVendedores').innerHTML = '';
    const falta = /relation|does not exist|vendedores/.test(error.message || '');
    return mensagem('msgVendedores', 'Erro ao carregar vendedores: ' + error.message +
      (falta ? ' — rode database/09_vendedores_e_meta_turno.sql no Supabase.' : ''), 'erro');
  }
  vendedores = data || [];
  renderizarVendedores();
}

function preencherLojas() {
  const opcoes = lojasVend.map(l => `<option value="${Number(l.id)}">${escHTML(nomeLoja(l.id))}</option>`).join('');
  $('filtroLojaVend').innerHTML = '<option value="">Todas as lojas</option>' + opcoes;
  $('vendLoja').innerHTML = '<option value="">Selecione...</option>' + opcoes;
}

function renderizarVendedores() {
  const busca = $('buscaVendedor').value.trim().toLowerCase();
  const loja = $('filtroLojaVend').value;
  const verInativos = $('mostrarInativosVend').checked;
  const lista = vendedores.filter(v =>
    (verInativos || v.ativo) &&
    (!loja || String(v.loja_codigo) === loja) &&
    (!busca || String(v.codigo).includes(busca) || v.nome.toLowerCase().includes(busca)));

  const nM = lista.filter(v => v.turno === 'M').length;
  if (!lista.length) {
    $('corpoVendedores').innerHTML = `<tr><td colspan="6" style="color:#6b7280">Nenhum vendedor encontrado.${vendedores.length ? '' : ' Use "Importar do ERP" para começar.'}</td></tr>`;
    return;
  }
  $('corpoVendedores').innerHTML = lista.map(v => `
    <tr class="${v.ativo ? '' : 'inativo'}">
      <td><strong>${v.codigo}</strong></td>
      <td>${escHTML(v.nome)}</td>
      <td>${escHTML(nomeLoja(v.loja_codigo))}</td>
      <td>${podeAlterar()
        ? `<button type="button" class="chip turno-${v.turno}" title="Clique para trocar o turno" onclick="trocarTurno(${v.id})">${TURNOS[v.turno]}</button>`
        : `<span class="chip turno-${v.turno}">${TURNOS[v.turno]}</span>`}</td>
      <td><span class="situacao ${v.ativo ? 'ativo' : 'inativo'}">${v.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td class="acoes">
        ${podeAlterar() ? `<button type="button" onclick="abrirFormVendedor(${v.id})">Editar</button>
          <button type="button" onclick="alternarAtivoVendedor(${v.id})">${v.ativo ? 'Inativar' : 'Ativar'}</button>` : ''}
        ${podeExcluir() ? `<button type="button" onclick="excluirVendedor(${v.id})">Excluir</button>` : ''}
      </td>
    </tr>`).join('') +
    `<tr><td colspan="6" style="color:#6b7280; font-size:12px;">${lista.length} vendedor(es) · ☀️ ${nM} manhã · 🌙 ${lista.length - nM} tarde</td></tr>`;
}

// ------------------------------------------------------------- formulário
function abrirFormVendedor(id = null) {
  vendedorEmEdicao = id;
  const v = id ? vendedores.find(x => x.id === id) : null;
  $('tituloFormVendedor').textContent = v ? `Alterar vendedor ${v.codigo}` : 'Novo vendedor';
  $('vendCodigo').value = v ? v.codigo : '';
  $('vendCodigo').disabled = !!v;
  $('vendNome').value = v ? v.nome : '';
  $('vendLoja').value = v ? String(v.loja_codigo) : ($('filtroLojaVend').value || '');
  document.querySelector(`input[name=vendTurno][value=${v ? v.turno : 'T'}]`).checked = true;
  $('vendAtivo').checked = v ? v.ativo : true;
  mensagem('msgFormVendedor', '');
  $('modalVendedor').style.display = 'flex';
  (v ? $('vendNome') : $('vendCodigo')).focus();
}

async function salvarVendedor(e) {
  e.preventDefault();
  const codigo = parseInt(String($('vendCodigo').value).replace(/\D/g, ''), 10);
  const registro = {
    nome: $('vendNome').value.trim().toUpperCase(),
    loja_codigo: parseInt($('vendLoja').value, 10),
    turno: document.querySelector('input[name=vendTurno]:checked').value,
    ativo: $('vendAtivo').checked
  };
  if (!vendedorEmEdicao && !(codigo > 0)) return mensagem('msgFormVendedor', 'Informe o código do vendedor (só números).', 'erro');
  if (!registro.nome) return mensagem('msgFormVendedor', 'Informe o nome.', 'erro');
  if (!(registro.loja_codigo > 0)) return mensagem('msgFormVendedor', 'Selecione a loja.', 'erro');

  $('btnSalvarVendedor').disabled = true;
  const { error } = vendedorEmEdicao
    ? await supabaseBI.from('vendedores').update(registro).eq('id', vendedorEmEdicao)
    : await supabaseBI.from('vendedores').insert({ ...registro, codigo });
  $('btnSalvarVendedor').disabled = false;
  if (error) {
    const dup = /duplicate|unique/i.test(error.message);
    return mensagem('msgFormVendedor', dup ? `O código ${codigo} já está cadastrado.` : 'Erro ao salvar: ' + error.message, 'erro');
  }
  fecharModal('modalVendedor');
  mensagem('msgVendedores', vendedorEmEdicao ? 'Vendedor alterado.' : 'Vendedor incluído.', 'ok');
  await carregarVendedores();
}

async function trocarTurno(id) {
  const v = vendedores.find(x => x.id === id);
  if (!v) return;
  const novo = v.turno === 'M' ? 'T' : 'M';
  const { error } = await supabaseBI.from('vendedores').update({ turno: novo }).eq('id', id);
  if (error) return mensagem('msgVendedores', 'Erro ao trocar turno: ' + error.message, 'erro');
  v.turno = novo;
  mensagem('msgVendedores', `${v.nome}: turno ${TURNOS[novo]}.`, 'ok');
  renderizarVendedores();
}

async function alternarAtivoVendedor(id) {
  const v = vendedores.find(x => x.id === id);
  if (!v) return;
  const { error } = await supabaseBI.from('vendedores').update({ ativo: !v.ativo }).eq('id', id);
  if (error) return mensagem('msgVendedores', 'Erro: ' + error.message, 'erro');
  await carregarVendedores();
}

async function excluirVendedor(id) {
  const v = vendedores.find(x => x.id === id);
  if (!v || !confirm(`Excluir o vendedor ${v.codigo} - ${v.nome}?\n(Dica: "Inativar" guarda o histórico.)`)) return;
  const { error } = await supabaseBI.from('vendedores').delete().eq('id', id);
  if (error) return mensagem('msgVendedores', 'Erro ao excluir: ' + error.message, 'erro');
  mensagem('msgVendedores', 'Vendedor excluído.', 'ok');
  await carregarVendedores();
}

// ------------------------------------------------------------- importar do ERP
function isoParaBRVend(iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }
function minutosDaHora(h) {
  const m = String(h || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

async function abrirImportarVendedores() {
  $('modalImportarVend').style.display = 'flex';
  $('corpoImportarVend').innerHTML = '';
  mensagem('msgImportarVend', '');
  const p = periodoComercialDe(new Date());
  $('textoImportarVend').textContent = `Buscando vendas de ${isoParaBRVend(p.inicio)} a ${isoParaBRVend(p.fim)} no ERP...`;
  try {
    const resp = await fetchAutenticado('/consulta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        DATAINICIAL: isoParaBRVend(p.inicio), DATAFINAL: isoParaBRVend(p.fim),
        LOJAS: lojasVend.map(l => Number(l.id)).join(','), TIPODATA: 'VENDA', TIPOVENDA: ''
      })
    });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);

    const cadastrados = new Set(vendedores.map(v => Number(v.codigo)));
    const mapa = {};
    (dados || []).forEach(item => {
      const vend = separarVendedorERP(item.VENDEDOR);
      if (!vend || /SEM VENDEDOR/i.test(item.VENDEDOR) || cadastrados.has(vend.codigo)) return;
      const ml = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? '').match(/^0*(\d+)/);
      const loja = ml ? Number(ml[1]) : null;
      const c = mapa[vend.codigo] || (mapa[vend.codigo] = { ...vend, lojas: {}, horas: [] });
      if (loja) c.lojas[loja] = (c.lojas[loja] || 0) + 1;
      const min = minutosDaHora(item.HORA);
      if (min !== null) c.horas.push(min);
    });
    candidatosImportacao = Object.values(mapa).map(c => ({
      ...c,
      loja: (() => {   // loja onde mais vendeu (só se o usuário tiver acesso a ela)
        const l = Number(Object.entries(c.lojas).sort((a, b) => b[1] - a[1])[0]?.[0]) || null;
        return lojasVend.some(x => Number(x.id) === l) ? l : null;
      })(),
      marcado: true
    })).sort((a, b) => (a.loja || 0) - (b.loja || 0) || a.nome.localeCompare(b.nome));
    sugerirTurnosImportacao();
    $('textoImportarVend').textContent = candidatosImportacao.length
      ? `${candidatosImportacao.length} vendedor(es) venderam de ${isoParaBRVend(p.inicio)} a ${isoParaBRVend(p.fim)} e ainda não estão cadastrados. Confira loja e turno e clique em "Cadastrar selecionados".`
      : `Todos os vendedores que venderam de ${isoParaBRVend(p.inicio)} a ${isoParaBRVend(p.fim)} já estão cadastrados.`;
  } catch (err) {
    $('textoImportarVend').textContent = '';
    mensagem('msgImportarVend', 'Erro ao buscar no ERP: ' + err.message, 'erro');
  }
}

/** Turno sugerido: maioria das vendas antes do corte = manhã. */
function sugerirTurnosImportacao() {
  const corte = minutosDaHora($('corteTurnoVend').value) ?? 14 * 60;
  candidatosImportacao.forEach(c => {
    const manha = c.horas.filter(m => m < corte).length;
    c.turno = c.horas.length && manha > c.horas.length / 2 ? 'M' : 'T';
    c.pctManha = c.horas.length ? Math.round((manha / c.horas.length) * 100) : null;
  });
  renderizarImportacao();
}

function renderizarImportacao() {
  const opcoesLoja = sel => `<option value="" ${sel ? '' : 'selected'}>Selecione...</option>` + lojasVend.map(l => `<option value="${Number(l.id)}" ${Number(l.id) === sel ? 'selected' : ''}>${escHTML(nomeLoja(l.id))}</option>`).join('');
  $('corpoImportarVend').innerHTML = candidatosImportacao.map((c, i) => `
    <tr>
      <td><input type="checkbox" ${c.marcado ? 'checked' : ''} onchange="candidatosImportacao[${i}].marcado = this.checked"></td>
      <td><strong>${c.codigo}</strong></td>
      <td>${escHTML(c.nome)}</td>
      <td><select onchange="candidatosImportacao[${i}].loja = Number(this.value) || null">${opcoesLoja(c.loja)}</select></td>
      <td><select onchange="candidatosImportacao[${i}].turno = this.value">
            <option value="M" ${c.turno === 'M' ? 'selected' : ''}>☀️ Manhã</option>
            <option value="T" ${c.turno === 'T' ? 'selected' : ''}>🌙 Tarde</option>
          </select>
          ${c.pctManha !== null ? `<small style="color:#6b7280">${c.pctManha}% das vendas antes do corte</small>` : ''}</td>
    </tr>`).join('');
}

function marcarImportacao(v) {
  candidatosImportacao.forEach(c => { c.marcado = v; });
  renderizarImportacao();
}

async function confirmarImportacao() {
  const semLoja = candidatosImportacao.filter(c => c.marcado && !c.loja).length;
  if (semLoja) return mensagem('msgImportarVend', `Escolha a loja de ${semLoja} vendedor(es) marcado(s).`, 'erro');
  const novos = candidatosImportacao.filter(c => c.marcado && c.loja)
    .map(c => ({ codigo: c.codigo, nome: (c.nome || `VENDEDOR ${c.codigo}`).toUpperCase(), loja_codigo: c.loja, turno: c.turno, ativo: true }));
  if (!novos.length) return mensagem('msgImportarVend', 'Marque ao menos um vendedor.', 'erro');
  $('btnConfirmarImportar').disabled = true;
  const { error } = await supabaseBI.from('vendedores').insert(novos);
  $('btnConfirmarImportar').disabled = false;
  if (error) return mensagem('msgImportarVend', 'Erro ao cadastrar: ' + error.message, 'erro');
  fecharModal('modalImportarVend');
  mensagem('msgVendedores', `${novos.length} vendedor(es) cadastrado(s).`, 'ok');
  await carregarVendedores();
}

// ------------------------------------------------------------- início
(async () => {
  await exigirLogin('acessar_bi');
  if (!podeConfigVendedores()) { location.replace('/inicio.html?semAcesso=criar_metas'); return; }
  montarBarraUsuario($('barraUsuario'));
  montarSubmenuConfig($('submenuConfig'), 'vendedores');
  $('btnNovoVend').style.display = podeIncluir() ? '' : 'none';
  $('btnImportarVend').style.display = podeIncluir() ? '' : 'none';
  $('formVendedor').addEventListener('submit', salvarVendedor);
  $('vendCodigo').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
  try { lojasVend = await buscarLojasSupabase(); } catch (e) { lojasVend = []; }
  preencherLojas();
  await carregarVendedores();
})();
