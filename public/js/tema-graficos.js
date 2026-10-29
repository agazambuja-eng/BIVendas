/**
 * Tema "neon 3D" para todos os gráficos do BI (Chart.js 4).
 *
 *  - Barras: frente em degradê com brilho + lateral e topo (efeito 3D).
 *  - Roscas: profundidade (camadas mais escuras por baixo), degradê e brilho.
 *  - Linhas: traço luminoso com área degradê por baixo.
 *  - Textos, grades e tooltips ajustados para fundo escuro.
 *
 * Funciona sobre as cores que cada gráfico já usa: o tema só transforma a
 * cor sólida em degradê e acrescenta os efeitos. Para desligar o 3D de um
 * gráfico: options.plugins.neon3d = false.
 * Carregar DEPOIS do chart.umd.min.js e ANTES dos scripts que criam gráficos.
 */

// Paleta neon (cor clara, cor escura) usada pelos gráficos do BI
const PALETA_NEON = [
  ['#5ee7ff', '#1a6dff'],  // ciano
  ['#ff5cf0', '#8a2bff'],  // magenta
  ['#ffd35e', '#ff7a1a'],  // dourado
  ['#3dffa8', '#0aa36b'],  // verde
  ['#ff5c8a', '#c4134f'],  // rosa
  ['#9d7bff', '#4b2bd6'],  // violeta
  ['#5effd6', '#0f8f9e'],  // turquesa
  ['#ffa05e', '#d44a12'],  // laranja
  ['#b8ff5e', '#4f9e0f'],  // lima
  ['#7bb8ff', '#2b4bd6']   // azul
];
const CORES_NEON = PALETA_NEON.map(p => p[0]);

const TEMA = {
  texto: '#c9cff5',
  textoFraco: '#7c86bd',
  grade: 'rgba(140, 160, 255, 0.10)',
  fundo: '#0b0f2a',
  tooltip: 'rgba(10, 14, 40, 0.95)',
  profundidade3D: 9,    // px da lateral/topo das barras
  profundidadeRosca: 10 // px da "espessura" das roscas
};

// ------------------------------------------------------------ cores
function corParaRGB(cor) {
  if (typeof cor !== 'string') return null;
  const c = cor.trim();
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map(s => parseFloat(s));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  m = c.match(/^hsla?\(([^)]+)\)$/i);
  if (m) {   // converte hsl -> rgb
    const p = m[1].split(',').map(s => parseFloat(s));
    const h = p[0] / 360, s = p[1] / 100, l = p[2] / 100;
    const f = n => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0) * 255, f(8) * 255, f(4) * 255, p.length > 3 ? p[3] : 1];
  }
  return null;
}
function rgba([r, g, b], a) { return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`; }
/** fator > 0 clareia (rumo ao branco), < 0 escurece (rumo ao preto) */
function ajustarCor(cor, fator, alpha) {
  const c = corParaRGB(cor);
  if (!c) return cor;
  const alvo = fator >= 0 ? 255 : 0, f = Math.abs(fator);
  return rgba([c[0] + (alvo - c[0]) * f, c[1] + (alvo - c[1]) * f, c[2] + (alvo - c[2]) * f], alpha ?? c[3]);
}
/** Cor escura de par da paleta neon, se a cor for uma delas; senão escurece. */
function corEscuraDe(cor) {
  const par = PALETA_NEON.find(p => String(cor).toLowerCase() === p[0]);
  return par ? par[1] : ajustarCor(cor, -0.45);
}

// --------------------------------------------------- padrões globais
function aplicarPadroesTema() {
  if (typeof Chart === 'undefined') return;
  const d = Chart.defaults;
  d.color = TEMA.texto;
  d.borderColor = TEMA.grade;
  d.font.family = '"Segoe UI", "Inter", Arial, sans-serif';
  d.font.size = 12;
  d.animation.duration = 900;
  d.animation.easing = 'easeOutQuart';

  d.plugins.legend.labels.color = TEMA.texto;
  d.plugins.legend.labels.usePointStyle = true;
  d.plugins.legend.labels.pointStyle = 'rectRounded';
  d.plugins.legend.labels.padding = 14;

  Object.assign(d.plugins.tooltip, {
    backgroundColor: TEMA.tooltip,
    borderColor: 'rgba(94, 231, 255, 0.45)',
    borderWidth: 1,
    titleColor: '#ffffff',
    bodyColor: '#d7dcff',
    footerColor: '#5ee7ff',
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4
  });

  d.scale.grid.color = TEMA.grade;
  d.scale.ticks.color = TEMA.textoFraco;

  d.elements.bar.borderRadius = 0;
  d.datasets.bar.barPercentage = 0.78;
  d.datasets.bar.categoryPercentage = 0.82;

  d.elements.arc.borderWidth = 2;
  d.elements.arc.borderColor = TEMA.fundo;
  d.elements.arc.hoverOffset = 14;

  d.elements.line.borderWidth = 3;
  d.elements.line.tension = 0.35;
  d.elements.point.radius = 4;
  d.elements.point.hoverRadius = 7;
  d.elements.point.borderWidth = 2;
}

// ------------------------------------------------------------ barras
/**
 * Cor sólida do elemento, lida direto dos dados do gráfico (o Chart.js
 * reaproveita o mesmo objeto de opções entre elementos iguais, então não dá
 * para confiar no que já foi alterado).
 */
function corDoElemento(chart, meta, i) {
  const ds = chart.data.datasets[meta.index] || {};
  const bg = ds.backgroundColor;
  const cor = Array.isArray(bg) ? bg[i % bg.length] : bg;
  return typeof cor === 'string' ? cor : null;
}

/** Dá ao elemento um objeto de opções só dele (para o degradê não vazar para os outros). */
function opcoesProprias(el) {
  if (!el.$opcoesNeon || el.$opcoesNeonBase !== el.options) {
    const proprias = Object.assign({}, el.options);
    delete proprias.$shared;
    el.$opcoesNeonBase = el.options;
    el.$opcoesNeon = proprias;
  }
  el.options = el.$opcoesNeon;
  return el.options;
}

function prepararBarras(chart, meta) {
  const { ctx } = chart;
  meta.data.forEach((el, i) => {
    const cor = corDoElemento(chart, meta, i);
    el.$corNeon = cor;
    if (!cor || el.y === undefined || el.base === undefined) return;
    const topo = Math.min(el.y, el.base), base = Math.max(el.y, el.base);
    if (base - topo < 1) return;
    const g = ctx.createLinearGradient(0, topo, 0, base);
    g.addColorStop(0, ajustarCor(cor, 0.18));
    g.addColorStop(1, corEscuraDe(cor));
    const op = opcoesProprias(el);
    op.backgroundColor = g;
    op.borderWidth = 0;
  });
}

function desenharFacesBarras(chart, meta) {
  const { ctx } = chart;
  const dx = TEMA.profundidade3D, dy = Math.round(TEMA.profundidade3D * 0.7);
  const horizontal = chart.options.indexAxis === 'y';
  if (horizontal) return; // 3D só nas barras verticais
  meta.data.forEach(el => {
    const cor = el.$corNeon;
    if (!cor) return;
    const { x, y, base, width } = el.getProps(['x', 'y', 'base', 'width'], true);
    if (!width || Math.abs(base - y) < 1) return;
    const esq = x - width / 2, dir = x + width / 2;
    const topo = Math.min(y, base), chao = Math.max(y, base);

    ctx.save();
    // lateral direita
    ctx.fillStyle = ajustarCor(corEscuraDe(cor), -0.25, 0.95);
    ctx.beginPath();
    ctx.moveTo(dir, topo); ctx.lineTo(dir + dx, topo - dy);
    ctx.lineTo(dir + dx, chao - dy); ctx.lineTo(dir, chao);
    ctx.closePath(); ctx.fill();
    // topo
    const gt = ctx.createLinearGradient(esq, topo - dy, dir + dx, topo);
    gt.addColorStop(0, ajustarCor(cor, 0.65));
    gt.addColorStop(1, ajustarCor(cor, 0.15));
    ctx.fillStyle = gt;
    ctx.beginPath();
    ctx.moveTo(esq, topo); ctx.lineTo(esq + dx, topo - dy);
    ctx.lineTo(dir + dx, topo - dy); ctx.lineTo(dir, topo);
    ctx.closePath(); ctx.fill();
    // reflexo de luz na frente
    const gr = ctx.createLinearGradient(esq, 0, dir, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.28)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(esq, topo, width, chao - topo);
    ctx.restore();
  });
}

// ------------------------------------------------------------ roscas
function prepararRosca(chart, meta) {
  const { ctx } = chart;
  meta.data.forEach((el, i) => {
    const cor = corDoElemento(chart, meta, i);
    el.$corNeon = cor;
    if (!cor || !el.outerRadius) return;
    const g = ctx.createRadialGradient(el.x, el.y, el.innerRadius || 0, el.x, el.y, el.outerRadius);
    g.addColorStop(0, corEscuraDe(cor));
    g.addColorStop(0.55, cor);
    g.addColorStop(1, ajustarCor(cor, 0.25));
    opcoesProprias(el).backgroundColor = g;
  });
}

function desenharProfundidadeRosca(chart, meta) {
  const { ctx } = chart;
  const prof = TEMA.profundidadeRosca;
  meta.data.forEach(el => {
    const cor = el.$corNeon;
    if (!cor) return;
    const original = el.options.backgroundColor;
    const bordaOriginal = el.options.borderWidth;
    el.options.borderWidth = 0;            // sem borda nas camadas: lateral lisa
    for (let k = prof; k > 0; k -= 1) {
      ctx.save();
      ctx.translate(0, k);
      el.options.backgroundColor = ajustarCor(corEscuraDe(cor), -0.10 - (k / prof) * 0.35);
      el.draw(ctx);
      ctx.restore();
    }
    el.options.backgroundColor = original;
    el.options.borderWidth = bordaOriginal;
  });
}

// ------------------------------------------------------------ linhas
/** Área degradê embaixo das linhas (só quando há até 3 linhas, para não embolar). */
function prepararLinhas(chart) {
  const linhas = chart.data.datasets.filter(ds => (ds.type || chart.config.type) === 'line');
  if (!linhas.length || linhas.length > 3) return;
  linhas.forEach(ds => {
    if (ds.fill !== undefined || ds.borderDash || typeof ds.borderColor !== 'string') return;
    const cor = ds.borderColor;
    ds.fill = 'origin';
    ds.backgroundColor = ctx => {
      const area = ctx.chart.chartArea;
      if (!area) return ajustarCor(cor, 0, 0.1);
      const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, ajustarCor(cor, 0, 0.28));
      g.addColorStop(1, ajustarCor(cor, 0, 0));
      return g;
    };
  });
}

// ------------------------------------------------------------ plugin
const pluginNeon3D = {
  id: 'neon3d',
  beforeUpdate(chart, args, opts) {
    if (opts === false || (opts && opts.ativo === false)) return;
    prepararLinhas(chart);
  },
  beforeDatasetDraw(chart, args, opts) {
    if (opts === false || (opts && opts.ativo === false)) return;
    const meta = args.meta;
    const tipo = meta.type;
    const { ctx } = chart;

    if (tipo === 'bar') prepararBarras(chart, meta);
    if (tipo === 'doughnut' || tipo === 'pie') {
      prepararRosca(chart, meta);
      desenharProfundidadeRosca(chart, meta);
    }

    // brilho (glow) na cor do conjunto
    const ds = chart.data.datasets[args.index] || {};
    const base = ds.borderColor && typeof ds.borderColor === 'string' ? ds.borderColor
      : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor);
    ctx.save();
    if (typeof base === 'string') {
      ctx.shadowColor = ajustarCor(base, 0, tipo === 'line' ? 0.75 : 0.55);
      ctx.shadowBlur = tipo === 'line' ? 14 : 18;
    }
  },
  afterDatasetDraw(chart, args, opts) {
    if (opts === false || (opts && opts.ativo === false)) return;
    chart.ctx.restore();
    if (args.meta.type === 'bar') desenharFacesBarras(chart, args.meta);
  }
};

if (typeof Chart !== 'undefined') {
  aplicarPadroesTema();
  Chart.register(pluginNeon3D);
}
