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
  LINHAS_ARMACAO.forEach(l => { mapa[l.chave] = { ...l, liquido: 0, qtd: 0, grifes: {}, lojas: {}, produtos: {} }; });
  let total = 0, qtd = 0;
  const totalGrife = {};

  if (campos.linha) {
    (dados || []).forEach(item => {
      const nomeLinha = String(item[campos.linha] ?? '');
      const chave = linhaDeArmacao(nomeLinha);
      if (!chave) return;
      if (!mapa[chave]) mapa[chave] = { chave, titulo: nomeLinha.trim(), icone: '👓', cor: '#3dffa8', liquido: 0, qtd: 0, grifes: {}, lojas: {}, produtos: {} };
      const grife = campos.grife ? (String(item[campos.grife] ?? '').trim() || 'SEM GRIFE') : '—';
      const liq = parseNumeroBR(item.LIQUIDOPRODUTO);
      const q = parseNumeroBR(item.QUANTIDADE) || 0;
      const l = mapa[chave];
      l.liquido += liq; l.qtd += q;
      // loja do item
      const m = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? '').match(/^0*(\d+)/);
      const loja = m ? m[1] : '?';
      if (!l.grifes[grife]) l.grifes[grife] = { nome: grife, liquido: 0, qtd: 0, porLoja: {}, produtos: {} };
      const gf = l.grifes[grife];
      gf.liquido += liq; gf.qtd += q;
      gf.porLoja[loja] = (gf.porLoja[loja] || 0) + q;
      // por loja (para a janela "por loja" de cada linha)
      if (!l.lojas[loja]) l.lojas[loja] = { id: loja, liquido: 0, qtd: 0, grifes: {} };
      const lj = l.lojas[loja];
      lj.liquido += liq; lj.qtd += q;
      if (!lj.grifes[grife]) lj.grifes[grife] = { nome: grife, liquido: 0, qtd: 0 };
      lj.grifes[grife].liquido += liq; lj.grifes[grife].qtd += q;
      // por produto (pódio das 3 armações mais vendidas da linha)
      const cod = campos.codigo ? String(item[campos.codigo] ?? '').trim() : '';
      const desc = campos.descricao ? String(item[campos.descricao] ?? '').trim() : '';
      const kp = `${cod}|${desc}`;
      if (!l.produtos[kp]) l.produtos[kp] = { codigo: cod, descricao: desc || cod || '—', grife, liquido: 0, qtd: 0, porLoja: {} };
      const pr = l.produtos[kp];
      pr.liquido += liq; pr.qtd += q;
      pr.porLoja[loja] = (pr.porLoja[loja] || 0) + q;
      gf.produtos[kp] = pr;   // mesmo objeto: lista "Lista de armações e solares" (linha > grife > produto)
      totalGrife[grife] = (totalGrife[grife] || 0) + liq;
      total += liq; qtd += q;
    });
  }

  // cor fixa por grife, pela ordem de venda em armações (mesma cor nas três roscas)
  const coresGrife = {};
  Object.keys(totalGrife).sort((a, b) => totalGrife[b] - totalGrife[a])
    .forEach((g, i) => { coresGrife[g] = CORES_PALETA[i % CORES_PALETA.length]; });
  coresGrife.OUTRAS = '#6b7299';

  const ordenar = obj => Object.values(obj).sort((a, b) => b.liquido - a.liquido);
  const linhas = Object.values(mapa).map(l => ({
    ...l, grifes: ordenar(l.grifes),
    lojas: ordenar(l.lojas).map(lj => ({ ...lj, grifes: ordenar(lj.grifes) })),
    // mais vendidas = mais unidades; empate decide pelo valor líquido
    top: Object.values(l.produtos).filter(p => p.qtd > 0)
      .sort((a, b) => b.qtd - a.qtd || b.liquido - a.liquido).slice(0, 3)
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
  renderizarPodioArmacoes(temDados ? linhas : []);
  if (typeof renderizarListaArmacoes === 'function') renderizarListaArmacoes();
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

/** Link do Google Imagens pela descrição do produto (acrescenta a grife se ela não estiver na descrição). */
function linkImagemProduto(p) {
  const desc = String(p.descricao || '').trim();
  const grife = String(p.grife || '').trim();
  const termo = (grife && grife !== 'SEM GRIFE' && grife !== '—' && !desc.toUpperCase().includes(grife.toUpperCase()) ? grife + ' ' : '') + desc;
  return 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(termo);
}

const MEDALHAS = [
  { icone: '🏆', classe: 'ouro', nome: 'Ouro' },
  { icone: '🥈', classe: 'prata', nome: 'Prata' },
  { icone: '🥉', classe: 'bronze', nome: 'Bronze' }
];

/** As 3 armações mais vendidas (unidades) de cada linha, com troféu ouro/prata/bronze. */
function renderizarPodioArmacoes(linhas) {
  const caixa = document.getElementById('podioArmacoes');
  if (!caixa) return;
  caixa.style.display = linhas.length ? '' : 'none';
  caixa.innerHTML = linhas.map(l => `
    <div class="arm-podio-col" style="--cor-linha:${l.cor}">
      <div class="arm-podio-titulo">${l.icone} ${escHTML(l.titulo)} <small>top 3</small></div>
      ${l.top.length ? l.top.map((p, i) => `
        <div class="arm-podio-item arm-${MEDALHAS[i].classe}" title="${escHTML(p.codigo)} · ${escHTML(p.descricao)}\n${escHTML(p.grife)} · ${p.qtd.toLocaleString('pt-BR')} un. · ${formatarMoedaBR(p.liquido)}">
          <span class="arm-trofeu" aria-label="${MEDALHAS[i].nome}">${MEDALHAS[i].icone}</span>
          <div class="arm-podio-txt">
            <b>${escHTML(p.descricao)}</b>
            <small>${escHTML(p.grife)}${p.codigo ? ' · cód. ' + escHTML(p.codigo) : ''}</small>
            <span class="arm-podio-num"><b>${p.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un.</b> · ${formatarMoedaBR(p.liquido)}</span>
          </div>
          <a class="arm-lupa" href="${linkImagemProduto(p)}" target="_blank" rel="noopener noreferrer"
             title="Ver imagens deste modelo na internet (abre o Google Imagens em outra aba)">🔍</a>
        </div>`).join('') : '<div class="arm-sem">Sem vendas.</div>'}
    </div>`).join('');
}

function fecharJanelaArmacoes() {
  const modal = document.getElementById('modalArmacoes');
  if (!modal) return;
  modal.classList.remove('aberto');
  setTimeout(() => {
    modal.style.display = 'none';
    destruirRoscasJanela();
  }, 250);
}

function destruirRoscasJanela() {
  graficosJanelaArmacoes.forEach(g => g.destroy());
  graficosJanelaArmacoes = [];
}

function periodoTexto() {
  return `${formatarDataISOparaBR(document.getElementById('dataInicial').value)} a ${formatarDataISOparaBR(document.getElementById('dataFinal').value)}`;
}

/**
 * Desenha uma grade de cartões "rosca + grifes ao lado".
 * cards: [{ titulo, subtitulo, total, grifes, centro, rotuloCentro, cor, onClick? }]
 */
function desenharCartoesGrifes(cards) {
  const grade = document.getElementById('gradeArmacoes');
  const modal = document.getElementById('modalArmacoes');
  const { coresGrife } = resumoArmacoes;
  destruirRoscasJanela();

  grade.innerHTML = cards.length ? cards.map((c, i) => {
    const lista = c.grifes.length ? c.grifes.map((g, k) => `
        <li class="${k === 0 ? 'cl-destaque' : ''}" title="${escHTML(g.nome)}: ${formatarMoedaBR(g.liquido)} · ${g.qtd.toLocaleString('pt-BR')} un.">
          <i style="background:${coresGrife[g.nome]}; box-shadow: 0 0 8px ${coresGrife[g.nome]};"></i>
          <span>${escHTML(g.nome)}</span>
          <b>${pctTxt(g.liquido, c.total)}</b>
        </li>`).join('') : '<li class="arm-sem">Sem vendas.</li>';
    return `<div class="cl-card ${c.onClick ? 'arm-clicavel' : ''}" data-i="${i}" style="animation-delay:${i * 70}ms; border-top: 3px solid ${c.cor};"
        ${c.onClick ? 'title="Clique para ver por loja"' : ''}>
      <div class="cl-card-topo">
        <div><strong>${c.titulo}</strong><small>${c.subtitulo}</small></div>
        <span class="cl-total">${formatarMoedaBR(c.total)}</span>
      </div>
      <div class="cl-corpo">
        <div class="cl-grafico"><canvas id="armGrafico${i}"></canvas>
          <div class="cl-centro"><b>${c.centro}</b><span>${c.rotuloCentro}</span></div>
        </div>
        <div class="cl-lado"><ul class="cl-lista arm-lista">${lista}</ul></div>
      </div>
      ${c.onClick ? '<div class="arm-dica">🏬 Ver por loja ›</div>' : ''}
    </div>`;
  }).join('') : '<p class="cl-vazio">Nenhuma venda.</p>';

  grade.querySelectorAll('.arm-clicavel').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.cl-lista')) return;   // rolar a lista não abre
      cards[+el.dataset.i].onClick();
    });
  });

  cards.forEach((c, i) => {
    setTimeout(() => {
      const canvas = document.getElementById(`armGrafico${i}`);
      if (!canvas || !modal.classList.contains('aberto') || !c.grifes.length) return;
      let fatias = c.grifes;
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
          animation: { animateRotate: true, animateScale: true, duration: 1000, easing: 'easeOutBack' },
          onClick: c.onClick ? () => c.onClick() : undefined,
          onHover: c.onClick ? (e => { e.native.target.style.cursor = 'pointer'; }) : undefined,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: t => ` ${t.label}: ${pctTxt(t.raw, c.total)} · ${formatarMoedaBR(t.raw)} · ${fatias[t.dataIndex].qtd.toLocaleString('pt-BR')} un.` } }
          }
        }
      }));
    }, 150 + i * 70);
  });
}

function mostrarJanela() {
  const modal = document.getElementById('modalArmacoes');
  if (modal.style.display !== 'flex') {
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('aberto'));
  }
  modal.scrollTop = 0;
}

/** 1º nível: uma rosca por linha (RX, Sun, Clip-on). */
function abrirJanelaArmacoes() {
  const modal = document.getElementById('modalArmacoes');
  if (!modal || !resumoArmacoes) return;
  const { linhas, total } = resumoArmacoes;

  document.getElementById('tituloArmacoes').textContent = '🕶️ Armações · grifes por linha';
  document.getElementById('btnVoltarArmacoes').style.display = 'none';
  document.getElementById('subtituloArmacoes').textContent =
    `${periodoTexto()} · total em armações ${formatarMoedaBR(total)} · % das grifes dentro de cada linha (valor líquido) · clique numa linha para ver por loja`;

  mostrarJanela();
  // espera o modal ter a classe "aberto" antes de desenhar
  requestAnimationFrame(() => requestAnimationFrame(() => desenharCartoesGrifes(linhas.map((l, i) => ({
    titulo: `${l.icone} ${escHTML(l.titulo)}`,
    subtitulo: `${l.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un. · ${l.grifes.length} grife(s) · ${l.lojas.length} loja(s)`,
    total: l.liquido, grifes: l.grifes, cor: l.cor,
    centro: pctTxt(l.liquido, total), rotuloCentro: 'das armações',
    onClick: l.liquido ? () => abrirArmacoesPorLoja(i) : null
  })))));
}

/** 2º nível: a linha escolhida, uma rosca por loja com as grifes vendidas nela. */
function abrirArmacoesPorLoja(indiceLinha) {
  const l = resumoArmacoes.linhas[indiceLinha];
  if (!l) return;
  document.getElementById('tituloArmacoes').textContent = `${l.icone} ${l.titulo} · grifes por loja`;
  document.getElementById('btnVoltarArmacoes').style.display = '';
  document.getElementById('subtituloArmacoes').textContent =
    `${periodoTexto()} · ${l.lojas.length} loja(s) · total ${formatarMoedaBR(l.liquido)} · ${l.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un. · % das grifes dentro de cada loja`;
  mostrarJanela();
  desenharCartoesGrifes(l.lojas.map(lj => {
    const nome = typeof nomeLojaComparar === 'function' ? nomeLojaComparar(lj.id) : { titulo: `Loja ${lj.id}`, nome: '' };
    return {
      titulo: `${escHTML(nome.titulo)}${nome.nome ? ` <em class="arm-nome-loja">${escHTML(nome.nome)}</em>` : ''}`,
      subtitulo: `${lj.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un. · ${lj.grifes.length} grife(s)`,
      total: lj.liquido, grifes: lj.grifes, cor: l.cor,
      centro: pctTxt(lj.liquido, l.liquido), rotuloCentro: `da ${l.titulo.replace('Armação ', '')}`
    };
  }));
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalArmacoes');
  if (e.key === 'Escape' && modal && modal.classList.contains('aberto')) fecharJanelaArmacoes();
});
