/**
 * Aba METAS - compara o valor líquido vendido por loja com a meta do mês
 * cadastrada na tabela `metas_loja` do Supabase (projeto BIVendas).
 *
 * Tabela esperada (public.metas_loja):
 *   codigo      int4     -> código da loja (ex.: 520)
 *   descricao   text     -> nome da loja
 *   valor_meta  numeric  -> meta em R$
 *   competencia int4     -> AAAAMM (ex.: 202610 = outubro/2026)
 */

// Projeto Supabase onde ficam as metas. A chave publishable pode ficar no
// navegador: a tabela só permite LEITURA para esta chave (política RLS).
const METAS_SUPABASE_URL = 'https://uumttubexjtgzeualqnz.supabase.co';
const METAS_SUPABASE_KEY = 'sb_publishable_o177jMO-LmlRF6sY-cx4tA_fv5KIEKa';

const metasClient = supabase.createClient(METAS_SUPABASE_URL, METAS_SUPABASE_KEY);
const graficosMetas = {};          // canvasId -> instância Chart
let ultimosTotaisPorLoja = null;   // para recarregar a aba após editar metas

const COR_META = '#adb5bd';
const COR_ACIMA = '#28a745';
const COR_ABAIXO = '#d9534f';
const COR_SEM_META = '#0078d7';

/** "2026-10-01" + "2026-11-15" -> [202610, 202611] */
function competenciasDoPeriodo(dataIniISO, dataFimISO) {
  if (!dataIniISO) return [];
  const [ai, mi] = dataIniISO.split('-').map(Number);
  const [af, mf] = (dataFimISO || dataIniISO).split('-').map(Number);
  const lista = [];
  let ano = ai, mes = mi;
  while (ano < af || (ano === af && mes <= mf)) {
    lista.push(ano * 100 + mes);
    mes++;
    if (mes > 12) { mes = 1; ano++; }
    if (lista.length > 24) break; // proteção contra períodos enormes
  }
  return lista;
}

function nomeCompetencia(c) {
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[(c % 100) - 1]}/${Math.floor(c / 100)}`;
}

function formatarPct(v) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

function escaparHTML(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function mostrarAvisoMetas(mensagem) {
  const aviso = document.getElementById('avisoMetas');
  if (!aviso) return;
  aviso.innerHTML = mensagem || '';
  aviso.style.display = mensagem ? 'block' : 'none';
}

/**
 * Chamada ao fim de processarDadosBI.
 * @param {Object} totaisPorLoja - { "520": { liquido, bruto, desconto }, ... }
 */
async function renderizarMetas(totaisPorLoja) {
  ultimosTotaisPorLoja = totaisPorLoja;
  const dataIni = document.getElementById('dataInicial').value;
  const dataFim = document.getElementById('dataFinal').value;
  const competencias = competenciasDoPeriodo(dataIni, dataFim);

  const subtitulo = document.getElementById('subtituloMetas');
  if (subtitulo) {
    subtitulo.textContent = competencias.length
      ? `Período ${formatarDataISOparaBR(dataIni)} a ${formatarDataISOparaBR(dataFim)} · metas de ${competencias.map(nomeCompetencia).join(', ')}`
      : 'Informe a data inicial para buscar as metas.';
  }

  if (METAS_SUPABASE_KEY.startsWith('COLE_AQUI')) {
    mostrarAvisoMetas('⚠️ Chave do Supabase das metas ainda não configurada em <code>public/js/metas.js</code>.');
    return;
  }
  if (!competencias.length) return;

  // Lojas digitadas no filtro (se vazio, considera todas que têm meta)
  const lojasFiltro = document.getElementById('lojas').value
    .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

  let query = metasClient
    .from('metas_loja')
    .select('*')   // '*' para não quebrar se alguma coluna nova ainda não existir
    .in('competencia', competencias);
  if (lojasFiltro.length) query = query.in('codigo', lojasFiltro);

  const { data: metas, error } = await query;
  if (error) {
    mostrarAvisoMetas('❌ Erro ao buscar metas no Supabase: ' + escaparHTML(error.message));
    return;
  }

  // Junta metas (somando se o período cobrir mais de um mês) + realizado da API
  const porLoja = {};
  (metas || []).forEach(m => {
    const id = String(m.codigo);
    if (!porLoja[id]) porLoja[id] = novoRegistroLoja(id, m.descricao);
    porLoja[id].meta += Number(m.valor_meta) || 0;
    porLoja[id].metaVendedor += Number(m.valor_meta_vendedor) || 0;
    // Ticket é média, não soma: se o período cobrir 2 meses, usa a média das metas
    if (Number(m.valor_meta_ticket) > 0) {
      porLoja[id].metaTicketSoma += Number(m.valor_meta_ticket);
      porLoja[id].metaTicketQtd++;
    }
    if (m.descricao) porLoja[id].descricao = m.descricao;
  });
  Object.keys(totaisPorLoja || {}).forEach(id => {
    if (!porLoja[id]) porLoja[id] = novoRegistroLoja(id, '');
    porLoja[id].realizado = totaisPorLoja[id].liquido || 0;
  });

  const lista = Object.values(porLoja).map(l => ({
    ...l,
    atingimento: l.meta > 0 ? (l.realizado / l.meta) * 100 : null,
  }));
  // Com meta primeiro, ordenadas pelo maior atingimento
  lista.sort((a, b) => (b.atingimento ?? -1) - (a.atingimento ?? -1));

  if (!metas || metas.length === 0) {
    mostrarAvisoMetas(`Nenhuma meta encontrada para ${competencias.map(nomeCompetencia).join(', ')}` +
      (lojasFiltro.length ? ` nas lojas ${lojasFiltro.join(', ')}` : '') +
      '. Confira a tabela <code>metas_loja</code> e a política de leitura (RLS).');
  } else {
    const semMeta = lista.filter(l => l.atingimento === null).map(l => l.id);
    mostrarAvisoMetas(semMeta.length ? `Lojas com venda mas sem meta cadastrada: ${semMeta.join(', ')}` : '');
  }

  renderizarCardsMetas(lista);
  renderizarGraficoComparativo('graficoMetas', lista, rotuloLoja);
  renderizarTabelaComparativo('tabelaMetasCorpo', lista,
    l => `${escaparHTML(l.id)}${l.descricao ? ' – ' + escaparHTML(l.descricao) : ''}`);

  renderizarMetasTicket(porLoja);
  renderizarMetasVendedores(porLoja);
}

function novoRegistroLoja(id, descricao) {
  return { id, descricao, meta: 0, metaVendedor: 0, metaTicketSoma: 0, metaTicketQtd: 0, realizado: 0 };
}

/**
 * Ticket médio por loja = valor líquido ÷ quantidade de vendas (OS com valor
 * bruto > 0), mesma regra do card "Ticket Médio" da aba Visão Geral.
 * Meta: coluna valor_meta_ticket da metas_loja (opcional).
 */
function renderizarMetasTicket(porLoja) {
  const osPorLoja = {};
  const liquidoPorLoja = {};
  (typeof dadosBrutosGlobaisParaGrafico !== 'undefined' ? dadosBrutosGlobaisParaGrafico : []).forEach(item => {
    const textoLoja = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? '').trim();
    const m = textoLoja.match(/^0*(\d+)/);
    const idLoja = m ? m[1] : textoLoja;
    liquidoPorLoja[idLoja] = (liquidoPorLoja[idLoja] || 0) + parseNumeroBR(item.LIQUIDOPRODUTO);
    const os = String(item.OS || '').trim();
    if (os) {
      if (!osPorLoja[idLoja]) osPorLoja[idLoja] = {};
      osPorLoja[idLoja][os] = (osPorLoja[idLoja][os] || 0) + parseNumeroBR(item.VALORBRUTOPRODUTO);
    }
  });

  const lista = Object.keys(liquidoPorLoja).map(id => {
    const qtdVendas = Object.values(osPorLoja[id] || {}).filter(v => v > 0).length;
    const ticket = qtdVendas > 0 ? liquidoPorLoja[id] / qtdVendas : 0;
    const reg = porLoja[id] || novoRegistroLoja(id, '');
    const metaTicket = reg.metaTicketQtd > 0 ? reg.metaTicketSoma / reg.metaTicketQtd : 0;
    return {
      id, descricao: reg.descricao, qtdVendas,
      meta: metaTicket, realizado: ticket,
      atingimento: metaTicket > 0 ? (ticket / metaTicket) * 100 : null
    };
  });
  lista.sort((a, b) => b.realizado - a.realizado);

  const totalLiquido = Object.values(liquidoPorLoja).reduce((s, v) => s + v, 0);
  const totalVendas = lista.reduce((s, l) => s + l.qtdVendas, 0);
  const ticketRede = totalVendas > 0 ? totalLiquido / totalVendas : 0;
  const comMeta = lista.filter(l => l.atingimento !== null);
  const naMeta = comMeta.filter(l => l.atingimento >= 100).length;

  const resumo = document.getElementById('resumoMetasTicket');
  if (resumo) {
    resumo.innerHTML = lista.length
      ? `Ticket médio da rede: <strong>${formatarMoedaBR(ticketRede)}</strong> (${totalVendas} vendas)` +
        (comMeta.length ? ` · ${naMeta} de ${comMeta.length} loja(s) na meta de ticket` : ' · nenhuma meta de ticket cadastrada')
      : 'Nenhuma venda no período.';
  }

  renderizarGraficoComparativo('graficoMetasTicket', lista, rotuloLoja, null, 'Ticket médio');
}

/**
 * Meta individual: cada vendedor da loja é comparado com o valor_meta_vendedor
 * daquela loja no mês. Vendas vêm de dadosBrutosGlobaisParaGrafico (main.js).
 */
function renderizarMetasVendedores(porLoja) {
  const vendas = {};
  (typeof dadosBrutosGlobaisParaGrafico !== 'undefined' ? dadosBrutosGlobaisParaGrafico : []).forEach(item => {
    const textoLoja = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? '').trim();
    const m = textoLoja.match(/^0*(\d+)/);
    const idLoja = m ? m[1] : textoLoja;
    const vendedor = String(item.VENDEDOR || 'SEM VENDEDOR').trim().toUpperCase();
    const chave = idLoja + '|' + vendedor;
    if (!vendas[chave]) vendas[chave] = { idLoja, vendedor, realizado: 0 };
    vendas[chave].realizado += parseNumeroBR(item.LIQUIDOPRODUTO);
  });

  const lista = Object.values(vendas).map(v => {
    const meta = porLoja[v.idLoja] ? porLoja[v.idLoja].metaVendedor : 0;
    return { ...v, meta, atingimento: meta > 0 ? (v.realizado / meta) * 100 : null };
  });
  // Agrupado por loja (código crescente); dentro da loja, maior atingimento primeiro
  lista.sort((a, b) =>
    (Number(a.idLoja) - Number(b.idLoja)) || String(a.idLoja).localeCompare(String(b.idLoja)) ||
    ((b.atingimento ?? -1) - (a.atingimento ?? -1)) || (b.realizado - a.realizado));

  const comMeta = lista.filter(l => l.meta > 0);
  const acima = comMeta.filter(l => l.atingimento >= 100).length;
  const resumo = document.getElementById('resumoMetasVendedores');
  if (resumo) {
    resumo.textContent = lista.length
      ? `${acima} de ${comMeta.length} vendedor(es) com meta atingiram o objetivo` +
        (lista.length > comMeta.length ? ` · ${lista.length - comMeta.length} sem meta individual na loja` : '')
      : 'Nenhuma venda por vendedor no período.';
  }

  // Gráfico ganha largura conforme a quantidade de vendedores (rolagem horizontal)
  const area = document.getElementById('areaGraficoMetasVendedores');
  if (area) area.style.width = Math.max(lista.length * 120, 600) + 'px';

  renderizarGraficoComparativo('graficoMetasVendedores', lista, rotuloVendedor, l => l.idLoja);
  renderizarTabelaVendedoresPorLoja(lista, porLoja);
}

function rotuloVariacao(l) {
  if (l.atingimento === null) return 'sem meta';
  const dif = l.atingimento - 100;
  return dif >= 0 ? `▲ ${formatarPct(dif)} acima` : `▼ ${formatarPct(Math.abs(dif))} abaixo`;
}

function rotuloVendedor(l) {
  return [l.vendedor, rotuloVariacao(l)];
}

/** Tabela de vendedores com um cabeçalho e um subtotal por loja. */
function renderizarTabelaVendedoresPorLoja(lista, porLoja) {
  const corpo = document.getElementById('tabelaMetasVendedoresCorpo');
  if (!corpo) return;
  const grupos = [];
  lista.forEach(l => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.idLoja === l.idLoja) ultimo.itens.push(l);
    else grupos.push({ idLoja: l.idLoja, itens: [l] });
  });

  const cor = at => at === null ? '#666' : (at >= 100 ? COR_ACIMA : COR_ABAIXO);
  corpo.innerHTML = grupos.map(g => {
    const loja = porLoja[g.idLoja] || {};
    const nomeLoja = `Loja ${escaparHTML(g.idLoja)}${loja.descricao ? ' – ' + escaparHTML(loja.descricao) : ''}`;
    const metaInd = loja.metaVendedor > 0 ? `meta individual ${formatarMoedaBR(loja.metaVendedor)}` : 'sem meta individual';
    const naMeta = g.itens.filter(l => l.atingimento !== null && l.atingimento >= 100).length;
    const totalReal = g.itens.reduce((s, l) => s + l.realizado, 0);

    const cabecalho = `<tr style="background:#eef4fb;">
      <td colspan="5" style="padding:7px 8px; font-weight:bold; color:#0b4f8a; border-top:2px solid #cfe0f3;">
        🏬 ${nomeLoja}
        <span style="font-weight:normal; color:#555; font-size:12px;">
          · ${metaInd} · ${g.itens.length} vendedor(es) · ${naMeta} na meta · total ${formatarMoedaBR(totalReal)}
        </span>
      </td></tr>`;

    const linhas = g.itens.map(l => {
      const dif = l.realizado - l.meta;
      return `<tr>
        <td style="padding-left:24px;">${escaparHTML(l.vendedor)}</td>
        <td style="text-align:right">${l.meta ? formatarMoedaBR(l.meta) : '—'}</td>
        <td style="text-align:right">${formatarMoedaBR(l.realizado)}</td>
        <td style="text-align:right; color:${cor(l.atingimento)}">${l.meta ? (dif >= 0 ? '+' : '') + formatarMoedaBR(dif) : '—'}</td>
        <td style="text-align:right; color:${cor(l.atingimento)}; font-weight:bold">${l.atingimento === null ? 'sem meta' : formatarPct(l.atingimento)}</td>
      </tr>`;
    }).join('');
    return cabecalho + linhas;
  }).join('');
}

/**
 * Desenha faixas alternadas atrás das barras, uma por grupo (loja),
 * com o nome do grupo no topo. Usado no gráfico de vendedores.
 */
const pluginFaixasGrupo = {
  id: 'faixasGrupo',
  beforeDatasetsDraw(chart) {
    const funcGrupo = chart.$funcGrupo;
    const lista = chart.$listaMetas || [];
    if (!funcGrupo || !lista.length) return;
    const { ctx, chartArea, scales: { x } } = chart;
    const meiaLargura = lista.length > 1
      ? (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2
      : (chartArea.right - chartArea.left) / 2;

    let inicio = 0, alterna = false;
    ctx.save();
    for (let i = 1; i <= lista.length; i++) {
      if (i === lista.length || funcGrupo(lista[i]) !== funcGrupo(lista[inicio])) {
        const esq = Math.max(chartArea.left, x.getPixelForValue(inicio) - meiaLargura);
        const dir = Math.min(chartArea.right, x.getPixelForValue(i - 1) + meiaLargura);
        ctx.fillStyle = alterna ? 'rgba(0,120,215,0.06)' : 'rgba(0,0,0,0.025)';
        ctx.fillRect(esq, chartArea.top, dir - esq, chartArea.bottom - chartArea.top);
        if (inicio > 0) {
          ctx.strokeStyle = '#c9d6e3';
          ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(esq, chartArea.top); ctx.lineTo(esq, chartArea.bottom); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = '#0b4f8a';
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Loja ${funcGrupo(lista[inicio])}`, (esq + dir) / 2, chartArea.top + 14);
        inicio = i; alterna = !alterna;
      }
    }
    ctx.restore();
  }
};

function renderizarCardsMetas(lista) {
  const comMeta = lista.filter(l => l.meta > 0);
  const metaTotal = comMeta.reduce((s, l) => s + l.meta, 0);
  const realizadoTotal = comMeta.reduce((s, l) => s + l.realizado, 0);
  const ating = metaTotal > 0 ? (realizadoTotal / metaTotal) * 100 : 0;
  const gap = realizadoTotal - metaTotal;
  const acima = comMeta.filter(l => l.atingimento >= 100).length;

  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('cardMetaTotal', formatarMoedaBR(metaTotal));
  set('cardMetaRealizado', formatarMoedaBR(realizadoTotal));
  set('cardMetaAtingimento',
    `<span style="color:${ating >= 100 ? COR_ACIMA : COR_ABAIXO}">${formatarPct(ating)}</span>`);
  set('cardMetaGap',
    `<span style="color:${gap >= 0 ? COR_ACIMA : COR_ABAIXO}">${gap >= 0 ? '+' : ''}${formatarMoedaBR(gap)}</span>`);
  set('cardMetaLojasAcima', `${acima} de ${comMeta.length}`);
}

function rotuloLoja(l) {
  const nome = l.descricao ? `${l.id} · ${l.descricao}` : `Loja ${l.id}`;
  return [nome, rotuloVariacao(l)];
}

// Escreve o % de atingimento em cima da barra "Realizado"
const pluginRotuloAtingimento = {
  id: 'rotuloAtingimento',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(1);
    const lista = chart.$listaMetas || [];
    ctx.save();
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    meta.data.forEach((barra, i) => {
      const l = lista[i];
      if (!l || l.atingimento === null) return;
      ctx.fillStyle = l.atingimento >= 100 ? COR_ACIMA : COR_ABAIXO;
      ctx.fillText(formatarPct(l.atingimento), barra.x, barra.y - 6);
    });
    ctx.restore();
  }
};

function renderizarGraficoComparativo(canvasId, lista, funcRotulo, funcGrupo = null, rotuloRealizado = 'Realizado (líquido)') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (graficosMetas[canvasId]) graficosMetas[canvasId].destroy();

  const grafico = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: lista.map(funcRotulo),
      datasets: [
        { label: 'Meta', data: lista.map(l => l.meta), backgroundColor: COR_META, borderRadius: 4 },
        {
          label: rotuloRealizado,
          data: lista.map(l => l.realizado),
          backgroundColor: lista.map(l => l.atingimento === null ? COR_SEM_META : (l.atingimento >= 100 ? COR_ACIMA : COR_ABAIXO)),
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: funcGrupo ? 8 : 24 } },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            // legenda com as duas cores do realizado
            generateLabels: () => [
              { text: 'Meta', fillStyle: COR_META, strokeStyle: COR_META },
              { text: 'Realizado (na meta ou acima)', fillStyle: COR_ACIMA, strokeStyle: COR_ACIMA },
              { text: 'Realizado (abaixo da meta)', fillStyle: COR_ABAIXO, strokeStyle: COR_ABAIXO }
            ]
          }
        },
        tooltip: {
          callbacks: {
            title: items => (Array.isArray(items[0].label) ? items[0].label.join(' — ') : items[0].label),
            label: c => ` ${c.dataset.label}: ${formatarMoedaBR(c.raw)}`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            font: { size: 11 },
            color: (c) => {
              const l = lista[c.index];
              return !l || l.atingimento === null ? '#666' : (l.atingimento >= 100 ? COR_ACIMA : COR_ABAIXO);
            }
          }
        },
        y: {
          beginAtZero: true,
          grace: funcGrupo ? '20%' : '5%',   // espaço para o nome da loja e o % no topo
          ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') }
        }
      }
    },
    plugins: funcGrupo ? [pluginFaixasGrupo, pluginRotuloAtingimento] : [pluginRotuloAtingimento]
  });
  grafico.$listaMetas = lista;
  grafico.$funcGrupo = funcGrupo;
  grafico.update();
  graficosMetas[canvasId] = grafico;
}

function renderizarTabelaComparativo(tbodyId, lista, funcNomeHTML) {
  const corpo = document.getElementById(tbodyId);
  if (!corpo) return;
  corpo.innerHTML = lista.map(l => {
    const dif = l.realizado - l.meta;
    const cor = l.atingimento === null ? '#666' : (l.atingimento >= 100 ? COR_ACIMA : COR_ABAIXO);
    return `<tr>
      <td>${funcNomeHTML(l)}</td>
      <td style="text-align:right">${l.meta ? formatarMoedaBR(l.meta) : '—'}</td>
      <td style="text-align:right">${formatarMoedaBR(l.realizado)}</td>
      <td style="text-align:right; color:${cor}">${l.meta ? (dif >= 0 ? '+' : '') + formatarMoedaBR(dif) : '—'}</td>
      <td style="text-align:right; color:${cor}; font-weight:bold">${l.atingimento === null ? 'sem meta' : formatarPct(l.atingimento)}</td>
    </tr>`;
  }).join('');
}

/** Recarrega a aba Metas com o último resultado consultado (após editar metas). */
function recarregarAbaMetas() {
  if (ultimosTotaisPorLoja) {
    renderizarMetas(ultimosTotaisPorLoja).catch(err => console.error('Erro na aba Metas:', err));
  }
}
