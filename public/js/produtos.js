/**
 * Produtos e campos da API Savwin (ProdutosPorOSGRID).
 *
 * 1) Detalhes de Vendas: além das colunas fixas, mostra TODOS os outros
 *    campos que a API devolver (colunas extras automáticas) e exporta CSV.
 * 2) Aba "Avaliação de Produtos": agrupa por produto, grife e linha.
 *    Os nomes dos campos de grife/linha são descobertos pelo nome do campo
 *    (GRIFE, MARCA, LINHA, GRUPO...). Se a API não trouxer, a aba avisa e
 *    lista os campos disponíveis.
 */

// Campos que já têm coluna própria na tabela de Detalhes
const CAMPOS_FIXOS_DETALHES = new Set([
  'LOJA', 'LOJANOME', 'CODIGOLOJA', 'OS', 'CODIGODAVENDA', 'DATA', 'CLIENTE', 'VENDEDOR',
  'CODIGO', 'DESCRICAO', 'PRODUTO', 'QUANTIDADE', 'VALORBRUTOPRODUTO', 'DESCPRODUTO',
  'LIQUIDOPRODUTO', 'TIPOVENDA'
]);

const PADROES_CAMPOS = {
  grife:     [/^GRIFE$/i, /GRIFE/i, /^MARCA$/i, /MARCA/i, /FABRICANTE/i, /FORNECEDOR/i],
  linha:     [/^LINHA$/i, /LINHA/i, /SUBGRUPO/i, /^GRUPO$/i, /GRUPO.?PRODUTO/i, /GRUPO/i, /FAMILIA/i, /CATEGORIA/i, /TIPO.?PRODUTO/i, /CLASSE/i],
  codigo:    [/^CODIGO$/i, /^COD.?PRODUTO$/i, /CODIGO.?PRODUTO/i, /^REFERENCIA$/i, /REFERENCIA/i],
  descricao: [/^DESCRICAO$/i, /^PRODUTO$/i, /DESCRICAO.?PRODUTO/i, /^NOME.?PRODUTO$/i]
};

let graficosProdutos = { grifes: null, linhas: null };
let produtosAgrupados = [];
let ordemProdutos = { campo: 'liquido', desc: true };

// --------------------------------------------------------- utilidades
function chavesDosDados(dados) {
  const vistas = [];
  const set = new Set();
  (dados || []).slice(0, 2000).forEach(item => {
    Object.keys(item || {}).forEach(k => { if (!set.has(k)) { set.add(k); vistas.push(k); } });
  });
  return vistas;
}

function campoTemValor(dados, k) {
  return (dados || []).some(item => item[k] !== null && item[k] !== undefined && String(item[k]).trim() !== '');
}

function detectarCampo(chaves, tipo, excluir = []) {
  for (const re of PADROES_CAMPOS[tipo]) {
    const achou = chaves.find(k => re.test(k) && !excluir.includes(k));
    if (achou) return achou;
  }
  return null;
}

function formatarCampoApi(v) {
  if (v === null || v === undefined || String(v).trim() === '') return '<span style="color:#666">—</span>';
  return escHTML(String(v));
}

/** Colunas extras para Detalhes: tudo que a API mandou além das colunas fixas (e com algum valor). */
function camposExtrasDetalhes(dados) {
  return chavesDosDados(dados).filter(k => !CAMPOS_FIXOS_DETALHES.has(k) && campoTemValor(dados, k));
}

function montarCabecalhoDetalhes(extras) {
  const linha = document.getElementById('cabecalhoDetalhesLinha');
  if (!linha) return;
  linha.querySelectorAll('th.th-extra').forEach(th => th.remove());
  extras.forEach(k => {
    const th = document.createElement('th');
    th.className = 'th-extra';
    th.style.cssText = 'padding: 8px; border-bottom: 1px solid #ddd; white-space: nowrap;';
    th.textContent = k;
    th.title = 'Campo da API: ' + k;
    linha.appendChild(th);
  });
}

/** Baixa todos os registros e todos os campos da API em CSV (abre no Excel). */
function exportarDetalhesCSV() {
  const dados = typeof dadosBrutosGlobaisParaGrafico !== 'undefined' ? dadosBrutosGlobaisParaGrafico : [];
  if (!dados.length) return alert('Faça uma consulta primeiro.');
  const chaves = chavesDosDados(dados);
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = [chaves.join(';')].concat(dados.map(item => chaves.map(k => esc(item[k])).join(';')));
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const ini = document.getElementById('dataInicial').value, fim = document.getElementById('dataFinal').value;
  a.href = URL.createObjectURL(blob);
  a.download = `vendas_detalhadas_${ini}_a_${fim}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------ avaliação de produtos
function renderizarProdutos() {
  const dados = typeof dadosBrutosGlobaisParaGrafico !== 'undefined' ? dadosBrutosGlobaisParaGrafico : [];
  const chaves = chavesDosDados(dados).filter(k => campoTemValor(dados, k));
  const campos = {
    codigo: detectarCampo(chaves, 'codigo'),
    descricao: detectarCampo(chaves, 'descricao'),
  };
  campos.grife = detectarCampo(chaves, 'grife');
  campos.linha = detectarCampo(chaves, 'linha', [campos.grife]);

  // aviso sobre os campos usados
  const aviso = document.getElementById('avisoProdutos');
  if (aviso) {
    const faltam = ['grife', 'linha'].filter(c => !campos[c]);
    const usados = Object.entries(campos).filter(([, v]) => v).map(([c, v]) => `${c}: <b>${escHTML(v)}</b>`).join(' · ');
    aviso.innerHTML = (faltam.length
      ? `⚠️ A API não trouxe campo de <b>${faltam.join(' e ')}</b> nesta consulta. Campos disponíveis: <span class="lista-campos">${chaves.map(escHTML).join(', ')}</span>. Me diga qual deles é ${faltam.join('/')} que eu ajusto.<br>`
      : '') + `<small>Campos da API usados → ${usados || 'nenhum'}</small>`;
    aviso.style.display = dados.length ? 'block' : 'none';
  }

  // agrupa por produto
  const porProduto = {};
  const porGrife = {};
  const porLinha = {};
  let totLiq = 0, totBruto = 0, totDesc = 0, totQtd = 0;
  dados.forEach(item => {
    const cod = campos.codigo ? String(item[campos.codigo] ?? '').trim() : '';
    const desc = campos.descricao ? String(item[campos.descricao] ?? '').trim() : '';
    const grife = campos.grife ? (String(item[campos.grife] ?? '').trim() || 'SEM GRIFE') : '—';
    const linha = campos.linha ? (String(item[campos.linha] ?? '').trim() || 'SEM LINHA') : '—';
    const qtd = parseNumeroBR(item.QUANTIDADE) || 0;
    const bruto = parseNumeroBR(item.VALORBRUTOPRODUTO);
    const descV = parseNumeroBR(item.DESCPRODUTO);
    const liq = parseNumeroBR(item.LIQUIDOPRODUTO);
    const loja = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? '').match(/^0*(\d+)/);
    const os = String(item.OS || item.CODIGODAVENDA || '');

    const chave = `${cod}|${desc}`;
    if (!porProduto[chave]) porProduto[chave] = { codigo: cod, descricao: desc, grife, linha, qtd: 0, bruto: 0, desconto: 0, liquido: 0, os: new Set(), lojas: new Set() };
    const p = porProduto[chave];
    p.qtd += qtd; p.bruto += bruto; p.desconto += descV; p.liquido += liq;
    if (os) p.os.add(os);
    if (loja) p.lojas.add(loja[1]);

    for (const [mapa, nome] of [[porGrife, grife], [porLinha, linha]]) {
      if (!mapa[nome]) mapa[nome] = { nome, qtd: 0, bruto: 0, desconto: 0, liquido: 0, produtos: new Set() };
      mapa[nome].qtd += qtd; mapa[nome].bruto += bruto; mapa[nome].desconto += descV; mapa[nome].liquido += liq;
      mapa[nome].produtos.add(chave);
    }
    totLiq += liq; totBruto += bruto; totDesc += descV; totQtd += qtd;
  });

  produtosAgrupados = Object.values(porProduto).map(p => ({
    ...p, vendas: p.os.size, nLojas: p.lojas.size,
    pctDesc: p.bruto > 0 ? (p.desconto / p.bruto) * 100 : 0,
    precoMedio: p.qtd > 0 ? p.liquido / p.qtd : 0
  }));
  const grifes = Object.values(porGrife).sort((a, b) => b.liquido - a.liquido);
  const linhas = Object.values(porLinha).sort((a, b) => b.liquido - a.liquido);

  // cards
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
  set('cardProdQtd', totQtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 }));
  set('cardProdDistintos', produtosAgrupados.length.toLocaleString('pt-BR'));
  set('cardProdGrifes', campos.grife ? grifes.length : '—');
  set('cardProdLiquido', formatarMoedaBR(totLiq));
  set('cardProdDesconto', (totBruto > 0 ? (totDesc / totBruto) * 100 : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');

  renderizarGraficosProdutos(grifes, linhas, campos);
  renderizarTabelaGrifes(grifes, totLiq, campos);
  renderizarTabelaProdutos();
}

function renderizarGraficosProdutos(grifes, linhas, campos) {
  // Top 10 grifes por valor líquido
  const cG = document.getElementById('graficoProdGrifes');
  if (cG) {
    if (graficosProdutos.grifes) graficosProdutos.grifes.destroy();
    const top = (campos.grife ? grifes : []).slice(0, 10);
    graficosProdutos.grifes = new Chart(cG, {
      type: 'bar',
      data: {
        labels: top.map(g => g.nome.length > 16 ? g.nome.slice(0, 15) + '…' : g.nome),
        datasets: [{ label: 'Valor líquido', data: top.map(g => g.liquido), backgroundColor: top.map((_, i) => CORES_PALETA[i % CORES_PALETA.length]) }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: it => top[it[0].dataIndex].nome, label: c => ` ${formatarMoedaBR(c.raw)} · ${top[c.dataIndex].qtd.toLocaleString('pt-BR')} un.` } }
        },
        scales: { y: { beginAtZero: true, grace: '10%', ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
      }
    });
  }
  // Participação por linha
  const cL = document.getElementById('graficoProdLinhas');
  if (cL) {
    if (graficosProdutos.linhas) graficosProdutos.linhas.destroy();
    let lista = campos.linha ? linhas : [];
    if (lista.length > 9) {
      const outros = lista.slice(9).reduce((s, l) => s + l.liquido, 0);
      lista = lista.slice(0, 9).concat([{ nome: 'OUTRAS', liquido: outros }]);
    }
    const total = lista.reduce((s, l) => s + l.liquido, 0);
    graficosProdutos.linhas = new Chart(cL, {
      type: 'doughnut',
      data: { labels: lista.map(l => l.nome), datasets: [{ data: lista.map(l => l.liquido), backgroundColor: lista.map((_, i) => CORES_PALETA[i % CORES_PALETA.length]) }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '58%',
        layout: { padding: { bottom: 14 } },
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${formatarMoedaBR(c.raw)} · ${(total ? c.raw / total * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` } }
        }
      }
    });
  }
}

function renderizarTabelaGrifes(grifes, totLiq, campos) {
  const corpo = document.getElementById('corpoProdGrifes');
  if (!corpo) return;
  if (!campos.grife) { corpo.innerHTML = '<tr><td colspan="6" style="padding:10px;color:#888">Sem campo de grife na API.</td></tr>'; return; }
  corpo.innerHTML = grifes.map((g, i) => `<tr>
    <td style="padding:6px 8px;">${i + 1}º · <b>${escHTML(g.nome)}</b></td>
    <td style="padding:6px 8px; text-align:right;">${g.produtos.size}</td>
    <td style="padding:6px 8px; text-align:right;">${g.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
    <td style="padding:6px 8px; text-align:right; font-weight:bold;">${formatarMoedaBR(g.liquido)}</td>
    <td style="padding:6px 8px; text-align:right;">${(totLiq ? g.liquido / totLiq * 100 : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
    <td style="padding:6px 8px; text-align:right;">${(g.bruto ? g.desconto / g.bruto * 100 : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
  </tr>`).join('');
}

function ordenarProdutos(campo) {
  ordemProdutos = { campo, desc: ordemProdutos.campo === campo ? !ordemProdutos.desc : !['grife', 'linha', 'codigo', 'descricao'].includes(campo) };
  renderizarTabelaProdutos();
}

function renderizarTabelaProdutos() {
  const corpo = document.getElementById('corpoProdutos');
  if (!corpo) return;
  const busca = (document.getElementById('buscaProdutos')?.value || '').trim().toLowerCase();
  let lista = produtosAgrupados;
  if (busca) lista = lista.filter(p => [p.grife, p.linha, p.codigo, p.descricao].some(t => String(t).toLowerCase().includes(busca)));
  const { campo, desc } = ordemProdutos;
  lista = [...lista].sort((a, b) => {
    const va = a[campo], vb = b[campo];
    const r = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
    return desc ? -r : r;
  });

  document.querySelectorAll('#cabecalhoProdutos th[data-campo]').forEach(th => {
    const seta = th.dataset.campo === campo ? (desc ? ' ▼' : ' ▲') : '';
    th.textContent = th.dataset.rotulo + seta;
  });

  const LIMITE = 500;
  const pct = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  corpo.innerHTML = lista.slice(0, LIMITE).map(p => `<tr>
    <td style="padding:6px 8px;">${formatarCampoApi(p.grife)}</td>
    <td style="padding:6px 8px;">${formatarCampoApi(p.linha)}</td>
    <td style="padding:6px 8px; white-space:nowrap;">${formatarCampoApi(p.codigo)}</td>
    <td style="padding:6px 8px;">${formatarCampoApi(p.descricao)}</td>
    <td style="padding:6px 8px; text-align:right;">${p.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
    <td style="padding:6px 8px; text-align:right;">${formatarMoedaBR(p.precoMedio)}</td>
    <td style="padding:6px 8px; text-align:right; font-weight:bold;">${formatarMoedaBR(p.liquido)}</td>
    <td style="padding:6px 8px; text-align:right; ${p.pctDesc > 10 ? 'color:#d9534f;' : ''}">${pct(p.pctDesc)}</td>
    <td style="padding:6px 8px; text-align:right;">${p.vendas}</td>
    <td style="padding:6px 8px; text-align:right;">${p.nLojas}</td>
  </tr>`).join('') || '<tr><td colspan="10" style="padding:12px; color:#888;">Nenhum produto encontrado.</td></tr>';

  const info = document.getElementById('infoProdutos');
  if (info) info.textContent = `${lista.length.toLocaleString('pt-BR')} produto(s)` + (lista.length > LIMITE ? ` · mostrando os ${LIMITE} primeiros (use a busca)` : '');
}
