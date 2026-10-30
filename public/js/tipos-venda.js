/**
 * Filtro "Tipos de venda" (ao lado das datas).
 * Lista com caixinhas, todas marcadas por padrão. As vendas cujo TIPOVENDA
 * estiver desmarcado não entram no BI (dashboard, metas, vendedores,
 * produtos, comparativo e detalhes).
 *
 * - Ao "Aplicar", recalcula com os dados da última consulta, sem chamar a API.
 * - A escolha fica guardada neste navegador.
 * - Tipos que aparecerem nos dados e não estiverem na lista entram sozinhos.
 * - A API de pagamentos não informa o tipo de venda: as roscas de forma de
 *   pagamento não são afetadas.
 */

const TIPOS_VENDA_PADRAO = [
  'VENDA S/ CONFERENCIA', 'VENDA C/ CONFERENCIA', 'BRINDE CORTESIA', 'BUSQUE VISAO', 'GARANTIA',
  'TROCA', 'BUSQUE VENDA', 'SEGUNDO PAR', 'MEU 1° 50', 'COMBO RBA LUXOTTICA', 'WEB / E-COMMERCE',
  'LEADS', 'ZEISS WEEK', 'WHATSAPP VENDA', 'ORCAMENTO', 'GARANTIA ZEISS', 'DEVOLUCAO',
  'AJUSTE-MANUTENCAO', 'GARANTIA EMBRAPOL', 'VD - CM', 'PROJETO SOCIAL'
];
const CHAVE_TIPOS_DESMARCADOS = 'bi_tipos_venda_desmarcados';
const SEM_TIPO = '(SEM TIPO)';

let tiposVendaConhecidos = [...TIPOS_VENDA_PADRAO];
let tiposVendaDesmarcados = new Set(lerTiposDesmarcados());
let ultimaRespostaAPI = null;   // { dadosBrutos, dadosPagamentos } da última consulta

/** "BRINDE  CORTESIA " -> "BRINDE CORTESIA" (espaços e maiúsculas não atrapalham) */
function normalizarTipoVenda(t) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  return s || SEM_TIPO;
}

function lerTiposDesmarcados() {
  try { return JSON.parse(localStorage.getItem(CHAVE_TIPOS_DESMARCADOS) || '[]'); } catch { return []; }
}
function salvarTiposDesmarcados() {
  try { localStorage.setItem(CHAVE_TIPOS_DESMARCADOS, JSON.stringify([...tiposVendaDesmarcados])); } catch { /* sem armazenamento */ }
}

/** true = a venda entra no BI */
function tipoVendaPermitido(item) {
  return !tiposVendaDesmarcados.has(normalizarTipoVenda(item && item.TIPOVENDA));
}

/** Acrescenta à lista os tipos que vieram na API e ainda não estavam nela. */
function registrarTiposDosDados(dados) {
  const conhecidos = new Set(tiposVendaConhecidos.map(normalizarTipoVenda));
  (dados || []).forEach(item => {
    const t = normalizarTipoVenda(item.TIPOVENDA);
    if (!conhecidos.has(t)) { conhecidos.add(t); tiposVendaConhecidos.push(t); }
  });
  renderizarListaTiposVenda();
}

function contagemTiposNosDados() {
  const cont = {};
  ((ultimaRespostaAPI && ultimaRespostaAPI.dadosBrutos) || []).forEach(item => {
    const t = normalizarTipoVenda(item.TIPOVENDA);
    cont[t] = (cont[t] || 0) + 1;
  });
  return cont;
}

function atualizarResumoTiposVenda() {
  const btn = document.getElementById('btnTiposVenda');
  if (!btn) return;
  const total = tiposVendaConhecidos.length;
  const fora = tiposVendaConhecidos.filter(t => tiposVendaDesmarcados.has(normalizarTipoVenda(t))).length;
  btn.querySelector('.tv-resumo').textContent = fora === 0 ? `Todos (${total})` : `${total - fora} de ${total}`;
  btn.classList.toggle('tv-filtrando', fora > 0);
}

function renderizarListaTiposVenda() {
  const lista = document.getElementById('listaTiposVenda');
  if (!lista) return;
  const cont = contagemTiposNosDados();
  const busca = (document.getElementById('buscaTiposVenda')?.value || '').trim().toUpperCase();
  lista.innerHTML = tiposVendaConhecidos
    .filter(t => !busca || normalizarTipoVenda(t).includes(busca))
    .map(t => {
      const n = normalizarTipoVenda(t);
      const qtd = cont[n] || 0;
      return `<label class="tv-item ${qtd ? '' : 'tv-sem-dados'}">
        <input type="checkbox" value="${escHTML(n)}" ${tiposVendaDesmarcados.has(n) ? '' : 'checked'}>
        <span>${escHTML(t)}</span>
        ${ultimaRespostaAPI ? `<small>${qtd}</small>` : ''}
      </label>`;
    }).join('');
  atualizarResumoTiposVenda();
}

function abrirFiltroTiposVenda(e) {
  if (e) e.stopPropagation();
  const painel = document.getElementById('painelTiposVenda');
  const abrir = painel.style.display !== 'block';
  painel.style.display = abrir ? 'block' : 'none';
  if (abrir) renderizarListaTiposVenda();
}

function fecharFiltroTiposVenda() {
  const painel = document.getElementById('painelTiposVenda');
  if (painel) painel.style.display = 'none';
}

function marcarTodosTiposVenda(marcar) {
  document.querySelectorAll('#listaTiposVenda input[type=checkbox]').forEach(cb => { cb.checked = marcar; });
}

/** Lê as caixinhas, guarda e recalcula o BI com os dados já carregados. */
function aplicarFiltroTiposVenda() {
  document.querySelectorAll('#listaTiposVenda input[type=checkbox]').forEach(cb => {
    if (cb.checked) tiposVendaDesmarcados.delete(cb.value);
    else tiposVendaDesmarcados.add(cb.value);
  });
  salvarTiposDesmarcados();
  atualizarResumoTiposVenda();
  fecharFiltroTiposVenda();

  if (ultimaRespostaAPI && typeof processarDadosBI === 'function') {
    if (typeof limparComparativo === 'function') limparComparativo();
    const abaAtual = document.querySelector('#biTabsHeader button.aba-ativa');
    processarDadosBI(ultimaRespostaAPI.dadosBrutos, ultimaRespostaAPI.dadosPagamentos);
    if (abaAtual) abaAtual.click();   // continua na aba em que a pessoa estava
  }
}

/** Texto curto dos tipos desmarcados (para avisos e para a chave do comparativo). */
function descricaoFiltroTiposVenda() {
  return [...tiposVendaDesmarcados].sort().join('|');
}

document.addEventListener('click', e => {
  const caixa = document.getElementById('filtroTiposVenda');
  if (caixa && !caixa.contains(e.target)) fecharFiltroTiposVenda();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharFiltroTiposVenda(); });
document.addEventListener('DOMContentLoaded', renderizarListaTiposVenda);
