/**
 * Aba Avaliação de Produtos · "Lentes fotossensíveis".
 *
 * Três roscas, uma por fabricante. Cada uma mostra quanto das lentes daquela
 * marca foi vendido com a tecnologia fotossensível dela:
 *   ZEISS            -> descrição com PHOTOFUSION
 *   ESSILOR/VARILUX  -> descrição com TRANSITIONS
 *   HOYA             -> descrição com SENSITY
 *
 * Grupo (100%) = itens da marca (pela grife ou, sem grife, pela descrição),
 * sem armações. Alterna Unidades / Valor (R$).
 */

const MARCAS_FOTO = [
  { chave: 'ZEISS', titulo: 'ZEISS', tecnologia: 'PHOTOFUSION', marca: /ZEISS/, foto: /PHOTO\s*-?\s*FUSION/, cor: '#5ee7ff' },
  { chave: 'ESSILOR', titulo: 'ESSILOR / VARILUX', tecnologia: 'TRANSITIONS', marca: /ESSILOR|VARILUX|CRIZAL|EYEZEN/, foto: /TRANSITION/, cor: '#ff5cf0' },
  { chave: 'HOYA', titulo: 'HOYA', tecnologia: 'SENSITY', marca: /HOYA/, foto: /SENSITY/, cor: '#ffd35e' }
];
const COR_DEMAIS_LENTES = '#3a4170';

let fotoMetrica = 'qtd';      // 'qtd' ou 'liquido'
let resumoFoto = null;
let graficosFoto = [];

function textoSemAcento(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function resumirLentesFoto(dados, campos) {
  const r = {};
  MARCAS_FOTO.forEach(m => { r[m.chave] = { ...m, total: { qtd: 0, liquido: 0 }, foto: { qtd: 0, liquido: 0 }, produtos: {}, lojas: {} }; });
  (dados || []).forEach(item => {
    const linha = campos.linha ? item[campos.linha] : '';
    if (typeof linhaDeArmacao === 'function' && linhaDeArmacao(linha)) return;   // armações ficam de fora
    const desc = textoSemAcento(campos.descricao ? item[campos.descricao] : (item.DESCRICAO || item.PRODUTO));
    const grife = textoSemAcento(campos.grife ? item[campos.grife] : '');
    // marca pela grife; se a grife não for de nenhuma das 3, tenta pela descrição
    const marca = (grife && MARCAS_FOTO.find(m => m.marca.test(grife))) ||
                  MARCAS_FOTO.find(m => m.marca.test(desc)) || MARCAS_FOTO.find(m => m.foto.test(desc));
    if (!marca) return;
    const q = parseNumeroBR(item.QUANTIDADE) || 0;
    const v = parseNumeroBR(item.LIQUIDOPRODUTO);
    const g = r[marca.chave];
    g.total.qtd += q; g.total.liquido += v;
    // por loja (janela "Por loja")
    const ml = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? '').match(/^0*(\d+)/);
    const idLoja = ml ? ml[1] : '?';
    const lj = g.lojas[idLoja] || (g.lojas[idLoja] = { id: idLoja, total: { qtd: 0, liquido: 0 }, foto: { qtd: 0, liquido: 0 }, produtos: {} });
    lj.total.qtd += q; lj.total.liquido += v;
    if (marca.foto.test(desc)) {
      g.foto.qtd += q; g.foto.liquido += v;
      lj.foto.qtd += q; lj.foto.liquido += v;
      const nomeL = String(campos.descricao ? item[campos.descricao] : item.DESCRICAO || '').trim() || '—';
      const pl = lj.produtos[nomeL] || (lj.produtos[nomeL] = { nome: nomeL, qtd: 0, liquido: 0 });
      pl.qtd += q; pl.liquido += v;
      const nome = String(campos.descricao ? item[campos.descricao] : item.DESCRICAO || '').trim() || '—';
      const p = g.produtos[nome] || (g.produtos[nome] = { nome, qtd: 0, liquido: 0 });
      p.qtd += q; p.liquido += v;
    }
  });
  return MARCAS_FOTO.map(m => r[m.chave]);
}

const fmtFoto = v => fotoMetrica === 'qtd' ? `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un.` : formatarMoedaBR(v);
const pctFoto = (v, t) => (t > 0 ? (v / t) * 100 : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

/** Chamado por renderizarProdutos (produtos.js). */
function renderizarLentesFoto(dados, campos) {
  resumoFoto = resumirLentesFoto(dados, campos);
  desenharLentesFoto();
}

function desenharLentesFoto() {
  const grade = document.getElementById('gradeLentesFoto');
  if (!grade || !resumoFoto) return;
  document.querySelectorAll('#fotoMetrica button').forEach(b => b.classList.toggle('ativo', b.dataset.m === fotoMetrica));
  graficosFoto.forEach(g => g.destroy());
  graficosFoto = [];

  const totFoto = resumoFoto.reduce((s, m) => s + m.foto[fotoMetrica], 0);
  const totGrupo = resumoFoto.reduce((s, m) => s + m.total[fotoMetrica], 0);
  const sub = document.getElementById('subLentesFoto');
  if (sub) sub.textContent = totGrupo ? `${fmtFoto(totFoto)} fotossensíveis de ${fmtFoto(totGrupo)} nas 3 marcas · ${pctFoto(totFoto, totGrupo)}` : '';

  grade.innerHTML = resumoFoto.map((m, i) => {
    const tot = m.total[fotoMetrica], foto = m.foto[fotoMetrica];
    const top = Object.values(m.produtos).sort((a, b) => b[fotoMetrica] - a[fotoMetrica]).slice(0, 3);
    return `<div class="lf-card" style="--cor-marca:${m.cor}; animation-delay:${i * 90}ms">
      <div class="lf-topo">
        <div><strong>${escHTML(m.titulo)}</strong><small>${escHTML(m.tecnologia)}</small></div>
        <span class="lf-pct">${tot ? pctFoto(foto, tot) : '—'}</span>
      </div>
      ${tot ? `<div class="lf-grafico"><canvas id="lfGrafico${i}"></canvas>
          <div class="cl-centro"><b>${pctFoto(foto, tot)}</b><span>${escHTML(m.tecnologia.toLowerCase())}</span></div></div>
        <ul class="lf-legenda">
          <li><i style="background:${m.cor}; box-shadow: 0 0 8px ${m.cor}"></i><span>${escHTML(m.tecnologia)}</span><b>${fmtFoto(foto)}</b></li>
          <li><i style="background:${COR_DEMAIS_LENTES}"></i><span>Demais ${escHTML(m.titulo)}</span><b>${fmtFoto(tot - foto)}</b></li>
          <li class="lf-total"><i></i><span>Total ${escHTML(m.titulo)}</span><b>${fmtFoto(tot)}</b></li>
        </ul>
        ${top.length ? `<div class="lf-top"><div class="lf-top-tit">Mais vendidas ${escHTML(m.tecnologia)}</div>${top.map(p => `
          <div class="lf-top-item" title="${escHTML(p.nome)}"><span>${escHTML(p.nome)}</span><b>${fmtFoto(p[fotoMetrica])}</b></div>`).join('')}</div>` : ''}`
        : `<p class="arm-vazio">Nenhuma venda ${escHTML(m.titulo)} nesta consulta.</p>`}
      ${tot ? `<button type="button" class="btn-comparar-lojas lf-btn-lojas" onclick="abrirLentesFotoPorLoja(${i})" title="Uma rosca por loja: ${escHTML(m.tecnologia)} x demais ${escHTML(m.titulo)}">🏬 Por loja (${Object.keys(m.lojas).length})</button>` : ''}
    </div>`;
  }).join('');

  resumoFoto.forEach((m, i) => {
    const canvas = document.getElementById(`lfGrafico${i}`);
    if (!canvas) return;
    const tot = m.total[fotoMetrica], foto = m.foto[fotoMetrica];
    graficosFoto.push(new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: [m.tecnologia, `Demais ${m.titulo}`],
        datasets: [{ data: [foto, Math.max(0, tot - foto)], backgroundColor: [m.cor, COR_DEMAIS_LENTES] }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        layout: { padding: { top: 8, bottom: 16, left: 6, right: 6 } },
        animation: { animateRotate: true, animateScale: true, duration: 1000, easing: 'easeOutBack' },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${pctFoto(c.raw, tot)} · ${fmtFoto(c.raw)}` } } }
      }
    }));
  });
}

function escolherMetricaFoto(m) {
  fotoMetrica = m;
  desenharLentesFoto();
}

/* ---------- seções com triângulo expansor (Armações e Solares, Lentes fotossensíveis) ---------- */
const CHAVE_SECOES_FECHADAS = 'bi_secoes_produtos_fechadas';
function lerSecoesFechadas() { try { return JSON.parse(localStorage.getItem(CHAVE_SECOES_FECHADAS) || '[]'); } catch { return []; } }

function alternarSecaoProdutos(id) {
  const sec = document.getElementById(id);
  if (!sec) return;
  const fechar = !sec.classList.contains('fechada');
  sec.classList.toggle('fechada', fechar);
  try {
    const set = new Set(lerSecoesFechadas());
    if (fechar) set.add(id); else set.delete(id);
    localStorage.setItem(CHAVE_SECOES_FECHADAS, JSON.stringify([...set]));
  } catch { /* sem armazenamento */ }
  // gráficos que estavam escondidos precisam se redesenhar no tamanho certo
  if (!fechar) {
    if (id === 'secaoLentesFoto') desenharLentesFoto();
    if (id === 'secaoArmacoesSolares' && typeof graficoArmacoes !== 'undefined' && graficoArmacoes) graficoArmacoes.resize();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  lerSecoesFechadas().forEach(id => document.getElementById(id)?.classList.add('fechada'));
});

/* ---------- janela "Por loja" de uma marca ---------- */
let graficosFotoLoja = [];
let fotoMarcaAberta = null;

function fecharLentesFotoPorLoja() {
  const modal = document.getElementById('modalLentesFoto');
  if (!modal) return;
  modal.classList.remove('aberto');
  fotoMarcaAberta = null;
  setTimeout(() => { modal.style.display = 'none'; graficosFotoLoja.forEach(g => g.destroy()); graficosFotoLoja = []; }, 250);
}

function abrirLentesFotoPorLoja(i) {
  const m = resumoFoto && resumoFoto[i];
  const modal = document.getElementById('modalLentesFoto');
  const grade = document.getElementById('gradeLentesFotoLojas');
  if (!m || !modal || !grade) return;
  fotoMarcaAberta = i;
  document.querySelectorAll('#fotoMetricaJanela button').forEach(b => b.classList.toggle('ativo', b.dataset.m === fotoMetrica));

  const lojas = Object.values(m.lojas).sort((a, b) => b.total[fotoMetrica] - a.total[fotoMetrica]);
  const totMarca = m.total[fotoMetrica];
  const ini = document.getElementById('dataInicial').value, fim = document.getElementById('dataFinal').value;
  document.getElementById('tituloLentesFoto').textContent = `🌗 ${m.titulo} · ${m.tecnologia} por loja`;
  document.getElementById('subtituloLentesFoto').textContent =
    `${lojas.length} loja(s) venderam ${m.titulo} · ${formatarDataISOparaBR(ini)} a ${formatarDataISOparaBR(fim)} · rede: ${pctFoto(m.foto[fotoMetrica], totMarca)} ${m.tecnologia} (${fmtFoto(m.foto[fotoMetrica])} de ${fmtFoto(totMarca)})`;

  graficosFotoLoja.forEach(g => g.destroy());
  graficosFotoLoja = [];
  const pctRede = totMarca > 0 ? m.foto[fotoMetrica] / totMarca : 0;
  grade.innerHTML = lojas.map((lj, k) => {
    const nome = typeof nomeLojaComparar === 'function' ? nomeLojaComparar(lj.id) : { titulo: `Loja ${lj.id}`, nome: '' };
    const tot = lj.total[fotoMetrica], foto = lj.foto[fotoMetrica];
    const acima = tot > 0 && foto / tot >= pctRede;
    const top = Object.values(lj.produtos).sort((a, b) => b[fotoMetrica] - a[fotoMetrica]).slice(0, 2);
    return `<div class="cl-card" style="animation-delay:${k * 90}ms; border-top: 3px solid ${m.cor};">
      <div class="cl-card-topo">
        <div><strong>${escHTML(nome.titulo)}</strong><small>${escHTML(nome.nome)}</small></div>
        <span class="cl-total" title="Total ${escHTML(m.titulo)} na loja">${fmtFoto(tot)}</span>
      </div>
      <div class="cl-corpo">
        <div class="cl-grafico"><canvas id="lfLoja${k}"></canvas>
          <div class="cl-centro"><b>${pctFoto(foto, tot)}</b><span>${escHTML(m.tecnologia.toLowerCase())}</span></div>
        </div>
        <div class="cl-lado">
          <ul class="cl-lista">
            <li class="cl-destaque"><i style="background:${m.cor}; box-shadow: 0 0 8px ${m.cor};"></i><span>${escHTML(m.tecnologia)}</span><b>${fmtFoto(foto)}</b></li>
            <li><i style="background:${COR_DEMAIS_LENTES}"></i><span>Demais</span><b>${fmtFoto(tot - foto)}</b></li>
          </ul>
          <div class="cl-resumo">
            <span title="Participação da loja nas vendas ${escHTML(m.titulo)} da rede">🏬 da rede <b>${pctFoto(tot, totMarca)}</b></span>
            <span title="Comparado com o % ${escHTML(m.tecnologia)} da rede (${pctFoto(m.foto[fotoMetrica], totMarca)})">${acima ? '▲ acima' : '▼ abaixo'} da média <b class="${acima ? 'cl-bom' : 'cl-ruim'}">${pctFoto(m.foto[fotoMetrica], totMarca)}</b></span>
          </div>
          ${top.length ? `<div class="lf-top">${top.map(p => `<div class="lf-top-item" title="${escHTML(p.nome)}"><span>${escHTML(p.nome)}</span><b style="color:${m.cor}">${fmtFoto(p[fotoMetrica])}</b></div>`).join('')}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('') || '<p class="cl-vazio">Nenhuma loja vendeu esta marca no período.</p>';

  if (modal.style.display !== 'flex') {
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('aberto'));
  }
  lojas.forEach((lj, k) => {
    setTimeout(() => {
      const canvas = document.getElementById(`lfLoja${k}`);
      if (!canvas || !modal.classList.contains('aberto')) return;
      const tot = lj.total[fotoMetrica], foto = lj.foto[fotoMetrica];
      graficosFotoLoja.push(new Chart(canvas, {
        type: 'doughnut',
        data: { labels: [m.tecnologia, `Demais ${m.titulo}`], datasets: [{ data: [foto, Math.max(0, tot - foto)], backgroundColor: [m.cor, COR_DEMAIS_LENTES] }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '60%',
          layout: { padding: { top: 8, bottom: 16, left: 6, right: 6 } },
          animation: { animateRotate: true, animateScale: true, duration: 1000, easing: 'easeOutBack' },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${pctFoto(c.raw, tot)} · ${fmtFoto(c.raw)}` } } }
        }
      }));
    }, 150 + k * 90);
  });
}

function escolherMetricaFotoJanela(mt) {
  fotoMetrica = mt;
  desenharLentesFoto();
  if (fotoMarcaAberta !== null) abrirLentesFotoPorLoja(fotoMarcaAberta);
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalLentesFoto');
  if (e.key === 'Escape' && modal && modal.classList.contains('aberto')) fecharLentesFotoPorLoja();
});
