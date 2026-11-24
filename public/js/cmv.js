/**
 * Aba "🧾 CMV": por enquanto lista as contas a pagar (SavWin ContasPagarPagasGrid)
 * das lojas do usuário, na grade padrão tipo Excel. Vencimento: de hoje a 6 meses
 * (editável), com botão Reconsultar.
 */
const cmvEstado = { carregando: false, quando: '', lojasConsultadas: '' };
/* Relatório: STATUS logo depois da LOJA e, ao consultar, já filtrado em EM ABERTO e RENEGOCIAÇÃO.
 * O filtro de PLANO DE CONTAS é um só para o Relatório e a Análise (muda num, muda no outro). */
const cmvGrade = new GradeExcel('cmvGrade', {
  nomeArquivo: 'contas_a_pagar', vazio: 'Nenhuma conta a pagar no período.', primeiras: ['LOJA', 'STATUS'],
  aoFiltrar: g => cmvSincronizarPlano(g)
});
/** Situações que entram já marcadas no Relatório. */
const CMV_SITUACOES_PADRAO = /ABERT|RENEG/i;
function cmvStatusPadrao() {
  const col = cmvGrade.colunas.find(c => /^STATUS$/i.test(c.chave));
  if (!col) return;
  const valores = [...new Set(cmvGrade.linhas.map(l => cmvGrade.texto(col, l)))];
  const fora = valores.filter(v => !CMV_SITUACOES_PADRAO.test(v));
  if (fora.length) cmvGrade.filtros[col.chave] = new Set(fora); else delete cmvGrade.filtros[col.chave];
}
/** Copia o filtro de plano de contas de uma grade para a outra e guarda no navegador. */
function cmvSincronizarPlano(origem) {
  const k = (typeof cmvAn !== 'undefined' && cmvAn.campos && cmvAn.campos.plano) || 'PLANOCONTAS';
  const destino = origem === cmvGrade ? (typeof cmvFonte !== 'undefined' ? cmvFonte : null) : cmvGrade;
  if (!destino) return;
  if (origem.filtros[k] && origem.filtros[k].size) destino.filtros[k] = new Set(origem.filtros[k]); else delete destino.filtros[k];
  try {
    const guardado = JSON.parse(localStorage.getItem('bi_cmv_filtros') || '{}');
    if (origem.filtros[k] && origem.filtros[k].size) guardado[k] = [...origem.filtros[k]]; else delete guardado[k];
    localStorage.setItem('bi_cmv_filtros', JSON.stringify(guardado));
  } catch { /* sem armazenamento */ }
  destino.renderizar();
}

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
    cmvStatusPadrao();
    { const kp = 'PLANOCONTAS'; try { const g = JSON.parse(localStorage.getItem('bi_cmv_filtros') || '{}'); if (Array.isArray(g[kp]) && g[kp].length) cmvGrade.filtros[kp] = new Set(g[kp]); } catch { /* sem armazenamento */ } }
    cmvGrade.renderizar();
    cmvAnaliseDefinir(j.linhas || []);
    if (typeof cmvIaRegistrarDaConsulta === 'function') { if (!cmvIa.configCarregada) cmvIaCarregarConfig().then(cmvIaRegistrarDaConsulta); else cmvIaRegistrarDaConsulta(); }
    if (typeof cmvIaAoAbrir === 'function' && document.getElementById('cmvPainelIa')?.style.display !== 'none') cmvIaAoAbrir();
    const info = document.getElementById('cmvInfo');
    if (info) info.textContent = (j.planosRestritos ? '🔒 Só os planos de contas liberados para você · ' : '') + `Consulta de ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · lojas ${lojas.length ? lojas.join(', ') : 'todas'} · vencimento ${v1.split('-').reverse().join('/')} a ${v2.split('-').reverse().join('/')}`;
    cmvStatus('');
  } catch (e) {
    cmvStatus(`⚠️ ${escHTML(e.message)}`);
  } finally {
    clearInterval(timer);
    cmvEstado.carregando = false;
    if (bt) { bt.disabled = false; bt.textContent = '🔄 Reconsultar'; }
  }
}

// ================================================================ sub-abas
function cmvSubaba(s) {
  document.querySelectorAll('#cmvSubabas button').forEach(b => b.classList.toggle('ativo', b.dataset.s === s));
  document.getElementById('cmvPainelAnalise').style.display = s === 'analise' ? '' : 'none';
  document.getElementById('cmvPainelRelatorio').style.display = s === 'relatorio' ? '' : 'none';
  const ia = document.getElementById('cmvPainelIa');
  if (ia) ia.style.display = s === 'ia' ? '' : 'none';
  if (s === 'ia' && typeof cmvIaAoAbrir === 'function') cmvIaAoAbrir();
}

// ================================================================ Análise CMV
/*
 * Loja × mês de vencimento, somando o valor das parcelas EM ABERTO, só dos planos de contas marcados
 * (filtro tipo Excel, lembrado no navegador). As colunas da API são reconhecidas pelo nome; se o
 * nome for outro, dá para escolher em "⚙ Campos".
 */
const CMV_CAMPOS = {
  loja: { rot: 'Loja', padroes: [/^LOJA$/, /^LOJANOME$/, /LOJA/, /FILIAL/, /EMPRESA/, /^FILID$/] },
  plano: { rot: 'Plano de contas', padroes: [/^PLANOCONTAS$/, /PLANO.*CONTA/, /PLANO/] },
  venc: { rot: 'Vencimento', padroes: [/^PARVENCIMENTO$/, /PARVENC/, /VENCIMENTO/, /VENC/] },
  valor: { rot: 'Valor', padroes: [/^PARVALOR$/, /^VALORPARCELA$/, /^PARVALORPARCELA$/, /^VALOR$/, /VALORPARC/, /VALORDOC|VALORTITULO|VALORORIGINAL/, /^(?!.*(PAGO|MULTA|JURO|DESC|ACRES|BAIX)).*VALOR/] },
  situacao: { rot: 'Situação (aberta/paga)', padroes: [/^STATUS$/, /SITUACAO/, /STATUS/, /^(PAR)?DATAPAGAMENTO$/, /DTPAGAMENTO|DATABAIXA|DATAQUITACAO|PAGAMENTO$/, /VALORPAGO|PAGO$/] }
};
const cmvAn = { linhas: [], campos: {}, escolhidos: {}, verCampos: false };
try { cmvAn.escolhidos = JSON.parse(localStorage.getItem('bi_cmv_campos') || '{}'); } catch { /* sem armazenamento */ }

/** Fonte filtrável (só para o filtro tipo Excel do plano de contas / loja). */
const cmvFonte = new GradeExcel('cmvAnaliseFonteOculta', {
  aoFiltrar: g => {
    try { localStorage.setItem('bi_cmv_filtros', JSON.stringify(Object.fromEntries(Object.entries(g.filtros).map(([k, s]) => [k, [...s]])))); } catch { /* sem armazenamento */ }
    cmvSincronizarPlano(g);      // o mesmo filtro de plano vale no Relatório
  }
});
cmvFonte.renderizar = () => cmvAnaliseRenderizar();
try { Object.entries(JSON.parse(localStorage.getItem('bi_cmv_filtros') || '{}')).forEach(([k, v]) => { cmvFonte.filtros[k] = new Set(v); }); } catch { /* sem armazenamento */ }

function cmvDetectarCampos(chaves) {
  const c = {};
  Object.entries(CMV_CAMPOS).forEach(([id, def]) => {
    const esc = cmvAn.escolhidos[id];
    if (esc && chaves.includes(esc)) { c[id] = esc; return; }
    for (const re of def.padroes) { const k = chaves.find(x => re.test(String(x).toUpperCase())); if (k) { c[id] = k; break; } }
  });
  return c;
}

/** A parcela está em aberto? Pela coluna de situação: texto (ABERTO/PAGO), data de pagamento vazia ou valor pago < valor. */
function cmvAberta(l, c) {
  const k = c.situacao;
  if (!k) return true;
  const v = l[k];
  const nome = k.toUpperCase();
  if (/VALORPAGO|PAGO$/.test(nome)) return (GradeExcel.numeroBR(v) || 0) < (GradeExcel.numeroBR(l[c.valor]) || 0) - 0.005;
  if (/DATA|DT|PAGAMENTO|BAIXA|QUITA/.test(nome)) return !GradeExcel.dataBR(v);
  const t = String(v ?? '').toUpperCase();
  if (/PAGO|PAGA\b|QUITAD|BAIXAD|LIQUIDAD|CANCEL/.test(t) && !/PARCIAL/.test(t)) return false;
  return true;
}

function cmvAnaliseDefinir(linhas) {
  cmvAn.linhas = Array.isArray(linhas) ? linhas : [];
  const chaves = [];
  cmvAn.linhas.slice(0, 300).forEach(l => Object.keys(l || {}).forEach(k => { if (!chaves.includes(k)) chaves.push(k); }));
  cmvAn.chaves = chaves;
  cmvAn.campos = cmvDetectarCampos(chaves);
  cmvAnaliseFonte();
}
/** Monta a fonte filtrável: só parcelas em aberto. */
function cmvAnaliseFonte() {
  const c = cmvAn.campos;
  const abertas = cmvAn.linhas.filter(l => cmvAberta(l, c));
  const filtrosGuardados = cmvFonte.filtros;
  cmvFonte.definir(abertas);            // chama renderizar() = cmvAnaliseRenderizar
  cmvFonte.filtros = filtrosGuardados;  // definir() descarta filtros de colunas que não existem
  cmvAnaliseRenderizar();
}

function cmvEscolherCampo(id, k) {
  if (k) cmvAn.escolhidos[id] = k; else delete cmvAn.escolhidos[id];
  try { localStorage.setItem('bi_cmv_campos', JSON.stringify(cmvAn.escolhidos)); } catch { /* sem armazenamento */ }
  cmvAn.campos = cmvDetectarCampos(cmvAn.chaves || []);
  cmvAnaliseFonte();
}

function cmvMes(l) {
  const d = GradeExcel.dataBR(l[cmvAn.campos.venc]);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'sem data';
}
const CMV_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const cmvRotuloMes = m => m === 'sem data' ? m : `${CMV_MESES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`;

function cmvAnaliseRenderizar() {
  const el = document.getElementById('cmvAnalise');
  if (!el) return;
  if (!cmvAn.linhas.length) { el.innerHTML = '<p class="gx-vazio">Nenhuma conta a pagar no período.</p>'; return; }
  const c = cmvAn.campos;
  const falta = ['loja', 'venc', 'valor'].filter(k => !c[k]);
  const plano = c.plano;
  const rows = cmvFonte.filtradas();
  const lojas = new Map(), meses = new Set();
  rows.forEach(l => {
    const loja = String(l[c.loja] ?? '—').trim() || '—', mes = cmvMes(l), v = GradeExcel.numeroBR(l[c.valor]) || 0;
    meses.add(mes);
    if (!lojas.has(loja)) lojas.set(loja, new Map());
    const m = lojas.get(loja); m.set(mes, (m.get(mes) || 0) + v);
  });
  const ms = [...meses].sort();
  const anos = [];
  ms.forEach(m => { const a = m.slice(0, 4); const u = anos[anos.length - 1]; if (u && u.ano === a) u.n++; else anos.push({ ano: a, n: 1 }); });
  const R = v => v ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
  const totMes = ms.map(m => [...lojas.values()].reduce((t, x) => t + (x.get(m) || 0), 0));
  const totGeral = totMes.reduce((a, b) => a + b, 0);
  const nPlanos = plano ? new Set(cmvFonte.linhas.map(l => cmvFonte.texto({ chave: plano, tipo: 'texto' }, l))).size : 0;
  const presentes = plano ? new Set(cmvFonte.linhas.map(l => cmvFonte.texto({ chave: plano, tipo: 'texto' }, l))) : new Set();
  const desm = plano && cmvFonte.filtros[plano] ? [...cmvFonte.filtros[plano]].filter(p => presentes.has(p)).length : 0;
  const btn = (k, rot) => k ? `<button type="button" class="cmv-filtro-btn${cmvFonte.filtros[k] && cmvFonte.filtros[k].size ? ' ativo' : ''}" onclick="cmvFonte.abrirFiltro(event, ${escHTML(JSON.stringify(k))})">${rot} ▾</button>` : '';
  const ordemLojas = [...lojas.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  el.innerHTML = `
    <div class="cmv-an-barra">
      ${btn(plano, `📂 Plano de contas ${desm ? `(${nPlanos - desm} de ${nPlanos})` : '(todos)'}`)}
      ${btn(c.loja, '🏬 Loja')}
      <span class="gx-contador">${rows.length.toLocaleString('pt-BR')} parcelas em aberto · soma do valor por mês de vencimento</span>
      <button type="button" class="tv-link" onclick="cmvAn.verCampos = !cmvAn.verCampos; cmvAnaliseRenderizar()">⚙ Campos</button>
      <span class="ep-exportar">⬇ Exportar <button type="button" class="tv-link" onclick="cmvAnaliseExportar('xlsx')">Excel</button> · <button type="button" class="tv-link" onclick="cmvAnaliseExportar('csv')">CSV</button></span>
    </div>
    ${cmvAn.verCampos || falta.length ? `<div class="cmv-campos">${falta.length ? `<b>⚠️ Não reconheci a coluna de ${falta.map(k => CMV_CAMPOS[k].rot.toLowerCase()).join(', ')}: escolha abaixo.</b><br>` : ''}
      ${Object.entries(CMV_CAMPOS).map(([id, d]) => `<label>${d.rot} <select onchange="cmvEscolherCampo('${id}', this.value)"><option value="">${c[id] && !cmvAn.escolhidos[id] ? `automático (${escHTML(c[id])})` : 'automático'}</option>${(cmvAn.chaves || []).map(k => `<option value="${escHTML(k)}" ${cmvAn.escolhidos[id] === k ? 'selected' : ''}>${escHTML(k)}</option>`).join('')}</select></label>`).join('')}
      <small>Em aberto: ${c.situacao ? `pela coluna <b>${escHTML(c.situacao)}</b> (texto pago/quitado = paga; data de pagamento preenchida = paga; valor pago ≥ valor = paga)` : 'sem coluna de situação, considera todas'}.</small></div>` : ''}
    ${falta.length ? '' : `<div class="gx-rolagem">
      <table class="gx-tabela cmv-pivo">
        <thead>
          <tr><th rowspan="2">Loja</th>${anos.map(a => `<th colspan="${a.n}" class="cmv-ano">${a.ano}</th>`).join('')}<th rowspan="2" class="gx-num">Total</th></tr>
          <tr>${ms.map(m => `<th class="gx-num">${cmvRotuloMes(m)}</th>`).join('')}</tr>
        </thead>
        <tbody>${ordemLojas.map(lj => { const m = lojas.get(lj); const t = ms.reduce((s, x) => s + (m.get(x) || 0), 0);
          return `<tr><td>${escHTML(lj)}</td>${ms.map(x => `<td class="gx-num">${R(m.get(x))}</td>`).join('')}<td class="gx-num"><b>${R(t)}</b></td></tr>`; }).join('')}</tbody>
        <tfoot><tr><td>Total geral</td>${totMes.map(v => `<td class="gx-num">${R(v)}</td>`).join('')}<td class="gx-num">${R(totGeral)}</td></tr></tfoot>
      </table>
    </div>`}`;
}

function cmvAnaliseExportar(formato) {
  const c = cmvAn.campos;
  const rows = cmvFonte.filtradas();
  const meses = [...new Set(rows.map(cmvMes))].sort();
  const porLoja = new Map();
  rows.forEach(l => { const lj = String(l[c.loja] ?? '—').trim() || '—'; if (!porLoja.has(lj)) porLoja.set(lj, {}); const o = porLoja.get(lj); const m = cmvMes(l); o[m] = (o[m] || 0) + (GradeExcel.numeroBR(l[c.valor]) || 0); });
  const cab = ['Loja', ...meses.map(cmvRotuloMes), 'Total'];
  const linhas = [...porLoja.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))
    .map(([lj, o]) => [lj, ...meses.map(m => Math.round((o[m] || 0) * 100) / 100), Math.round(meses.reduce((t, m) => t + (o[m] || 0), 0) * 100) / 100]);
  linhas.push(['Total geral', ...meses.map(m => Math.round(linhas.reduce((t, l) => t + l[meses.indexOf(m) + 1], 0) * 100) / 100), Math.round(linhas.reduce((t, l) => t + l[l.length - 1], 0) * 100) / 100]);
  if (typeof epBaixarPlanilha === 'function') epBaixarPlanilha(cab, linhas, 'analise_cmv', formato, cab.slice(1));
}
