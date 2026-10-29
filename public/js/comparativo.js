/**
 * Aba COMPARATIVO: evolução das vendas (valor líquido) no período consultado
 * e nos 2 períodos anteriores. Ex.: consulta 26/09 a 25/10 -> compara
 * 26/07 a 25/08, 26/08 a 25/09 e 26/09 a 25/10.
 *
 * O período atual reaproveita os dados já carregados; os 2 anteriores são
 * buscados na API só quando a aba é aberta (e ficam guardados até a próxima
 * consulta).
 */

let comparativoCache = null;   // { chave, periodos, porPeriodo }
let comparativoCarregando = false;
let graficoComparativo = null;

function limparComparativo() {
  comparativoCache = null;
}

function idLojaDoItem(item) {
  const texto = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? '').trim();
  const m = texto.match(/^0*(\d+)/);
  return m ? m[1] : texto;
}

/** Soma o líquido e conta as vendas (OS com bruto > 0) por loja. */
function resumirVendas(itens, lojasFiltro) {
  const porLoja = {};
  const osPorLoja = {};
  (itens || []).forEach(item => {
    const id = idLojaDoItem(item);
    if (lojasFiltro.length && !lojasFiltro.includes(id)) return;
    porLoja[id] = (porLoja[id] || 0) + parseNumeroBR(item.LIQUIDOPRODUTO);
    const os = String(item.OS || '').trim();
    if (os) {
      osPorLoja[id] = osPorLoja[id] || {};
      osPorLoja[id][os] = (osPorLoja[id][os] || 0) + parseNumeroBR(item.VALORBRUTOPRODUTO);
    }
  });
  const vendas = {};
  Object.keys(osPorLoja).forEach(id => { vendas[id] = Object.values(osPorLoja[id]).filter(v => v > 0).length; });
  const total = Object.values(porLoja).reduce((s, v) => s + v, 0);
  const qtdTotal = Object.values(vendas).reduce((s, v) => s + v, 0);
  return { porLoja, vendas, total, qtdTotal };
}

function isoParaBR(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

async function buscarVendasPeriodo(periodo, consulta) {
  const resp = await fetchAutenticado('/consulta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      DATAINICIAL: isoParaBR(periodo.inicio),
      DATAFINAL: isoParaBR(periodo.fim),
      LOJAS: consulta.lojas,
      TIPODATA: consulta.tipodata || 'VENDA',
      TIPOVENDA: ''
    })
  });
  if (!resp.ok) {
    const corpo = await resp.json().catch(() => ({}));
    throw new Error(corpo.error || `Erro ${resp.status} ao buscar ${periodo.rotulo}`);
  }
  return resp.json();
}

function mostrarStatusComparativo(html) {
  const el = document.getElementById('statusComparativo');
  if (!el) return;
  el.innerHTML = html || '';
  el.style.display = html ? 'block' : 'none';
}

async function abrirComparativo() {
  const consulta = ultimaConsultaBI;
  if (!consulta || !consulta.inicioISO || !consulta.fimISO) {
    mostrarStatusComparativo('Faça uma consulta primeiro.');
    return;
  }
  const chave = JSON.stringify(consulta);
  if (comparativoCache && comparativoCache.chave === chave) {
    renderizarComparativo(comparativoCache);
    return;
  }
  if (comparativoCarregando) return;

  const periodos = periodosAnteriores(consulta.inicioISO, consulta.fimISO, 3);
  const lojasFiltro = String(consulta.lojas || '').split(',').map(s => s.trim()).filter(Boolean);
  comparativoCarregando = true;
  mostrarStatusComparativo(`⏳ Buscando ${periodos[0].rotulo} e ${periodos[1].rotulo} na API...`);

  try {
    const anteriores = await Promise.all(periodos.slice(0, 2).map(p => buscarVendasPeriodo(p, consulta)));
    const porPeriodo = [
      resumirVendas(anteriores[0], lojasFiltro),
      resumirVendas(anteriores[1], lojasFiltro),
      resumirVendas(dadosBrutosGlobaisParaGrafico, [])   // atual: já filtrado pela consulta
    ];
    comparativoCache = { chave, periodos, porPeriodo };
    mostrarStatusComparativo('');
    renderizarComparativo(comparativoCache);
  } catch (err) {
    mostrarStatusComparativo('❌ ' + escHTML(err.message));
  } finally {
    comparativoCarregando = false;
  }
}

function variacaoHTML(atual, anterior) {
  if (!anterior) return '<span style="color:#888">—</span>';
  const v = ((atual - anterior) / anterior) * 100;
  const cor = v >= 0 ? '#28a745' : '#d9534f';
  const seta = v >= 0 ? '▲' : '▼';
  return `<span style="color:${cor}; font-weight:bold;">${seta} ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>`;
}

function nomeLojaComparativo(id) {
  const loja = (typeof lojasDisponiveis !== 'undefined' ? lojasDisponiveis : []).find(l => String(l.id) === String(id));
  const nome = loja ? String(loja.nome || '').replace(/^0*\d+\s*/, '') : '';
  return nome ? `${id} · ${nome}` : `Loja ${id}`;
}

function renderizarComparativo({ periodos, porPeriodo }) {
  const d = new Date();
  const hoje = isoData(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const parcial = periodos[2].fim > hoje;

  const subtitulo = document.getElementById('subtituloComparativo');
  if (subtitulo) {
    subtitulo.textContent = periodos.map(p => p.rotulo).join('  →  ') +
      (parcial ? '  (período atual ainda em andamento)' : '');
  }

  // ---- cards: total de cada período + variação
  const cards = document.getElementById('cardsComparativo');
  if (cards) {
    cards.innerHTML = periodos.map((p, i) => {
      const r = porPeriodo[i];
      const ant = i > 0 ? porPeriodo[i - 1].total : 0;
      const ticket = r.qtdTotal ? r.total / r.qtdTotal : 0;
      return `<div class="bi-card" style="border-left-color: ${['#adb5bd', '#6c9bd2', '#0078d7'][i]}; padding: 10px;">
        <div class="bi-card-title" style="font-size: 11px;">${p.rotulo}${i === 2 && parcial ? ' · parcial' : ''}</div>
        <div class="bi-card-value">${formatarMoedaBR(r.total)}</div>
        <div style="font-size: 12px; color: #666; margin-top: 4px;">
          ${r.qtdTotal} vendas · ticket ${formatarMoedaBR(ticket)}
          ${i > 0 ? `<br>vs anterior: ${variacaoHTML(r.total, ant)}` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // ---- lojas presentes em qualquer período, ordenadas pela venda atual
  const ids = [...new Set(porPeriodo.flatMap(r => Object.keys(r.porLoja)))];
  ids.sort((a, b) => (porPeriodo[2].porLoja[b] || 0) - (porPeriodo[2].porLoja[a] || 0));

  // ---- gráfico de linhas: uma linha por loja + total da rede (eixo à direita)
  const canvas = document.getElementById('graficoComparativo');
  if (canvas) {
    if (graficoComparativo) graficoComparativo.destroy();
    const datasets = ids.map((id, i) => ({
      label: nomeLojaComparativo(id),
      data: porPeriodo.map(r => r.porLoja[id] || 0),
      borderColor: CORES_PALETA[i % CORES_PALETA.length],
      backgroundColor: CORES_PALETA[i % CORES_PALETA.length],
      tension: 0.3, borderWidth: 2, pointRadius: 4, yAxisID: 'y'
    }));
    datasets.push({
      label: 'Total da rede',
      data: porPeriodo.map(r => r.total),
      borderColor: '#333', backgroundColor: '#333',
      borderDash: [6, 4], borderWidth: 3, pointRadius: 5, tension: 0.3, yAxisID: 'y1'
    });
    graficoComparativo = new Chart(canvas, {
      type: 'line',
      data: { labels: periodos.map(p => p.rotulo), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${formatarMoedaBR(c.raw)}` } }
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Por loja' },
               ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false },
                title: { display: true, text: 'Total da rede' },
                ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } }
        }
      }
    });
  }

  // ---- tabela loja x período
  const cab = document.getElementById('cabecalhoComparativo');
  if (cab) {
    cab.innerHTML = `<tr>
      <th style="padding: 8px; text-align: left;">Loja</th>
      ${periodos.map(p => `<th style="padding: 8px; text-align: right;">${p.rotulo}</th>`).join('')}
      <th style="padding: 8px; text-align: right;">vs mês anterior</th>
      <th style="padding: 8px; text-align: right;">vs 2 meses atrás</th>
    </tr>`;
  }
  const corpo = document.getElementById('corpoComparativo');
  if (corpo) {
    const linha = (nome, valores, negrito) => `<tr style="${negrito ? 'background:#eef4fb; font-weight:bold;' : ''}">
      <td style="padding: 7px 8px;">${nome}</td>
      ${valores.map(v => `<td style="padding: 7px 8px; text-align: right;">${formatarMoedaBR(v)}</td>`).join('')}
      <td style="padding: 7px 8px; text-align: right;">${variacaoHTML(valores[2], valores[1])}</td>
      <td style="padding: 7px 8px; text-align: right;">${variacaoHTML(valores[2], valores[0])}</td>
    </tr>`;
    corpo.innerHTML = ids.map(id => linha(escHTML(nomeLojaComparativo(id)), porPeriodo.map(r => r.porLoja[id] || 0), false)).join('')
      + linha('TOTAL DA REDE', porPeriodo.map(r => r.total), true);
  }
}
