/**
 * CMV › "🤖 Compras com IA": planejamento de compras (open-to-buy) cruzando
 *  - entradas: recebimentos do período consultado no BI (formas de pagamento), em ritmo mensal,
 *    mais as parcelas de cartão que ainda vão cair;
 *  - saídas: TODAS as contas a pagar em aberto (por mês, plano de contas e fornecedor) e, dentro delas,
 *    o que é compra de mercadoria (planos marcados no filtro da Análise CMV);
 *  - grifes: vendas do período no BI + estoque/giro do painel SavWin (Estoque encalhado), se carregado.
 * O BI calcula tudo (grades) e a IA (Gemini) lê o resumo e recomenda: comprar ou não, quanto e de quais grifes.
 */
const cmvIa = { params: { cmvAlvo: 40, reserva: 10, cobertura: 3 }, calc: null, ia: null, carregando: false };
try { Object.assign(cmvIa.params, JSON.parse(localStorage.getItem('bi_cmv_ia_params') || '{}')); } catch { /* sem armazenamento */ }
const cmvIaGradeMeses = new GradeExcel('cmvIaMeses', { nomeArquivo: 'fluxo_compras_mes', porPagina: 50 });
const cmvIaGradeGrifes = new GradeExcel('cmvIaGrifes', { nomeArquivo: 'grifes_compra', porPagina: 100 });
const cmvIaGradePlanos = new GradeExcel('cmvIaPlanos', { nomeArquivo: 'contas_abertas_plano', porPagina: 50 });
const cmvIaGradeRecom = new GradeExcel('cmvIaRecom', { nomeArquivo: 'recomendacao_ia_grifes', porPagina: 100 });

const cmvIaR = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const cmvIaNum = v => (typeof parseNumeroBR === 'function' ? parseNumeroBR(v) : GradeExcel.numeroBR(v)) || 0;
const cmvIaArred = v => Math.round((Number(v) || 0) * 100) / 100;
const cmvIaMesTxt = m => (typeof cmvRotuloMes === 'function' ? cmvRotuloMes(m) : m);
function cmvIaAddMes(m, n) { const [a, b] = m.split('-').map(Number); const d = new Date(a, b - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

function cmvIaParam(k, v) {
  cmvIa.params[k] = Math.max(0, Number(v) || 0);
  try { localStorage.setItem('bi_cmv_ia_params', JSON.stringify(cmvIa.params)); } catch { /* sem armazenamento */ }
  cmvIaCalcular(); cmvIaRenderizar();
}

/** Coluna de fornecedor das contas a pagar. */
function cmvIaCampoFornecedor() {
  const ch = cmvAn.chaves || [];
  for (const re of [/^NOMEFANTASIA$/, /FANTASIA/, /^FORNECEDOR$/, /FORNECEDOR(?!.*COD)/, /RAZAOSOCIAL/]) { const k = ch.find(x => re.test(String(x).toUpperCase())); if (k) return k; }
  return null;
}

// ------------------------------------------------------------------ cálculo
function cmvIaCalcular() {
  const p = cmvIa.params, c = cmvAn.campos || {};
  const consulta = typeof ultimaConsultaBI !== 'undefined' ? ultimaConsultaBI : null;
  const dIni = consulta ? new Date(consulta.inicioISO + 'T00:00') : null, dFim = consulta ? new Date(consulta.fimISO + 'T00:00') : null;
  const dias = dIni && dFim ? Math.max(1, Math.round((dFim - dIni) / 86400000) + 1) : 30;

  // entradas: formas de pagamento do período (recebimentos) e vendas líquidas
  const pg = typeof dadosPagamentosPorLojaGlobal !== 'undefined' ? dadosPagamentosPorLojaGlobal : {};
  let recebido = 0; const formas = [];
  const fimMes = dFim ? `${dFim.getFullYear()}-${String(dFim.getMonth() + 1).padStart(2, '0')}` : null;
  const parcelasFuturas = {};
  Object.values(pg).forEach(g => {
    const v = Object.values(g.lojas || {}).reduce((t, x) => t + (x.vendasValor || 0), 0);
    recebido += v;
    const n = parseInt(String(g.nParcelas || '1'), 10) || 1;
    formas.push({ forma: `${g.meioPagamento} (${g.nParcelas})`, valor: v, parcelas: n });
    if (n > 1 && fimMes) for (let i = 1; i < n; i++) { const m = cmvIaAddMes(fimMes, i); parcelasFuturas[m] = (parcelasFuturas[m] || 0) + v / n; }
  });
  const itens = typeof dadosBrutosGlobaisParaGrafico !== 'undefined' ? dadosBrutosGlobaisParaGrafico : [];
  const vendasLiq = itens.reduce((t, i) => t + cmvIaNum(i.LIQUIDOPRODUTO), 0);
  const base = recebido || vendasLiq;
  const entradaMensal = base * 30 / dias;

  // saídas: contas a pagar em aberto (todas) e mercadoria (planos marcados na Análise CMV)
  const abertas = (cmvAn.linhas || []).filter(l => cmvAberta(l, c));
  const mercadoria = typeof cmvFonte !== 'undefined' ? cmvFonte.filtradas() : abertas;
  const val = l => GradeExcel.numeroBR(l[c.valor]) || 0;
  const porMes = (lista) => { const o = {}; lista.forEach(l => { const m = cmvMes(l); o[m] = (o[m] || 0) + val(l); }); return o; };
  const cMes = porMes(abertas), mMes = porMes(mercadoria);
  const v1 = (document.getElementById('cmvVenc1') || {}).value || '', v2 = (document.getElementById('cmvVenc2') || {}).value || '';
  const meses = [];
  if (v1 && v2) { let m = v1.slice(0, 7); while (m <= v2.slice(0, 7) && meses.length < 24) { meses.push(m); m = cmvIaAddMes(m, 1); } }
  Object.keys(cMes).forEach(m => { if (m !== 'sem data' && !meses.includes(m)) meses.push(m); });
  meses.sort();
  const linhasMes = meses.map(m => {
    const E = entradaMensal, C = cMes[m] || 0, M = mMes[m] || 0;
    const otb = Math.max(0, Math.min(E * p.cmvAlvo / 100 - M, E * (1 - p.reserva / 100) - C));
    return { 'Mês': cmvIaMesTxt(m), mesISO: m, 'Entrada estimada': cmvIaArred(E), 'Parcelas cartão a receber': cmvIaArred(parcelasFuturas[m] || 0),
      'Contas em aberto': cmvIaArred(C), 'Mercadoria em aberto': cmvIaArred(M), 'Outras despesas': cmvIaArred(C - M),
      'Comprometimento %': cmvIaArred(E ? C / E * 100 : 0), 'Folga de caixa': cmvIaArred(E - C), 'Orçamento de compra (OTB)': cmvIaArred(otb) };
  });

  // contas abertas por plano de contas e fornecedor
  const agrupar = (k) => { const o = {}; if (!k) return []; abertas.forEach(l => { const t = String(l[k] ?? '—').trim() || '—'; o[t] = (o[t] || 0) + val(l); }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const planos = agrupar(c.plano), fornecedores = agrupar(cmvIaCampoFornecedor());
  const totalAberto = abertas.reduce((t, l) => t + val(l), 0);

  // grifes: vendas do BI + estoque/giro do painel SavWin
  const gm = new Map();
  const nome = t => String(t || '').trim().toUpperCase();
  itens.forEach(i => {
    const g = nome(i.GRIFE); if (!g) return;
    const o = gm.get(g) || { grife: g, linha: String(i.LINHA || '').trim(), vendas: 0, pecasVendidas: 0 };
    o.vendas += cmvIaNum(i.LIQUIDOPRODUTO); o.pecasVendidas += cmvIaNum(i.QUANTIDADE) || 1; gm.set(g, o);
  });
  const temEstoque = typeof ep !== 'undefined' && ep.dados && Array.isArray(ep.dados.Cobertura);
  if (temEstoque) ep.dados.Cobertura.forEach(e => {
    const g = nome(e.Descricao); if (!g) return;
    const o = gm.get(g) || { grife: g, linha: '', vendas: 0, pecasVendidas: 0 };
    Object.assign(o, { estoque: Number(e.Qtde) || 0, custoEstoque: Number(e.Custo) || 0, giro: Number(e.GiroMensal) || 0,
      cobertura: e.GiroMensal ? (Number(e.Qtde) || 0) / Number(e.GiroMensal) : null, vendido12: Number(e.Vendido) || 0, diasSemVender: e.UltimaVenda ? Number(e.DiasSemVender) : null });
    gm.set(g, o);
  });
  const totVendas = [...gm.values()].reduce((t, o) => t + o.vendas, 0) || 1;
  const grifes = [...gm.values()].map(o => {
    const custoMedio = o.estoque ? o.custoEstoque / o.estoque : null;
    let acao = 'sem dados de estoque', pecas = null;
    if (temEstoque && o.estoque !== undefined) {
      const alvo = o.giro * p.cobertura;
      pecas = Math.max(0, Math.ceil(alvo - o.estoque));
      acao = !o.giro ? 'não comprar (sem giro)' : o.cobertura > 6 ? 'não comprar (estoque alto)' : o.cobertura < p.cobertura ? 'repor' : 'manter';
    } else if (temEstoque) acao = 'sem estoque no painel';
    return { 'Grife': o.grife, 'Linha': o.linha, 'Vendas no período': cmvIaArred(o.vendas), 'Participação %': cmvIaArred(o.vendas / totVendas * 100),
      'Peças vendidas no período': o.pecasVendidas, 'Estoque (peças)': o.estoque ?? '', 'Giro mensal (peças)': o.giro !== undefined ? cmvIaArred(o.giro) : '',
      'Cobertura (meses)': o.cobertura !== null && o.cobertura !== undefined ? cmvIaArred(o.cobertura) : '', 'Ação sugerida': acao,
      'Peças para cobertura alvo': pecas ?? '', 'Valor de compra (custo)': pecas && custoMedio ? cmvIaArred(pecas * custoMedio) : '' };
  }).sort((a, b) => b['Vendas no período'] - a['Vendas no período']);

  cmvIa.calc = { dias, recebido, vendasLiq, entradaMensal, formas, parcelasFuturas, linhasMes, planos, fornecedores, totalAberto,
    totalMercadoria: mercadoria.reduce((t, l) => t + val(l), 0), grifes, temEstoque, qtdAbertas: abertas.length };
}

// ------------------------------------------------------------------ tela
function cmvIaAoAbrir() { if (!cmvIa.carregando) { cmvIaCalcular(); cmvIaRenderizar(); } }

function cmvIaRenderizar() {
  const el = document.getElementById('cmvIa');
  if (!el) return;
  const k = cmvIa.calc, p = cmvIa.params;
  if (!k || !(cmvAn.linhas || []).length) { el.innerHTML = '<p class="gx-vazio">Consulte as contas a pagar (Reconsultar) e as vendas do BI (Consultar) para montar a análise.</p>'; return; }
  const somaMes = c => k.linhasMes.reduce((t, l) => t + (l[c] || 0), 0);
  const nMes = k.linhasMes.length || 1;
  const comprom = k.entradaMensal ? somaMes('Contas em aberto') / (k.entradaMensal * nMes) * 100 : 0;
  const ia = cmvIa.ia;
  const corDec = d => /segurar/i.test(d) ? 'cmv-dec-segurar' : /cautela/i.test(d) ? 'cmv-dec-cautela' : 'cmv-dec-comprar';
  el.innerHTML = `
    <div class="cmv-ia-params">
      <label title="Quanto da venda pode virar compra de mercadoria (custo). Ótica costuma ficar entre 30% e 45%.">CMV alvo (% da venda) <input type="number" min="0" max="100" step="1" value="${p.cmvAlvo}" onchange="cmvIaParam('cmvAlvo', this.value)"></label>
      <label title="Parte da entrada que fica guardada (imprevistos, sazonalidade).">Reserva de caixa (%) <input type="number" min="0" max="100" step="1" value="${p.reserva}" onchange="cmvIaParam('reserva', this.value)"></label>
      <label title="Meses de venda que o estoque de cada grife deve cobrir depois da compra.">Cobertura alvo (meses) <input type="number" min="1" max="12" step="1" value="${p.cobertura}" onchange="cmvIaParam('cobertura', this.value)"></label>
      <button type="button" id="cmvIaBtn" class="btn-comparar-lojas" onclick="cmvIaAnalisar()" ${cmvIa.carregando ? 'disabled' : ''}>${cmvIa.carregando ? '⏳ A IA está analisando…' : '🤖 Analisar com IA'}</button>
    </div>
    <div class="cm-cards">
      <div class="cm-card"><span>Entrada estimada / mês</span><b>${cmvIaR(k.entradaMensal)}</b><small>${k.recebido ? 'recebimentos' : 'vendas líquidas'} de ${k.dias} dias no BI, em ritmo de 30 dias</small></div>
      <div class="cm-card"><span>Contas em aberto</span><b>${cmvIaR(k.totalAberto)}</b><small>${k.qtdAbertas.toLocaleString('pt-BR')} parcelas · mercadoria ${cmvIaR(k.totalMercadoria)}</small></div>
      <div class="cm-card ${comprom > 90 ? 'cmv-alerta' : comprom > 70 ? 'cmv-atencao' : 'destaque'}"><span>Comprometimento médio</span><b>${comprom.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</b><small>das entradas já tem destino (contas em aberto)</small></div>
      <div class="cm-card destaque"><span>Orçamento de compra (OTB)</span><b>${cmvIaR(somaMes('Orçamento de compra (OTB)'))}</b><small>soma dos ${nMes} meses · CMV alvo ${p.cmvAlvo}% · reserva ${p.reserva}%</small></div>
    </div>
    ${ia ? `<div class="cmv-ia-resultado">
      <div class="cmv-ia-topo"><span class="cmv-dec ${corDec(ia.decisao)}">${escHTML(String(ia.decisao || '').toUpperCase())}</span>
        <small>Análise da IA de ${new Date(ia.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${escHTML(ia.modelo || '')}</small></div>
      <p class="cmv-ia-texto">${escHTML(ia.resumo || '')}</p>
      ${(ia.alertas || []).length ? `<div class="cmv-ia-lista cmv-ia-alertas"><b>⚠️ Alertas</b><ul>${ia.alertas.map(a => `<li>${escHTML(a)}</li>`).join('')}</ul></div>` : ''}
      ${(ia.proximosPassos || []).length ? `<div class="cmv-ia-lista"><b>✅ Próximos passos</b><ul>${ia.proximosPassos.map(a => `<li>${escHTML(a)}</li>`).join('')}</ul></div>` : ''}
      ${(ia.orcamento || []).length ? `<h4 class="cmv-ia-h">Orçamento de compra recomendado pela IA</h4><div class="cmv-ia-orc">${ia.orcamento.map(o => `<div class="cm-card"><span>${escHTML(cmvIaMesTxt(String(o.mes || '')))}</span><b>${cmvIaR(o.valor)}</b><small>${escHTML(o.comentario || '')}</small></div>`).join('')}</div>` : ''}
      <h4 class="cmv-ia-h">Grifes · recomendação da IA</h4><div id="cmvIaRecom"></div>
    </div>` : '<p class="cmv-ia-dica">O BI já calculou as grades abaixo. Clique em <b>🤖 Analisar com IA</b> para a recomendação: comprar ou não, quanto por mês e de quais grifes.</p>'}
    <h4 class="cmv-ia-h">Fluxo por mês · entradas × contas em aberto × orçamento de compra</h4><div id="cmvIaMeses"></div>
    <h4 class="cmv-ia-h">Grifes · vendas do período × estoque e giro${k.temEstoque ? '' : ' <small class="cm-nota">(carregue o Estoque encalhado em Avaliação de Produtos para ver estoque, giro e cobertura)</small>'}</h4><div id="cmvIaGrifes"></div>
    <h4 class="cmv-ia-h">Contas em aberto por plano de contas</h4><div id="cmvIaPlanos"></div>`;
  cmvIaGradeMeses.definir(k.linhasMes.map(({ mesISO, ...r }) => r));
  cmvIaGradeGrifes.definir(k.grifes);
  cmvIaGradePlanos.definir(k.planos.map(([pl, v]) => ({ 'Plano de contas': pl, 'Valor em aberto': cmvIaArred(v), 'Participação %': cmvIaArred(v / (k.totalAberto || 1) * 100) })));
  if (ia) cmvIaGradeRecom.definir((ia.grifes || []).map(g => ({ 'Prioridade': g.prioridade ?? '', 'Grife': g.grife || '', 'Ação': g.acao || '', 'Valor sugerido': cmvIaArred(g.valorSugerido), 'Motivo': g.motivo || '' })));
}

/** Resumo compacto (sem dados de cliente) que vai para a IA. */
function cmvIaResumo() {
  const k = cmvIa.calc;
  const consulta = typeof ultimaConsultaBI !== 'undefined' ? ultimaConsultaBI : null;
  return {
    periodoVendas: consulta ? { inicio: consulta.inicioISO, fim: consulta.fimISO, dias: k.dias } : null,
    parametros: { cmvAlvoPercentualDaVenda: cmvIa.params.cmvAlvo, reservaCaixaPercentual: cmvIa.params.reserva, coberturaAlvoMeses: cmvIa.params.cobertura },
    entradas: { recebimentosNoPeriodo: Math.round(k.recebido), vendasLiquidasNoPeriodo: Math.round(k.vendasLiq), entradaMensalEstimada: Math.round(k.entradaMensal),
      formasPagamento: k.formas.sort((a, b) => b.valor - a.valor).slice(0, 15).map(f => ({ forma: f.forma, valor: Math.round(f.valor) })) },
    meses: k.linhasMes.map(l => ({ mes: l.mesISO, entradaEstimada: Math.round(l['Entrada estimada']), parcelasCartaoAReceber: Math.round(l['Parcelas cartão a receber']),
      contasEmAberto: Math.round(l['Contas em aberto']), mercadoriaEmAberto: Math.round(l['Mercadoria em aberto']), comprometimentoPct: Math.round(l['Comprometimento %']),
      folgaCaixa: Math.round(l['Folga de caixa']), otbCalculado: Math.round(l['Orçamento de compra (OTB)']) })),
    contasAbertasTotal: Math.round(k.totalAberto), mercadoriaAbertaTotal: Math.round(k.totalMercadoria),
    porPlanoDeContas: k.planos.slice(0, 20).map(([p, v]) => ({ plano: p, valor: Math.round(v) })),
    porFornecedor: k.fornecedores.slice(0, 20).map(([f, v]) => ({ fornecedor: f, valor: Math.round(v) })),
    estoqueCarregado: k.temEstoque,
    grifes: k.grifes.slice(0, 40).map(g => ({ grife: g['Grife'], linha: g['Linha'], vendasPeriodo: Math.round(g['Vendas no período']), participacaoPct: g['Participação %'],
      estoquePecas: g['Estoque (peças)'], giroMensalPecas: g['Giro mensal (peças)'], coberturaMeses: g['Cobertura (meses)'], acaoCalculada: g['Ação sugerida'],
      pecasParaCoberturaAlvo: g['Peças para cobertura alvo'], valorCompraCusto: g['Valor de compra (custo)'] }))
  };
}

async function cmvIaAnalisar() {
  cmvIaCalcular();
  if (!cmvIa.calc || !(cmvAn.linhas || []).length) { cmvIaRenderizar(); return; }
  cmvIa.carregando = true; cmvIaRenderizar();
  const t0 = Date.now();
  const timer = setInterval(() => { const b = document.getElementById('cmvIaBtn'); if (b) b.textContent = `⏳ A IA está analisando… ${Math.round((Date.now() - t0) / 1000)} s`; }, 500);
  try {
    const resp = await fetchAutenticado('/ia/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumo: cmvIaResumo() }) });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
    cmvIa.ia = j;
  } catch (e) {
    alert('Análise com IA: ' + e.message);
  } finally {
    clearInterval(timer);
    cmvIa.carregando = false;
    cmvIaRenderizar();
  }
}
