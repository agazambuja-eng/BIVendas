/**
 * Aba Avaliação de Produtos · gráfico "Armações".
 *
 * - Rosca com a participação (valor líquido) de cada linha de armação:
 *   ARMACAO RX, ARMACAO SUN e ARMACAO CLIPON (outras linhas que começarem
 *   com "ARMACAO" também entram).
 * - Ao clicar no gráfico (ou no botão) abre uma janela, no mesmo estilo do
 *   "Comparar lojas": uma rosca por linha, com as grifes ao lado e o % de
 *   cada uma dentro daquela linha.
 * - A mesma grife tem a mesma cor nas três roscas.
 */

const LINHAS_ARMACAO = [
  { chave: 'RX', titulo: 'Armação RX', icone: '👓', cor: '#5ee7ff' },
  { chave: 'SUN', titulo: 'Armação Sun', icone: '🕶️', cor: '#ffd35e' },
  { chave: 'CLIPON', titulo: 'Armação Clip-on', icone: '🧲', cor: '#ff5cf0' }
];
const MAX_FATIAS_GRIFE = 9;   // na rosca da janela; o resto vira "OUTRAS" (a lista ao lado mostra todas)

let resumoArmacoes = null;     // { linhas: [...], total, qtd, coresGrife }
let graficoArmacoes = null;
let graficosJanelaArmacoes = [];

/** "Armação  Clip-On" -> "ARMACAOCLIPON" */
function chaveTexto(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Devolve a chave da linha de armação (RX, SUN, CLIPON, ou outra) ou null se não for armação. */
function linhaDeArmacao(nomeLinha) {
  const k = chaveTexto(nomeLinha);
  if (!k.startsWith('ARMACAO') && !k.startsWith('ARMACOES')) return null;
  const resto = k.replace(/^ARMAC(AO|OES)/, '');
  if (resto.includes('CLIP')) return 'CLIPON';
  if (resto.includes('SUN') || resto.includes('SOL')) return 'SUN';
  if (resto.includes('RX') || resto.includes('GRAU') || resto === '') return 'RX';
  return resto;   // outra linha de armação: aparece com o próprio nome
}

function pctTxt(v, total) {
  const p = total > 0 ? (v / total) * 100 : 0;
  return p.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

/** Agrupa os itens por linha de armação e grife. */
function resumirArmacoes(dados, campos) {
  const mapa = {};
  LINHAS_ARMACAO.forEach(l => { mapa[l.chave] = { ...l, liquido: 0, qtd: 0, grifes: {} }; });
  let total = 0, qtd = 0;
  const totalGrife = {};

  if (campos.linha) {
    (dados || []).forEach(item => {
      const nomeLinha = String(item[campos.linha] ?? '');
      const chave = linhaDeArmacao(nomeLinha);
      if (!chave) return;
      if (!mapa[chave]) mapa[chave] = { chave, titulo: nomeLinha.trim(), icone: '👓', cor: '#3dffa8', liquido: 0, qtd: 0, grifes: {} };
      const grife = campos.grife ? (String(item[campos.grife] ?? '').trim() || 'SEM GRIFE') : '—';
      const liq = parseNumeroBR(item.LIQUIDOPRODUTO);
      const q = parseNumeroBR(item.QUANTIDADE) || 0;
      const l = mapa[chave];
      l.liquido += liq; l.qtd += q;
      if (!l.grifes[grife]) l.grifes[grife] = { nome: grife, liquido: 0, qtd: 0 };
      l.grifes[grife].liquido += liq; l.grifes[grife].qtd += q;
      totalGrife[grife] = (totalGrife[grife] || 0) + liq;
      total += liq; qtd += q;
    });
  }

  // cor fixa por grife, pela ordem de venda em armações (mesma cor nas três roscas)
  const coresGrife = {};
  Object.keys(totalGrife).sort((a, b) => totalGrife[b] - totalGrife[a])
    .forEach((g, i) => { coresGrife[g] = CORES_PALETA[i % CORES_PALETA.length]; });
  coresGrife.OUTRAS = '#6b7299';

  const linhas = Object.values(mapa).map(l => ({
    ...l, grifes: Object.values(l.grifes).sort((a, b) => b.liquido - a.liquido)
  }));
  return { linhas, total, qtd, coresGrife };
}

/** Chamado por renderizarProdutos() a cada consulta / mudança de filtro. */
function renderizarArmacoes(dados, campos) {
  resumoArmacoes = resumirArmacoes(dados, campos);
  const { linhas, total, qtd } = resumoArmacoes;

  const legenda = document.getElementById('legendaArmacoes');
  const canvas = document.getElementById('graficoArmacoes');
  const vazio = document.getElementById('armacoesVazio');
  if (graficoArmacoes) { graficoArmacoes.destroy(); graficoArmacoes = null; }

  const temDados = total !== 0;
  if (vazio) {
    vazio.style.display = temDados ? 'none' : 'block';
    vazio.textContent = campos.linha
      ? 'Nenhuma armação (linha ARMACAO RX / SUN / CLIPON) nesta consulta.'
      : 'A API não trouxe o campo de linha nesta consulta.';
  }
  const sub = document.getElementById('subArmacoes');
  if (sub) sub.textContent = temDados ? `${qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un. · ${formatarMoedaBR(total)}` : '';

  if (legenda) {
    legenda.innerHTML = temDados ? linhas.map(l => `
      <li title="${escHTML(l.titulo)}: ${formatarMoedaBR(l.liquido)} · ${l.qtd.toLocaleString('pt-BR')} un.">
        <i style="background:${l.cor}; box-shadow: 0 0 8px ${l.cor};"></i>
        <span>${l.icone} ${escHTML(l.titulo)}</span>
        <b>${pctTxt(l.liquido, total)}</b>
        <small>${formatarMoedaBR(l.liquido)} · ${l.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un.</small>
      </li>`).join('') : '';
  }
  if (!canvas || !temDados) return;

  graficoArmacoes = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: linhas.map(l => l.titulo),
      datasets: [{ data: linhas.map(l => l.liquido), backgroundColor: linhas.map(l => l.cor) }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '58%',
      layout: { padding: { top: 6, bottom: 16, left: 6, right: 6 } },
      onClick: () => abrirJanelaArmacoes(),
      onHover: (e, els) => { e.native.target.style.cursor = 'pointer'; },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${pctTxt(c.raw, total)} · ${formatarMoedaBR(c.raw)}`, footer: () => 'Clique para ver as grifes' } }
      }
    }
  });
}

function fecharJanelaArmacoes() {
  const modal = document.getElementById('modalArmacoes');
  if (!modal) return;
  modal.classList.remove('aberto');
  setTimeout(() => {
    modal.style.display = 'none';
    graficosJanelaArmacoes.forEach(g => g.destroy());
    graficosJanelaArmacoes = [];
  }, 250);
}

function abrirJanelaArmacoes() {
  const modal = document.getElementById('modalArmacoes');
  const grade = document.getElementById('gradeArmacoes');
  if (!modal || !grade || !resumoArmacoes) return;
  const { linhas, total, coresGrife } = resumoArmacoes;

  const ini = document.getElementById('dataInicial').value;
  const fim = document.getElementById('dataFinal').value;
  document.getElementById('subtituloArmacoes').textContent =
    `${formatarDataISOparaBR(ini)} a ${formatarDataISOparaBR(fim)} · total em armações ${formatarMoedaBR(total)} · % das grifes dentro de cada linha (valor líquido)`;

  graficosJanelaArmacoes.forEach(g => g.destroy());
  graficosJanelaArmacoes = [];

  grade.innerHTML = linhas.map((l, i) => {
    const lista = l.grifes.length ? l.grifes.map((g, k) => `
        <li class="${k === 0 ? 'cl-destaque' : ''}" title="${escHTML(g.nome)}: ${formatarMoedaBR(g.liquido)} · ${g.qtd.toLocaleString('pt-BR')} un.">
          <i style="background:${coresGrife[g.nome]}; box-shadow: 0 0 8px ${coresGrife[g.nome]};"></i>
          <span>${escHTML(g.nome)}</span>
          <b>${pctTxt(g.liquido, l.liquido)}</b>
        </li>`).join('') : '<li class="arm-sem">Sem vendas nesta linha.</li>';
    return `<div class="cl-card" style="animation-delay:${i * 90}ms; border-top: 3px solid ${l.cor};">
      <div class="cl-card-topo">
        <div><strong>${l.icone} ${escHTML(l.titulo)}</strong><small>${l.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un. · ${l.grifes.length} grife(s)</small></div>
        <span class="cl-total">${formatarMoedaBR(l.liquido)}</span>
      </div>
      <div class="cl-corpo">
        <div class="cl-grafico"><canvas id="armGrafico${i}"></canvas>
          <div class="cl-centro"><b>${pctTxt(l.liquido, total)}</b><span>das armações</span></div>
        </div>
        <div class="cl-lado"><ul class="cl-lista arm-lista">${lista}</ul></div>
      </div>
    </div>`;
  }).join('');

  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('aberto'));

  linhas.forEach((l, i) => {
    setTimeout(() => {
      const canvas = document.getElementById(`armGrafico${i}`);
      if (!canvas || !modal.classList.contains('aberto') || !l.grifes.length) return;
      let fatias = l.grifes;
      if (fatias.length > MAX_FATIAS_GRIFE) {
        const resto = fatias.slice(MAX_FATIAS_GRIFE - 1);
        fatias = fatias.slice(0, MAX_FATIAS_GRIFE - 1).concat([{
          nome: 'OUTRAS', liquido: resto.reduce((s, g) => s + g.liquido, 0), qtd: resto.reduce((s, g) => s + g.qtd, 0)
        }]);
      }
      graficosJanelaArmacoes.push(new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: fatias.map(g => g.nome),
          datasets: [{ data: fatias.map(g => g.liquido), backgroundColor: fatias.map(g => coresGrife[g.nome]) }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '60%',
          layout: { padding: { top: 8, bottom: 16, left: 6, right: 6 } },
          animation: { animateRotate: true, animateScale: true, duration: 1100, easing: 'easeOutBack' },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => ` ${c.label}: ${pctTxt(c.raw, l.liquido)} · ${formatarMoedaBR(c.raw)} · ${fatias[c.dataIndex].qtd.toLocaleString('pt-BR')} un.` } }
          }
        }
      }));
    }, 150 + i * 90);
  });
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalArmacoes');
  if (e.key === 'Escape' && modal && modal.classList.contains('aberto')) fecharJanelaArmacoes();
});
