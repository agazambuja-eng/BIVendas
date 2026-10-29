/**
 * Aba METAS - compara o valor líquido vendido por loja com a meta do mês
 * cadastrada na tabela `metas_loja` do Supabase (projeto BIVendas).
 *
 * Tabela esperada (public.metas_loja):
 *   codigo      int4     -> código da loja (ex.: 520)
 *   descricao   text     -> nome da loja
 *   valor_meta  numeric  -> meta em R$
 *   data_inicio date     -> início do período da meta (ex.: 2026-09-26)
 *   data_fim    date     -> fim do período da meta (ex.: 2026-10-25)
 *   competencia int4     -> calculada pelo banco a partir de data_fim (AAAAMM)
 */

// Conexão com o Supabase: ver supabase-config.js
const metasClient = supabaseBI;
const graficosMetas = {};          // canvasId -> instância Chart
let ultimosTotaisPorLoja = null;   // para recarregar a aba após editar metas

const COR_META = '#adb5bd';
const COR_ACIMA = '#28a745';
const COR_ABAIXO = '#d9534f';
const COR_SEM_META = '#0078d7';

/** "2026-10-01" + "2026-11-15" -> [202610, 202611] */
function competenciasDoPeriodo(dataIniISO, dataFimISO) {
  if (!dataIniISO) return [];
  // Mês comercial (26 a 25): 26/09 a 25/10 = outubro (202610), não set + out.
  const cIni = competenciaComercial(dataIniISO, true);
  const cFim = competenciaComercial(dataFimISO || dataIniISO, false);
  const inicio = Math.min(cIni, cFim);
  const ai = Math.floor(inicio / 100), mi = inicio % 100;
  const af = Math.floor(cFim / 100), mf = cFim % 100;
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
  const subtitulo = document.getElementById('subtituloMetas');
  if (!dataIni || !dataFim) {
    if (subtitulo) subtitulo.textContent = 'Informe a data inicial e a final para buscar as metas.';
    return;
  }

  // Lojas digitadas no filtro (se vazio, considera todas que têm meta)
  const lojasFiltro = document.getElementById('lojas').value
    .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

  let query = metasClient
    .from('metas_loja')
    .select('*')   // '*' para não quebrar se alguma coluna nova ainda não existir
    // metas cujo período cruza o período consultado
    .lte('data_inicio', dataFim)
    .gte('data_fim', dataIni);
  if (lojasFiltro.length) query = query.in('codigo', lojasFiltro);

  const { data: metas, error } = await query;
  if (error) {
    const semColuna = /data_inicio|data_fim/.test(error.message || '');
    mostrarAvisoMetas('❌ Erro ao buscar metas no Supabase: ' + escaparHTML(error.message) +
      (semColuna ? ' — rode <code>database/08_metas_periodo_datas.sql</code> no Supabase.' : ''));
    return;
  }

  // Períodos de meta encontrados (normalmente um só: ex. 26/09 a 25/10)
  const periodosMeta = [...new Set((metas || []).map(m => `${m.data_inicio}|${m.data_fim}`))].sort()
    .map(t => t.split('|')).map(([i, f]) => `${formatarDataISOparaBR(i)} a ${formatarDataISOparaBR(f)}`);
  if (subtitulo) {
    subtitulo.textContent = `Período consultado ${formatarDataISOparaBR(dataIni)} a ${formatarDataISOparaBR(dataFim)}` +
      (periodosMeta.length ? ` · metas de ${periodosMeta.join(' + ')}` : '');
  }

  // Junta metas (somando se o período cobrir mais de um mês) + realizado da API
  const porLoja = {};
  (metas || []).forEach(m => {
    const id = String(m.codigo);
    if (!porLoja[id]) porLoja[id] = novoRegistroLoja(id, m.descricao);
    porLoja[id].meta += Number(m.valor_meta) || 0;
    // Metas do vendedor em 3 faixas (Bronze < Prata < Ouro).
    // valor_meta_vendedor = nome antigo da meta Bronze (antes do script 07).
    porLoja[id].metaBronze += Number(m.valor_meta_bronze ?? m.valor_meta_vendedor) || 0;
    porLoja[id].metaPrata += Number(m.valor_meta_prata) || 0;
    porLoja[id].metaOuro += Number(m.valor_meta_ouro) || 0;
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
    mostrarAvisoMetas(`Nenhuma meta encontrada para ${formatarDataISOparaBR(dataIni)} a ${formatarDataISOparaBR(dataFim)}` +
      (lojasFiltro.length ? ` nas lojas ${lojasFiltro.join(', ')}` : '') +
      '. Confira a tabela <code>metas_loja</code> e a política de leitura (RLS).');
  } else {
    const semMeta = lista.filter(l => l.atingimento === null).map(l => l.id);
    const avisos = [];
    if (periodosMeta.length > 1) {
      avisos.push(`⚠️ O período consultado cruza ${periodosMeta.length} períodos de meta (${periodosMeta.join(' + ')}); as metas foram somadas. Para comparar com uma meta só, consulte exatamente o período dela.`);
    }
    if (semMeta.length) avisos.push(`Lojas com venda mas sem meta cadastrada: ${semMeta.join(', ')}`);
    mostrarAvisoMetas(avisos.join('<br>'));
  }

  renderizarCardsMetas(lista);
  renderizarGraficoComparativo('graficoMetas', lista, rotuloLoja);
  renderizarTabelaComparativo('tabelaMetasCorpo', lista,
    l => `${escaparHTML(l.id)}${l.descricao ? ' – ' + escaparHTML(l.descricao) : ''}`);

  renderizarMetasTicket(porLoja);
  renderizarMetasVendedores(porLoja);
}

function novoRegistroLoja(id, descricao) {
  return { id, descricao, meta: 0, metaBronze: 0, metaPrata: 0, metaOuro: 0, realizado: 0 };
}

/**
 * Ticket médio por loja = valor líquido ÷ quantidade de vendas (OS com valor
 * bruto > 0), mesma regra do card "Ticket Médio" da aba Visão Geral.
 * Sem meta: só o ticket realizado de cada loja, comparado com o da rede.
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
    const reg = porLoja[id] || novoRegistroLoja(id, '');
    return { id, descricao: reg.descricao, qtdVendas, ticket: qtdVendas > 0 ? liquidoPorLoja[id] / qtdVendas : 0 };
  });
  lista.sort((a, b) => b.ticket - a.ticket);

  const totalLiquido = Object.values(liquidoPorLoja).reduce((s, v) => s + v, 0);
  const totalVendas = lista.reduce((s, l) => s + l.qtdVendas, 0);
  const ticketRede = totalVendas > 0 ? totalLiquido / totalVendas : 0;

  const resumo = document.getElementById('resumoMetasTicket');
  if (resumo) {
    resumo.innerHTML = lista.length
      ? `Ticket médio da rede: <strong>${formatarMoedaBR(ticketRede)}</strong> (${totalVendas} vendas) · barra verde = acima da média da rede`
      : 'Nenhuma venda no período.';
  }

  const canvas = document.getElementById('graficoMetasTicket');
  if (!canvas) return;
  if (graficosMetas.graficoMetasTicket) graficosMetas.graficoMetasTicket.destroy();
  const grafico = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: lista.map(l => [l.descricao ? `${l.id} · ${l.descricao}` : `Loja ${l.id}`, `${l.qtdVendas} vendas`]),
      datasets: [{
        label: 'Ticket médio',
        data: lista.map(l => l.ticket),
        backgroundColor: lista.map(l => l.ticket >= ticketRede ? COR_ACIMA : COR_SEM_META),
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` Ticket médio: ${formatarMoedaBR(c.raw)}` } }
      },
      scales: {
        x: { ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, grace: '8%', ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } }
      }
    },
    plugins: [{
      id: 'valorTicket',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#333';
        chart.getDatasetMeta(0).data.forEach((barra, i) => ctx.fillText(formatarMoedaBR(lista[i].ticket), barra.x, barra.y - 6));
        ctx.restore();
      }
    }]
  });
  graficosMetas.graficoMetasTicket = grafico;
}

// ------------------------------------------------ vendedores e troféus
const NIVEIS = {
  ouro:   { nome: 'Ouro',   trofeu: '🥇', cor: '#c9a227' },
  prata:  { nome: 'Prata',  trofeu: '🥈', cor: '#8e9aa6' },
  bronze: { nome: 'Bronze', trofeu: '🥉', cor: '#b0703a' }
};
const COR_META_BRONZE = 'rgba(176, 112, 58, 0.30)';
const COR_META_PRATA  = 'rgba(142, 154, 166, 0.35)';
const COR_META_OURO   = 'rgba(201, 162, 39, 0.35)';

/** "0001 - * SEM VENDEDOR" não concorre a meta. */
function ehSemVendedor(nome) {
  return /SEM VENDEDOR/i.test(String(nome || ''));
}

/**
 * Faixa atingida pelo vendedor: maior meta que ele alcançou.
 * Devolve também a próxima meta e quanto falta para ela.
 */
function nivelDoVendedor(realizado, bronze, prata, ouro) {
  const faixas = [['bronze', bronze], ['prata', prata], ['ouro', ouro]].filter(([, v]) => v > 0);
  if (!faixas.length) return { semMeta: true, nivel: null, proxima: null, falta: 0 };
  let nivel = null;
  faixas.forEach(([n, v]) => { if (realizado >= v) nivel = n; });
  const proximaFaixa = faixas.find(([, v]) => realizado < v) || null;
  return {
    semMeta: false,
    nivel,
    proxima: proximaFaixa ? proximaFaixa[0] : null,
    falta: proximaFaixa ? proximaFaixa[1] - realizado : 0,
    base: faixas[0][1]   // primeira meta (normalmente a Bronze) = base do %
  };
}

/**
 * Metas individuais em 3 faixas: cada vendedor é comparado com as metas
 * Bronze, Prata e Ouro da loja dele no mês. Troféu = maior faixa atingida.
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

  const ordemNivel = { ouro: 3, prata: 2, bronze: 1 };
  const lista = Object.values(vendas).map(v => {
    const loja = porLoja[v.idLoja] || {};
    const sem = ehSemVendedor(v.vendedor);
    const bronze = sem ? 0 : (loja.metaBronze || 0);
    const prata = sem ? 0 : (loja.metaPrata || 0);
    const ouro = sem ? 0 : (loja.metaOuro || 0);
    const n = nivelDoVendedor(v.realizado, bronze, prata, ouro);
    return { ...v, bronze, prata, ouro, ...n, atingimento: n.semMeta ? null : (v.realizado / n.base) * 100 };
  });
  // Agrupado por loja; dentro da loja: maior troféu, depois maior venda
  lista.sort((a, b) =>
    (Number(a.idLoja) - Number(b.idLoja)) || String(a.idLoja).localeCompare(String(b.idLoja)) ||
    ((ordemNivel[b.nivel] || 0) - (ordemNivel[a.nivel] || 0)) || (b.realizado - a.realizado));

  const conta = n => lista.filter(l => l.nivel === n).length;
  const abaixo = lista.filter(l => !l.semMeta && !l.nivel).length;
  const semMeta = lista.filter(l => l.semMeta).length;
  const resumo = document.getElementById('resumoMetasVendedores');
  if (resumo) {
    resumo.innerHTML = lista.length
      ? `🥇 Ouro: <strong>${conta('ouro')}</strong> · 🥈 Prata: <strong>${conta('prata')}</strong> · ` +
        `🥉 Bronze: <strong>${conta('bronze')}</strong> · abaixo do Bronze: <strong>${abaixo}</strong>` +
        (semMeta ? ` · sem meta: ${semMeta}` : '')
      : 'Nenhuma venda por vendedor no período.';
  }

  const area = document.getElementById('areaGraficoMetasVendedores');
  if (area) area.style.width = Math.max(lista.length * 140, 600) + 'px';

  renderizarGraficoVendedores(lista);
  renderizarTabelaVendedoresPorLoja(lista, porLoja);
}

function corRealizadoVendedor(l) {
  if (l.semMeta) return COR_SEM_META;
  return l.nivel ? NIVEIS[l.nivel].cor : COR_ABAIXO;
}

function textoNivel(l) {
  if (l.semMeta) return 'sem meta';
  if (l.nivel) return `Meta ${NIVEIS[l.nivel].nome}`;
  return `▼ ${formatarPct(100 - l.atingimento)} abaixo do Bronze`;
}

function rotuloVendedor(l) {
  const trofeu = l.nivel ? NIVEIS[l.nivel].trofeu + ' ' : '';
  return [trofeu + l.vendedor, textoNivel(l)];
}

function renderizarGraficoVendedores(lista) {
  const canvas = document.getElementById('graficoMetasVendedores');
  if (!canvas) return;
  if (graficosMetas.graficoMetasVendedores) graficosMetas.graficoMetasVendedores.destroy();

  const grafico = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: lista.map(rotuloVendedor),
      datasets: [
        { label: '🥉 Meta Bronze', data: lista.map(l => l.bronze), backgroundColor: COR_META_BRONZE, borderRadius: 3 },
        { label: '🥈 Meta Prata',  data: lista.map(l => l.prata),  backgroundColor: COR_META_PRATA,  borderRadius: 3 },
        { label: '🥇 Meta Ouro',   data: lista.map(l => l.ouro),   backgroundColor: COR_META_OURO,   borderRadius: 3 },
        { label: 'Realizado', data: lista.map(l => l.realizado), backgroundColor: lista.map(corRealizadoVendedor), borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 8 } },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            generateLabels: () => [
              { text: '🥉 Meta Bronze', fillStyle: COR_META_BRONZE, strokeStyle: COR_META_BRONZE },
              { text: '🥈 Meta Prata', fillStyle: COR_META_PRATA, strokeStyle: COR_META_PRATA },
              { text: '🥇 Meta Ouro', fillStyle: COR_META_OURO, strokeStyle: COR_META_OURO },
              { text: 'Realizado (cor do troféu)', fillStyle: NIVEIS.ouro.cor, strokeStyle: NIVEIS.ouro.cor },
              { text: 'Realizado abaixo do Bronze', fillStyle: COR_ABAIXO, strokeStyle: COR_ABAIXO }
            ]
          }
        },
        tooltip: {
          callbacks: {
            title: items => (Array.isArray(items[0].label) ? items[0].label.join(' — ') : items[0].label),
            label: c => ` ${c.dataset.label}: ${formatarMoedaBR(c.raw)}`,
            footer: items => {
              const l = lista[items[0].dataIndex];
              return l && l.proxima ? `Faltam ${formatarMoedaBR(l.falta)} para a meta ${NIVEIS[l.proxima].nome}` : '';
            }
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 11 }, color: c => { const l = lista[c.index]; return l ? corRealizadoVendedor(l) : '#666'; } } },
        y: { beginAtZero: true, grace: '20%', ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } }
      }
    },
    plugins: [pluginFaixasGrupo, pluginRotuloAtingimento]
  });
  grafico.$listaMetas = lista;
  grafico.$funcGrupo = l => l.idLoja;
  grafico.$indiceRealizado = 3;
  grafico.$corRotulo = corRealizadoVendedor;
  grafico.update();
  graficosMetas.graficoMetasVendedores = grafico;
}

/** Tabela de vendedores com um cabeçalho por loja. */
function renderizarTabelaVendedoresPorLoja(lista, porLoja) {
  const corpo = document.getElementById('tabelaMetasVendedoresCorpo');
  if (!corpo) return;
  const grupos = [];
  lista.forEach(l => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.idLoja === l.idLoja) ultimo.itens.push(l);
    else grupos.push({ idLoja: l.idLoja, itens: [l] });
  });
  const moeda = v => v ? formatarMoedaBR(v) : '—';

  corpo.innerHTML = grupos.map(g => {
    const loja = porLoja[g.idLoja] || {};
    const nomeLoja = `Loja ${escaparHTML(g.idLoja)}${loja.descricao ? ' – ' + escaparHTML(loja.descricao) : ''}`;
    const qtd = n => g.itens.filter(l => l.nivel === n).length;
    const totalReal = g.itens.reduce((s, l) => s + l.realizado, 0);

    const cabecalho = `<tr style="background:#eef4fb;">
      <td colspan="6" style="padding:7px 8px; font-weight:bold; color:#0b4f8a; border-top:2px solid #cfe0f3;">
        🏬 ${nomeLoja}
        <span style="font-weight:normal; color:#555; font-size:12px;">
          · ${g.itens.length} vendedor(es) · 🥇 ${qtd('ouro')} · 🥈 ${qtd('prata')} · 🥉 ${qtd('bronze')} · total ${formatarMoedaBR(totalReal)}
        </span>
      </td></tr>`;

    const linhas = g.itens.map(l => {
      const trofeu = l.nivel ? NIVEIS[l.nivel].trofeu : '';
      let situacao;
      if (l.semMeta) situacao = '<span style="color:#666">sem meta</span>';
      else {
        const conquista = l.nivel
          ? `<strong style="color:${NIVEIS[l.nivel].cor}">${NIVEIS[l.nivel].trofeu} ${NIVEIS[l.nivel].nome}</strong>`
          : `<strong style="color:${COR_ABAIXO}">abaixo do Bronze</strong>`;
        const falta = l.proxima
          ? `<br><small style="color:#666">faltam ${formatarMoedaBR(l.falta)} p/ ${NIVEIS[l.proxima].nome}</small>`
          : '';
        situacao = conquista + falta;
      }
      return `<tr>
        <td style="padding-left:24px;">${trofeu ? trofeu + ' ' : ''}${escaparHTML(l.vendedor)}</td>
        <td style="text-align:right">${moeda(l.bronze)}</td>
        <td style="text-align:right">${moeda(l.prata)}</td>
        <td style="text-align:right">${moeda(l.ouro)}</td>
        <td style="text-align:right; font-weight:bold; color:${corRealizadoVendedor(l)}">${formatarMoedaBR(l.realizado)}</td>
        <td style="text-align:right">${situacao}</td>
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

function rotuloVariacao(l) {
  if (l.atingimento === null) return 'sem meta';
  const dif = l.atingimento - 100;
  return dif >= 0 ? `▲ ${formatarPct(dif)} acima` : `▼ ${formatarPct(Math.abs(dif))} abaixo`;
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
    const meta = chart.getDatasetMeta(chart.$indiceRealizado ?? 1);
    const lista = chart.$listaMetas || [];
    ctx.save();
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    meta.data.forEach((barra, i) => {
      const l = lista[i];
      if (!l || l.atingimento === null) return;
      ctx.fillStyle = chart.$corRotulo ? chart.$corRotulo(l) : (l.atingimento >= 100 ? COR_ACIMA : COR_ABAIXO);
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
