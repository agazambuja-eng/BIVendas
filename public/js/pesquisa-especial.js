/**
 * Aba COMPARATIVO · "Pesquisa especial": evolução de vendas de produtos
 * escolhidos pelo código (o número antes do nome, ex.: 14041873), um ou
 * vários separados por vírgula, nos mesmos períodos do comparativo
 * (3, 6... conforme a quantidade escolhida).
 *
 * O resumo por código de cada período é montado junto com o comparativo
 * (resumirVendas chama resumirCodigosDoPeriodo), então a pesquisa não chama
 * a API de novo e respeita os filtros de lojas e tipos de venda.
 */

let pesqMetrica = 'qtd';            // 'qtd' ou 'liquido'
let pesqCodigos = [];               // códigos pesquisados (normalizados)
let ultimoComparativoPesq = null;   // { periodos, porPeriodo }
let graficoPesquisa = null;
const CHAVE_PESQUISA = 'bi_pesquisa_especial_codigos';

/** "0014041873" -> "14041873" ; " 2008620 " -> "2008620" */
function normalizarCodigoProduto(c) {
  const s = String(c ?? '').trim().toUpperCase();
  return /^\d+$/.test(s) ? String(s.replace(/^0+(?=\d)/, '')) : s;
}

/** Código e descrição do item, com os mesmos nomes de campo que a aba Detalhes usa. */
function codigoDescricaoItem(item) {
  let cod = item.CODIGO, desc = item.DESCRICAO || item.PRODUTO || '';
  if (!cod) {   // fallback: "14041873 - TECNOL ..." na descrição
    const m = String(desc).match(/^\s*(\d{4,})\s*-\s*(.*)$/);
    if (m) { cod = m[1]; desc = m[2]; }
  }
  return { codigo: normalizarCodigoProduto(cod), descricao: String(desc).trim() };
}

/** Por período: { codigo: { descricao, qtd, liquido, lojas: { id: { qtd, liquido } } } } */
function resumirCodigosDoPeriodo(itens) {
  const r = {};
  (itens || []).forEach(item => {
    const { codigo, descricao } = codigoDescricaoItem(item);
    if (!codigo) return;
    const q = parseNumeroBR(item.QUANTIDADE) || 0;
    const v = parseNumeroBR(item.LIQUIDOPRODUTO);
    const c = r[codigo] || (r[codigo] = { descricao, grife: String(item.GRIFE || item.MARCA || '').trim(), qtd: 0, liquido: 0, lojas: {} });
    if (!c.descricao && descricao) c.descricao = descricao;
    c.qtd += q; c.liquido += v;
    const loja = typeof idLojaDoItem === 'function' ? idLojaDoItem(item) : '?';
    const l = c.lojas[loja] || (c.lojas[loja] = { qtd: 0, liquido: 0 });
    l.qtd += q; l.liquido += v;
  });
  return r;
}

const fmtPesq = v => pesqMetrica === 'qtd' ? `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un.` : formatarMoedaBR(v);

/** Botão Pesquisar / Enter. */
function executarPesquisaEspecial() {
  const campo = document.getElementById('pesqCodigos');
  pesqCodigos = [...new Set(String(campo ? campo.value : '').split(/[,;\s]+/).map(normalizarCodigoProduto).filter(Boolean))];
  try { localStorage.setItem(CHAVE_PESQUISA, campo ? campo.value : ''); } catch { /* sem armazenamento */ }
  if (!ultimoComparativoPesq) {
    mostrarMsgPesquisa('Abra o comparativo (faça uma consulta) para pesquisar.');
    return;
  }
  desenharPesquisaEspecial();
}

function limparPesquisaEspecial() {
  const campo = document.getElementById('pesqCodigos');
  if (campo) campo.value = '';
  pesqCodigos = [];
  try { localStorage.removeItem(CHAVE_PESQUISA); } catch { /* sem armazenamento */ }
  desenharPesquisaEspecial();
}

function escolherMetricaPesq(m) {
  pesqMetrica = m;
  desenharPesquisaEspecial();
}

function mostrarMsgPesquisa(txt) {
  const el = document.getElementById('pesqMensagem');
  if (el) { el.textContent = txt || ''; el.style.display = txt ? 'block' : 'none'; }
}

/** Chamado por renderizarComparativo (comparativo.js) a cada atualização. */
function renderizarPesquisaEspecial(dados) {
  ultimoComparativoPesq = dados;
  if (pesqCodigos.length) desenharPesquisaEspecial();
}

function desenharPesquisaEspecial() {
  document.querySelectorAll('#pesqMetrica button').forEach(b => b.classList.toggle('ativo', b.dataset.m === pesqMetrica));
  const area = document.getElementById('pesqResultado');
  if (graficoPesquisa) { graficoPesquisa.destroy(); graficoPesquisa = null; }
  if (!area) return;
  if (!pesqCodigos.length) { area.style.display = 'none'; mostrarMsgPesquisa(''); return; }
  if (!ultimoComparativoPesq) return;

  const { periodos, porPeriodo } = ultimoComparativoPesq;
  const resumos = porPeriodo.map(r => (r && r.codigos) || {});
  const achados = pesqCodigos.filter(c => resumos.some(r => r[c]));
  const naoAchados = pesqCodigos.filter(c => !achados.includes(c));
  mostrarMsgPesquisa(naoAchados.length
    ? `Sem vendas nos períodos para: ${naoAchados.join(', ')}. Confira o código (é o número antes do nome do produto, como na aba Detalhes).`
    : '');
  area.style.display = achados.length ? '' : 'none';
  if (!achados.length) return;

  const desc = c => (resumos.find(r => r[c] && r[c].descricao) || {})[c]?.descricao || '';
  const valores = c => resumos.map(r => (r[c] ? r[c][pesqMetrica] : 0));
  const ult = periodos.length - 1;

  const canvas = document.getElementById('graficoPesquisa');
  if (canvas) {
    graficoPesquisa = new Chart(canvas, {
      type: 'line',
      data: {
        labels: periodos.map(p => p.rotulo),
        datasets: achados.map((c, i) => ({
          label: `${c} · ${desc(c)}`.slice(0, 60),
          data: valores(c),
          borderColor: CORES_PALETA[i % CORES_PALETA.length], backgroundColor: CORES_PALETA[i % CORES_PALETA.length],
          tension: 0.3, borderWidth: 3, pointRadius: 5, fill: achados.length === 1
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtPesq(c.raw)}` } }
        },
        scales: { y: { beginAtZero: true, ticks: { precision: pesqMetrica === 'qtd' ? 0 : undefined,
          callback: v => pesqMetrica === 'qtd' ? Number(v).toLocaleString('pt-BR') : 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
      }
    });
  }

  const cab = document.getElementById('cabecalhoPesquisa');
  if (cab) {
    cab.innerHTML = `<tr>
      <th style="padding: 8px; text-align: left;">Produto</th>
      ${periodos.map(p => `<th style="padding: 8px; text-align: right;">${p.rotulo}</th>`).join('')}
      <th style="padding: 8px; text-align: right;">Total</th>
      <th style="padding: 8px; text-align: right;">vs mês anterior</th>
      <th style="padding: 8px; text-align: right;">vs ${periodos.length - 1} meses atrás</th>
    </tr>`;
  }
  const corpo = document.getElementById('corpoPesquisa');
  if (corpo) {
    const linha = (nome, vals, classe) => `<tr class="${classe || ''}">
      <td style="padding: 7px 8px;">${nome}</td>
      ${vals.map(v => `<td class="la-num ${v ? '' : 'la-zero'}" style="padding: 7px 8px;">${fmtPesq(v)}</td>`).join('')}
      <td class="la-num" style="padding: 7px 8px; font-weight: bold;">${fmtPesq(vals.reduce((s, v) => s + v, 0))}</td>
      <td class="la-num" style="padding: 7px 8px;">${variacaoHTML(vals[ult], vals[ult - 1])}</td>
      <td class="la-num" style="padding: 7px 8px;">${variacaoHTML(vals[ult], vals[0])}</td>
    </tr>`;
    let html = achados.map((c, i) => linha(
      `<span class="pesq-cor" style="background:${CORES_PALETA[i % CORES_PALETA.length]}"></span><b>${escHTML(c)}</b> · ${escHTML(desc(c))}` +
      (typeof linkImagemProduto === 'function' ? ` <a class="la-lupa" href="${linkImagemProduto({ descricao: desc(c) })}" target="_blank" rel="noopener noreferrer" title="Ver imagens deste produto">🔍</a>` : ''),
      valores(c))).join('');
    if (achados.length > 1) {
      const soma = periodos.map((_, k) => achados.reduce((s, c) => s + valores(c)[k], 0));
      html += linha('TOTAL DOS PRODUTOS PESQUISADOS', soma, 'ca-total');
    }
    corpo.innerHTML = html;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const campo = document.getElementById('pesqCodigos');
  if (!campo) return;
  try { campo.value = localStorage.getItem(CHAVE_PESQUISA) || ''; } catch { /* sem armazenamento */ }
  campo.addEventListener('keydown', e => { if (e.key === 'Enter') executarPesquisaEspecial(); });
  if (campo.value.trim()) pesqCodigos = [...new Set(campo.value.split(/[,;\s]+/).map(normalizarCodigoProduto).filter(Boolean))];
});

/* ---------- Lupa: procurar produto pelo nome ---------- */
let bpCatalogo = [];          // [{ codigo, descricao, grife, qtd, liquido, chave }]
const bpSelecao = new Set();
const BP_LIMITE = 300;

function semAcentoBusca(t) {
  return String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

/** Produtos únicos (por código) de todos os períodos já carregados; sem comparativo, da consulta atual. */
function montarCatalogoBusca() {
  const mapa = {};
  const somar = r => Object.entries(r || {}).forEach(([cod, c]) => {
    const p = mapa[cod] || (mapa[cod] = { codigo: cod, descricao: c.descricao || '', grife: c.grife || '', qtd: 0, liquido: 0 });
    if (!p.descricao && c.descricao) p.descricao = c.descricao;
    if (!p.grife && c.grife) p.grife = c.grife;
    p.qtd += c.qtd; p.liquido += c.liquido;
  });
  let origem;
  if (ultimoComparativoPesq) {
    ultimoComparativoPesq.porPeriodo.forEach(r => somar(r && r.codigos));
    origem = `${ultimoComparativoPesq.periodos.length} período(s) do comparativo`;
  } else {
    const dados = typeof dadosBrutosGlobaisParaGrafico !== 'undefined' ? dadosBrutosGlobaisParaGrafico : [];
    somar(resumirCodigosDoPeriodo(dados));
    origem = 'consulta atual';
  }
  bpCatalogo = Object.values(mapa)
    .map(p => ({ ...p, chave: semAcentoBusca(`${p.codigo} ${p.descricao} ${p.grife}`) }))
    .sort((a, b) => b.qtd - a.qtd || a.descricao.localeCompare(b.descricao));
  return origem;
}

function abrirBuscaProdutos() {
  const origem = montarCatalogoBusca();
  bpSelecao.clear();
  const modal = document.getElementById('modalBuscaProdutos');
  document.getElementById('bpSubtitulo').textContent = bpCatalogo.length
    ? `${bpCatalogo.length.toLocaleString('pt-BR')} produtos vendidos · ${origem} · clique para marcar um ou mais`
    : 'Nenhum produto carregado: faça uma consulta primeiro.';
  const busca = document.getElementById('bpBusca');
  busca.value = '';
  renderizarBuscaProdutos();
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('aberto'));
  setTimeout(() => busca.focus(), 50);
}

function fecharBuscaProdutos() {
  const modal = document.getElementById('modalBuscaProdutos');
  if (!modal) return;
  modal.classList.remove('aberto');
  setTimeout(() => { modal.style.display = 'none'; }, 250);
}

function renderizarBuscaProdutos() {
  const lista = document.getElementById('bpLista');
  if (!lista) return;
  const termos = semAcentoBusca(document.getElementById('bpBusca').value).split(/\s+/).filter(Boolean);
  const achados = termos.length ? bpCatalogo.filter(p => termos.every(t => p.chave.includes(t))) : bpCatalogo;
  const mostrar = achados.slice(0, BP_LIMITE);
  lista.innerHTML = mostrar.map(p => `
    <button type="button" class="bp-item ${bpSelecao.has(p.codigo) ? 'marcado' : ''}" data-cod="${escHTML(p.codigo)}" onclick="alternarProdutoBusca(this.dataset.cod)">
      <span class="bp-check" aria-hidden="true">${bpSelecao.has(p.codigo) ? '✓' : ''}</span>
      <span class="bp-cod">${escHTML(p.codigo)}</span>
      <span class="bp-desc">${escHTML(p.descricao || '—')}${p.grife ? `<small>${escHTML(p.grife)}</small>` : ''}</span>
      <span class="bp-qtd">${p.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un.</span>
    </button>`).join('') +
    (achados.length > BP_LIMITE ? `<p class="bp-aviso">Mostrando ${BP_LIMITE} de ${achados.length.toLocaleString('pt-BR')} · digite mais para filtrar</p>` : '') +
    (!achados.length && bpCatalogo.length ? '<p class="bp-aviso">Nenhum produto encontrado com esse texto.</p>' : '');
  atualizarSelecaoBusca();
}

function alternarProdutoBusca(cod) {
  if (bpSelecao.has(cod)) bpSelecao.delete(cod); else bpSelecao.add(cod);
  const el = document.querySelector(`#bpLista .bp-item[data-cod="${CSS.escape(cod)}"]`);
  if (el) {
    el.classList.toggle('marcado', bpSelecao.has(cod));
    el.querySelector('.bp-check').textContent = bpSelecao.has(cod) ? '✓' : '';
  }
  atualizarSelecaoBusca();
}

function limparSelecaoBusca() {
  bpSelecao.clear();
  renderizarBuscaProdutos();
}

function atualizarSelecaoBusca() {
  const el = document.getElementById('bpSelecionados');
  if (el) el.textContent = bpSelecao.size ? `${bpSelecao.size} selecionado(s): ${[...bpSelecao].slice(0, 6).join(', ')}${bpSelecao.size > 6 ? '…' : ''}` : 'Nenhum selecionado';
}

/** Junta os códigos marcados ao que já está no campo (sem repetir) e pesquisa. */
function usarProdutosSelecionados() {
  if (!bpSelecao.size) return fecharBuscaProdutos();
  const campo = document.getElementById('pesqCodigos');
  const atuais = String(campo.value).split(/[,;\s]+/).map(normalizarCodigoProduto).filter(Boolean);
  campo.value = [...new Set(atuais.concat([...bpSelecao]))].join(', ');
  fecharBuscaProdutos();
  executarPesquisaEspecial();
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalBuscaProdutos');
  if (!modal || !modal.classList.contains('aberto')) return;
  if (e.key === 'Escape') fecharBuscaProdutos();
  if (e.key === 'Enter' && e.target && e.target.id === 'bpBusca') {
    // Enter com um só resultado: marca ele
    const itens = document.querySelectorAll('#bpLista .bp-item');
    if (itens.length === 1) alternarProdutoBusca(itens[0].dataset.cod);
  }
});
