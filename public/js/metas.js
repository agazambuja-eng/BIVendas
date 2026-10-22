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
let meuGraficoMetas = null;

const COR_META = '#adb5bd';
const COR_ACIMA = '#28a745';
const COR_ABAIXO = '#d9534f';

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
    .select('codigo, descricao, valor_meta, competencia')
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
    if (!porLoja[id]) porLoja[id] = { id, descricao: m.descricao, meta: 0, realizado: 0 };
    porLoja[id].meta += Number(m.valor_meta) || 0;
    if (m.descricao) porLoja[id].descricao = m.descricao;
  });
  Object.keys(totaisPorLoja || {}).forEach(id => {
    if (!porLoja[id]) porLoja[id] = { id, descricao: '', meta: 0, realizado: 0 };
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
  renderizarGraficoMetas(lista);
  renderizarTabelaMetas(lista);
}

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
  if (l.atingimento === null) return [nome, 'sem meta'];
  const dif = l.atingimento - 100;
  const linha2 = dif >= 0
    ? `▲ ${formatarPct(dif)} acima`
    : `▼ ${formatarPct(Math.abs(dif))} abaixo`;
  return [nome, linha2];
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

function renderizarGraficoMetas(lista) {
  const canvas = document.getElementById('graficoMetas');
  if (!canvas) return;
  if (meuGraficoMetas) meuGraficoMetas.destroy();

  meuGraficoMetas = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: lista.map(rotuloLoja),
      datasets: [
        { label: 'Meta do mês', data: lista.map(l => l.meta), backgroundColor: COR_META, borderRadius: 4 },
        {
          label: 'Realizado (líquido)',
          data: lista.map(l => l.realizado),
          backgroundColor: lista.map(l => (l.atingimento === null || l.atingimento >= 100) ? COR_ACIMA : COR_ABAIXO),
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            // legenda com as duas cores do realizado
            generateLabels: () => [
              { text: 'Meta do mês', fillStyle: COR_META, strokeStyle: COR_META },
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
          ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') }
        }
      }
    },
    plugins: [pluginRotuloAtingimento]
  });
  meuGraficoMetas.$listaMetas = lista;
  meuGraficoMetas.update();
}

function renderizarTabelaMetas(lista) {
  const corpo = document.getElementById('tabelaMetasCorpo');
  if (!corpo) return;
  corpo.innerHTML = lista.map(l => {
    const dif = l.realizado - l.meta;
    const cor = l.atingimento === null ? '#666' : (l.atingimento >= 100 ? COR_ACIMA : COR_ABAIXO);
    return `<tr>
      <td>${escaparHTML(l.id)}${l.descricao ? ' – ' + escaparHTML(l.descricao) : ''}</td>
      <td style="text-align:right">${l.meta ? formatarMoedaBR(l.meta) : '—'}</td>
      <td style="text-align:right">${formatarMoedaBR(l.realizado)}</td>
      <td style="text-align:right; color:${cor}">${l.meta ? (dif >= 0 ? '+' : '') + formatarMoedaBR(dif) : '—'}</td>
      <td style="text-align:right; color:${cor}; font-weight:bold">${l.atingimento === null ? 'sem meta' : formatarPct(l.atingimento)}</td>
    </tr>`;
  }).join('');
}
