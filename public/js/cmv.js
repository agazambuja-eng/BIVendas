/**
 * Aba "🧾 CMV": por enquanto lista as contas a pagar (SavWin ContasPagarPagasGrid)
 * das lojas do usuário, na grade padrão tipo Excel. Vencimento: de hoje a 6 meses
 * (editável), com botão Reconsultar.
 */
const cmvEstado = { carregando: false, quando: '', lojasConsultadas: '' };
const cmvGrade = new GradeExcel('cmvGrade', { nomeArquivo: 'contas_a_pagar', vazio: 'Nenhuma conta a pagar no período.' });

const cmvISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function cmvPeriodoPadrao() {
  const ini = document.getElementById('cmvVenc1'), fim = document.getElementById('cmvVenc2');
  if (!ini || !fim || ini.value) return;
  const hoje = new Date(), seis = new Date(hoje);
  seis.setMonth(seis.getMonth() + 6);
  ini.value = cmvISO(hoje); fim.value = cmvISO(seis);
}
function cmvLojas() {
  const c = typeof ultimaConsultaBI !== 'undefined' && ultimaConsultaBI ? ultimaConsultaBI.lojas : '';
  let lojas = c || (document.getElementById('lojas') || {}).value || '';
  if (!lojas && typeof epLojasDoUsuario === 'function') lojas = epLojasDoUsuario().join(',');
  return String(lojas).split(/[,;\s]+/).map(x => x.replace(/\D/g, '')).filter(Boolean);
}
function cmvStatus(html) {
  const el = document.getElementById('cmvStatus');
  if (!el) return;
  el.innerHTML = html || ''; el.style.display = html ? '' : 'none';
}

/** Ao abrir a aba: se ainda não consultou, consulta. */
function cmvAoAbrir() {
  cmvPeriodoPadrao();
  if (!cmvEstado.quando && !cmvEstado.carregando) cmvConsultar();
}
/** Chamado pelo "Consultar" do BI. */
function cmvAutoCarregar() { cmvPeriodoPadrao(); cmvConsultar(); }

async function cmvConsultar() {
  cmvPeriodoPadrao();
  const v1 = document.getElementById('cmvVenc1').value, v2 = document.getElementById('cmvVenc2').value;
  if (!v1 || !v2) { cmvStatus('Informe o período de vencimento.'); return; }
  if (v1 > v2) { cmvStatus('O vencimento inicial é depois do final.'); return; }
  const lojas = cmvLojas();
  cmvEstado.carregando = true;
  const bt = document.getElementById('cmvBtnConsultar');
  if (bt) { bt.disabled = true; bt.textContent = '⏳ Consultando…'; }
  const t0 = Date.now();
  const timer = setInterval(() => cmvStatus(`⏳ Buscando contas a pagar no SavWin… ${Math.round((Date.now() - t0) / 1000)} s`), 500);
  cmvStatus('⏳ Buscando contas a pagar no SavWin…');
  try {
    const resp = await fetchAutenticado('/consulta-contas-pagar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ LOJAS: lojas.join(','), VENCIMENTO1: v1, VENCIMENTO2: v2 })
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
    cmvEstado.quando = new Date().toISOString();
    cmvEstado.lojasConsultadas = lojas.join(', ');
    cmvGrade.definir(j.linhas || []);
    const info = document.getElementById('cmvInfo');
    if (info) info.textContent = `Consulta de ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · lojas ${lojas.length ? lojas.join(', ') : 'todas'} · vencimento ${v1.split('-').reverse().join('/')} a ${v2.split('-').reverse().join('/')}`;
    cmvStatus('');
  } catch (e) {
    cmvStatus(`⚠️ ${escHTML(e.message)}`);
  } finally {
    clearInterval(timer);
    cmvEstado.carregando = false;
    if (bt) { bt.disabled = false; bt.textContent = '🔄 Reconsultar'; }
  }
}
