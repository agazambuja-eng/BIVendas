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
    const c = r[codigo] || (r[codigo] = { descricao, qtd: 0, liquido: 0, lojas: {} });
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
