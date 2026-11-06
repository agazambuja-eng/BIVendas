/**
 * Dashboard · "Indicações": de onde vieram os clientes (campo INDICACAO da API).
 *
 * - Rosca principal com o % de cada indicação; ao lado, a lista com
 *   quantidade de vendas, valor e %.
 * - Alterna entre Vendas (OS) e Valor (R$).
 * - "🔎 Comparar lojas": janela com uma rosca por loja (mesmo estilo do
 *   Comparar lojas de pagamentos), cada indicação sempre com a mesma cor.
 *
 * Uma venda (OS) conta uma vez: a indicação da OS é a do primeiro item que
 * tiver o campo preenchido. Sem indicação = "(SEM INDICAÇÃO)".
 */

const SEM_INDICACAO = '(SEM INDICAÇÃO)';
const MAX_FATIAS_INDICACAO = 10;   // na rosca; o resto vira OUTRAS (a lista mostra todas)

let indicMetrica = 'vendas';       // 'vendas' (OS) ou 'valor' (R$)
let resumoIndicacoes = null;       // { campo, total: {vendas, valor}, porIndic: [...], porLoja: {...}, cores }
let graficoIndicacoes = null;
let graficosJanelaIndic = [];

/** Descobre o nome do campo de indicação na API (INDICACAO, INDICAÇÃO, COMO_CONHECEU...). */
function campoIndicacao(dados) {
  const chaves = typeof chavesDosDados === 'function' ? chavesDosDados(dados) : Object.keys((dados || [])[0] || {});
  return chaves.find(k => /^INDICA/i.test(k)) || chaves.find(k => /INDICA/i.test(k)) ||
         chaves.find(k => /CONHECEU|ORIGEM.?CLIENTE|MIDIA/i.test(k)) || null;
}

function nomeIndicacao(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  return s || SEM_INDICACAO;
}

function idLojaIndic(item) {
  const m = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? '').match(/^0*(\d+)/);
  return m ? m[1] : '?';
}

function resumirIndicacoes(dados) {
  const campo = campoIndicacao(dados);
  // 1) agrupa por OS (uma venda conta uma vez)
  const porOS = {};
  (dados || []).forEach((item, i) => {
    const loja = idLojaIndic(item);
    const os = String(item.OS || item.CODIGODAVENDA || '').trim() || `item${i}`;
    const k = loja + '|' + os;
    if (!porOS[k]) porOS[k] = { loja, indic: '', valor: 0, bruto: 0 };
    const o = porOS[k];
    if (!o.indic && campo) o.indic = String(item[campo] ?? '').trim();
    o.valor += parseNumeroBR(item.LIQUIDOPRODUTO);
    o.bruto += parseNumeroBR(item.VALORBRUTOPRODUTO);
  });
  // 2) soma por indicação (geral e por loja). Venda = OS com bruto > 0.
  const geral = {}, porLoja = {};
  const soma = (m, nome, o) => {
    if (!m[nome]) m[nome] = { nome, vendas: 0, valor: 0 };
    m[nome].valor += o.valor;
    if (o.bruto > 0) m[nome].vendas += 1;
  };
  Object.values(porOS).forEach(o => {
    const nome = nomeIndicacao(o.indic);
    soma(geral, nome, o);
    if (!porLoja[o.loja]) porLoja[o.loja] = {};
    soma(porLoja[o.loja], nome, o);
  });
  const lista = Object.values(geral).sort((a, b) => b.vendas - a.vendas || b.valor - a.valor);
  // cor fixa por indicação (ordem geral); sem indicação sempre cinza
  const cores = {};
  let c = 0;
  lista.forEach(x => { cores[x.nome] = x.nome === SEM_INDICACAO ? '#6b7299' : CORES_PALETA[c++ % CORES_PALETA.length]; });
  cores.OUTRAS = '#4a5180';
  return {
    campo,
    total: { vendas: lista.reduce((s, x) => s + x.vendas, 0), valor: lista.reduce((s, x) => s + x.valor, 0) },
    porIndic: lista, porLoja, cores
  };
}

const valIndic = x => (x ? x[indicMetrica] || 0 : 0);
const fmtIndic = v => indicMetrica === 'vendas' ? `${Number(v).toLocaleString('pt-BR')} venda(s)` : formatarMoedaBR(v);
const pctIndic = (v, t) => (t > 0 ? (v / t) * 100 : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

function ordenarPorMetrica(lista) {
  return lista.slice().sort((a, b) => valIndic(b) - valIndic(a) || a.nome.localeCompare(b.nome));
}

/** Junta as menores em OUTRAS para a rosca. */
function fatiasIndic(lista) {
  if (lista.length <= MAX_FATIAS_INDICACAO) return lista;
  const resto = lista.slice(MAX_FATIAS_INDICACAO - 1);
  return lista.slice(0, MAX_FATIAS_INDICACAO - 1).concat([{
    nome: 'OUTRAS', vendas: resto.reduce((s, x) => s + x.vendas, 0), valor: resto.reduce((s, x) => s + x.valor, 0)
  }]);
}

/** Chamado por processarDadosBI (main.js). */
function renderizarIndicacoes(dados) {
  resumoIndicacoes = resumirIndicacoes(dados);
  desenharIndicacoes();
}

function desenharIndicacoes() {
  const r = resumoIndicacoes;
  if (!r) return;
  document.querySelectorAll('#indicMetrica button').forEach(b => b.classList.toggle('ativo', b.dataset.m === indicMetrica));
  const aviso = document.getElementById('avisoIndicacoes');
  const total = r.total[indicMetrica === 'vendas' ? 'vendas' : 'valor'];
  const sub = document.getElementById('subIndicacoes');
  if (sub) sub.textContent = r.porIndic.length ? `${r.total.vendas.toLocaleString('pt-BR')} vendas · ${formatarMoedaBR(r.total.valor)}` : '';
  if (aviso) {
    aviso.style.display = r.campo ? 'none' : 'block';
    aviso.textContent = 'A API não trouxe o campo de indicação (INDICACAO) nesta consulta.';
  }
  if (graficoIndicacoes) { graficoIndicacoes.destroy(); graficoIndicacoes = null; }
  const lista = ordenarPorMetrica(r.porIndic);
  const legenda = document.getElementById('legendaIndicacoes');
  if (legenda) {
    const maior = lista.length ? valIndic(lista[0]) : 0;
    legenda.innerHTML = r.campo ? lista.map(x => `
      <li class="${valIndic(x) === maior && maior > 0 ? 'cl-destaque' : ''}" title="${escHTML(x.nome)}: ${x.vendas} venda(s) · ${formatarMoedaBR(x.valor)}">
        <i style="background:${r.cores[x.nome]}; box-shadow: 0 0 8px ${r.cores[x.nome]};"></i>
        <span>${escHTML(x.nome)}</span>
        <small>${fmtIndic(valIndic(x))}</small>
        <b>${pctIndic(valIndic(x), total)}</b>
      </li>`).join('') : '';
  }
  const canvas = document.getElementById('graficoIndicacoes');
  if (!canvas || !r.campo || !lista.length) return;
  const fatias = fatiasIndic(lista);
  graficoIndicacoes = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: fatias.map(x => x.nome), datasets: [{ data: fatias.map(valIndic), backgroundColor: fatias.map(x => r.cores[x.nome]) }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '58%',
      layout: { padding: { top: 6, bottom: 16, left: 6, right: 6 } },
      onClick: () => abrirIndicacoesPorLoja(),
      onHover: e => { e.native.target.style.cursor = 'pointer'; },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${pctIndic(c.raw, total)} · ${fmtIndic(c.raw)}`, footer: () => 'Clique para comparar por loja' } }
      }
    }
  });
}

function escolherMetricaIndic(m) {
  indicMetrica = m;
  desenharIndicacoes();
  const modal = document.getElementById('modalIndicacoes');
  if (modal && modal.classList.contains('aberto')) abrirIndicacoesPorLoja();
}

// ------------------------------------------------------------- comparar por loja
function fecharIndicacoesPorLoja() {
  const modal = document.getElementById('modalIndicacoes');
  if (!modal) return;
  modal.classList.remove('aberto');
  setTimeout(() => {
    modal.style.display = 'none';
    graficosJanelaIndic.forEach(g => g.destroy());
    graficosJanelaIndic = [];
  }, 250);
}

function abrirIndicacoesPorLoja() {
  const modal = document.getElementById('modalIndicacoes');
  const grade = document.getElementById('gradeIndicacoes');
  const r = resumoIndicacoes;
  if (!modal || !grade || !r) return;
  document.querySelectorAll('#indicMetricaJanela button').forEach(b => b.classList.toggle('ativo', b.dataset.m === indicMetrica));

  const totalRede = r.total[indicMetrica === 'vendas' ? 'vendas' : 'valor'];
  const lojas = Object.entries(r.porLoja).map(([id, m]) => {
    const itens = ordenarPorMetrica(Object.values(m));
    return { id, itens, total: itens.reduce((s, x) => s + valIndic(x), 0), vendas: itens.reduce((s, x) => s + x.vendas, 0), valor: itens.reduce((s, x) => s + x.valor, 0) };
  }).sort((a, b) => b.total - a.total);

  const ini = document.getElementById('dataInicial').value, fim = document.getElementById('dataFinal').value;
  document.getElementById('subtituloIndicacoes').textContent =
    `${lojas.length} loja(s) · ${formatarDataISOparaBR(ini)} a ${formatarDataISOparaBR(fim)} · ${indicMetrica === 'vendas' ? 'por quantidade de vendas' : 'por valor líquido'}`;

  graficosJanelaIndic.forEach(g => g.destroy());
  graficosJanelaIndic = [];
  grade.innerHTML = lojas.length ? lojas.map((lj, i) => {
    const nome = typeof nomeLojaComparar === 'function' ? nomeLojaComparar(lj.id) : { titulo: `Loja ${lj.id}`, nome: '' };
    const maior = lj.itens.length ? valIndic(lj.itens[0]) : 0;
    const semInd = lj.itens.find(x => x.nome === SEM_INDICACAO);
    return `<div class="cl-card" style="animation-delay:${i * 90}ms">
      <div class="cl-card-topo">
        <div><strong>${escHTML(nome.titulo)}</strong><small>${escHTML(nome.nome)}</small></div>
        <span class="cl-total">${indicMetrica === 'vendas' ? lj.vendas + ' vendas' : formatarMoedaBR(lj.valor)}</span>
      </div>
      <div class="cl-corpo">
        <div class="cl-grafico"><canvas id="indGrafico${i}"></canvas>
          <div class="cl-centro"><b>${pctIndic(lj.total, totalRede)}</b><span>da rede</span></div>
        </div>
        <div class="cl-lado">
          <ul class="cl-lista">${lj.itens.filter(x => valIndic(x) > 0).map(x => `
            <li class="${valIndic(x) === maior ? 'cl-destaque' : ''}" title="${escHTML(x.nome)}: ${x.vendas} venda(s) · ${formatarMoedaBR(x.valor)}">
              <i style="background:${r.cores[x.nome]}; box-shadow: 0 0 8px ${r.cores[x.nome]};"></i>
              <span>${escHTML(x.nome)}</span><b>${pctIndic(valIndic(x), lj.total)}</b>
            </li>`).join('')}</ul>
          ${semInd && valIndic(semInd) > 0 ? `<div class="cl-resumo"><span title="Vendas sem o campo indicação preenchido">⚠️ Sem indicação <b class="${valIndic(semInd) / lj.total > 0.2 ? 'cl-ruim' : ''}">${pctIndic(valIndic(semInd), lj.total)}</b></span></div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('') : '<p class="cl-vazio">Nenhuma venda no período consultado.</p>';

  if (modal.style.display !== 'flex') {
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('aberto'));
  }
  lojas.forEach((lj, i) => {
    setTimeout(() => {
      const canvas = document.getElementById(`indGrafico${i}`);
      if (!canvas || !modal.classList.contains('aberto')) return;
      const fatias = fatiasIndic(lj.itens.filter(x => valIndic(x) > 0));
      graficosJanelaIndic.push(new Chart(canvas, {
        type: 'doughnut',
        data: { labels: fatias.map(x => x.nome), datasets: [{ data: fatias.map(valIndic), backgroundColor: fatias.map(x => r.cores[x.nome]) }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '60%',
          layout: { padding: { top: 8, bottom: 16, left: 6, right: 6 } },
          animation: { animateRotate: true, animateScale: true, duration: 1100, easing: 'easeOutBack' },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${pctIndic(c.raw, lj.total)} · ${fmtIndic(c.raw)}` } } }
        }
      }));
    }, 150 + i * 90);
  });
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalIndicacoes');
  if (e.key === 'Escape' && modal && modal.classList.contains('aberto')) fecharIndicacoesPorLoja();
});
