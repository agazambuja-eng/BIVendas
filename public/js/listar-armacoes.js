/**
 * Aba Avaliação de Produtos · "Lista de armações e solares" (abaixo do gráfico de armações).
 *
 * Lista em árvore, com triângulo para abrir/fechar (▸ / ▾):
 *   Linha (Armação RX, Sun, Clip-on)  >  Grife  >  Produto
 * tudo em ordem de quantidade vendida. Ao lado, uma coluna por loja
 * (com e sem venda) com a quantidade vendida; sem venda aparece "0" apagado.
 *
 * Usa o resumo montado por armacoes.js (resumoArmacoes).
 */

const abertosListaArm = new Set();   // ids dos nós abertos (linha / grife)
let listaArmAberta = false;          // o quadro inteiro ("descortinar")

function qtdTxt(n) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }

/** Lojas que aparecem como colunas: as do filtro; sem filtro, todas do cadastro. Inclui as que vieram nos dados. */
function lojasDaListaArmacoes(linhas) {
  const ids = new Set();
  const filtro = typeof normalizarListaLojas === 'function'
    ? normalizarListaLojas(document.getElementById('lojas')?.value || '') : '';
  if (filtro) filtro.split(',').forEach(id => ids.add(id));
  else (typeof lojasDisponiveis !== 'undefined' ? lojasDisponiveis : []).forEach(l => ids.add(String(Number(l.id))));
  linhas.forEach(l => l.lojas.forEach(lj => ids.add(String(lj.id))));
  ids.delete('?'); ids.delete('NaN');
  return [...ids].sort((a, b) => Number(a) - Number(b)).map(id => {
    const l = (typeof lojasDisponiveis !== 'undefined' ? lojasDisponiveis : []).find(x => String(Number(x.id)) === id);
    const nome = l ? String(l.nome || '').replace(/^0*\d+\s*[-–]?\s*/, '').trim() : '';
    return { id, nome };
  });
}

function celulasLojas(porLoja, lojas, classe) {
  return lojas.map(lj => {
    const q = porLoja[lj.id] || 0;
    return `<td class="la-num ${classe} ${q ? '' : 'la-zero'}">${qtdTxt(q)}</td>`;
  }).join('');
}

function renderizarListaArmacoes() {
  const caixa = document.getElementById('listaArmacoesCorpo');
  const resumo = document.getElementById('listaArmacoesResumo');
  if (!caixa || typeof resumoArmacoes === 'undefined' || !resumoArmacoes) return;
  document.getElementById('quadroListaArmacoes')?.classList.toggle('la-aberto', listaArmAberta);

  const linhas = resumoArmacoes.linhas.filter(l => l.qtd !== 0 || l.liquido !== 0);
  const nProdutos = linhas.reduce((s, l) => s + Object.keys(l.produtos).length, 0);
  if (resumo) resumo.textContent = linhas.length ? `${nProdutos} modelo(s) · ${qtdTxt(resumoArmacoes.qtd)} un.` : '';
  if (!listaArmAberta) { caixa.innerHTML = ''; return; }
  if (!linhas.length) { caixa.innerHTML = '<p class="arm-vazio">Nenhuma armação nesta consulta.</p>'; return; }

  const lojas = lojasDaListaArmacoes(linhas);
  const porQtd = (a, b) => b.qtd - a.qtd || b.liquido - a.liquido;
  let html = `<table class="la-tabela"><thead><tr>
      <th class="la-nome">Armação</th><th class="la-num">Qtd</th><th class="la-num">Valor líquido</th>
      ${lojas.map(lj => `<th class="la-num la-loja" title="${escHTML(lj.nome)}">${escHTML(lj.id)}${lj.nome ? `<small>${escHTML(lj.nome)}</small>` : ''}</th>`).join('')}
    </tr></thead><tbody>`;

  linhas.forEach(l => {
    const idL = `L:${l.chave}`;
    const abertaL = abertosListaArm.has(idL);
    const porLojaL = {}; l.lojas.forEach(lj => { porLojaL[lj.id] = lj.qtd; });
    const grifes = l.grifes.slice().sort(porQtd);
    html += `<tr class="la-n1" style="--cor-linha:${l.cor}" onclick="alternarNoListaArm('${idL}')">
      <td class="la-nome"><span class="la-seta ${abertaL ? 'aberta' : ''}">▸</span>${l.icone} ${escHTML(l.titulo)} <small>${grifes.length} grife(s)</small></td>
      <td class="la-num"><b>${qtdTxt(l.qtd)}</b></td><td class="la-num">${formatarMoedaBR(l.liquido)}</td>
      ${celulasLojas(porLojaL, lojas, '')}</tr>`;
    if (!abertaL) return;

    grifes.forEach(g => {
      const idG = `G:${l.chave}:${g.nome}`;
      const abertaG = abertosListaArm.has(idG);
      const produtos = Object.values(g.produtos || {}).sort(porQtd);
      html += `<tr class="la-n2" onclick="alternarNoListaArm(${escHTML(JSON.stringify(idG))})">
        <td class="la-nome"><span class="la-seta ${abertaG ? 'aberta' : ''}">▸</span><i style="background:${resumoArmacoes.coresGrife[g.nome] || '#6b7299'}"></i>${escHTML(g.nome)} <small>${produtos.length} modelo(s)</small></td>
        <td class="la-num"><b>${qtdTxt(g.qtd)}</b></td><td class="la-num">${formatarMoedaBR(g.liquido)}</td>
        ${celulasLojas(g.porLoja || {}, lojas, '')}</tr>`;
      if (!abertaG) return;

      produtos.forEach(p => {
        html += `<tr class="la-n3">
          <td class="la-nome" title="${escHTML(p.codigo)} · ${escHTML(p.descricao)}">
            <span class="la-desc">${escHTML(p.descricao)}</span>${p.codigo ? `<small>cód. ${escHTML(p.codigo)}</small>` : ''}
            ${typeof linkImagemProduto === 'function' ? `<a class="la-lupa" href="${linkImagemProduto(p)}" target="_blank" rel="noopener noreferrer" title="Ver imagens deste modelo na internet" onclick="event.stopPropagation()">🔍</a>` : ''}
          </td>
          <td class="la-num"><b>${qtdTxt(p.qtd)}</b></td><td class="la-num">${formatarMoedaBR(p.liquido)}</td>
          ${celulasLojas(p.porLoja || {}, lojas, 'la-prod')}</tr>`;
      });
    });
  });
  caixa.innerHTML = html + '</tbody></table>';
}

function alternarQuadroListaArm() {
  listaArmAberta = !listaArmAberta;
  renderizarListaArmacoes();
}

function alternarNoListaArm(id) {
  if (abertosListaArm.has(id)) {
    abertosListaArm.delete(id);
    if (id.startsWith('L:')) [...abertosListaArm].forEach(x => { if (x.startsWith('G:' + id.slice(2) + ':')) abertosListaArm.delete(x); });
  } else abertosListaArm.add(id);
  renderizarListaArmacoes();
}

/** Abre ou fecha tudo (linhas e grifes). */
function expandirListaArm(abrir, event) {
  if (event) event.stopPropagation();
  abertosListaArm.clear();
  if (abrir && resumoArmacoes) {
    listaArmAberta = true;
    resumoArmacoes.linhas.forEach(l => {
      abertosListaArm.add(`L:${l.chave}`);
      l.grifes.forEach(g => abertosListaArm.add(`G:${l.chave}:${g.nome}`));
    });
  }
  renderizarListaArmacoes();
}

/* ---------- Tela cheia só deste quadro ---------- */
function listaArmEmTelaCheia() {
  const q = document.getElementById('quadroListaArmacoes');
  return !!q && (document.fullscreenElement === q || q.classList.contains('la-tela-cheia'));
}

async function alternarTelaCheiaListaArm(event) {
  if (event) event.stopPropagation();   // não abre/fecha a lista
  const q = document.getElementById('quadroListaArmacoes');
  if (!q) return;
  if (listaArmEmTelaCheia()) {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    q.classList.remove('la-tela-cheia');
  } else {
    if (!listaArmAberta) { listaArmAberta = true; renderizarListaArmacoes(); }
    q.classList.add('la-tela-cheia');   // estilo da tela cheia (vale também se o navegador bloquear o modo nativo)
    if (q.requestFullscreen) await q.requestFullscreen().catch(() => {});
  }
  atualizarBotaoTelaCheiaListaArm();
}

function atualizarBotaoTelaCheiaListaArm() {
  const btn = document.getElementById('btnTelaCheiaListaArm');
  const ativo = listaArmEmTelaCheia();
  if (btn) {
    btn.textContent = ativo ? '✕ Voltar ao normal' : '⛶ Tela cheia';
    btn.title = ativo ? 'Sair da tela cheia (Esc)' : 'Ver só esta lista em tela cheia (Esc para sair)';
    btn.classList.toggle('ativo', ativo);
  }
}

// Esc / botão do navegador saem do modo nativo: tira o estilo também
document.addEventListener('fullscreenchange', () => {
  const q = document.getElementById('quadroListaArmacoes');
  if (q && document.fullscreenElement !== q) q.classList.remove('la-tela-cheia');
  atualizarBotaoTelaCheiaListaArm();
});
document.addEventListener('keydown', e => {
  const q = document.getElementById('quadroListaArmacoes');
  if (e.key === 'Escape' && q && q.classList.contains('la-tela-cheia') && !document.fullscreenElement) {
    q.classList.remove('la-tela-cheia');
    atualizarBotaoTelaCheiaListaArm();
  }
});
