/**
 * "Comparar lojas" (botão no gráfico Participação por Meio de Pagamento):
 * abre uma janela com uma rosca por loja, 3 por linha, para comparar como
 * cada loja recebe (Dinheiro, Pix, Cartão 1x ... 10x) lado a lado.
 *
 *  - Mesmas cores do gráfico principal para cada forma de pagamento.
 *  - Fatias sempre na mesma ordem em todas as lojas (Dinheiro, Pix, Débito,
 *    Cartão 1x, 2x ... 10x), para o olho comparar fácil.
 *  - Usa os dados de pagamento já carregados na consulta (não busca de novo).
 */

let pagamentosParaComparar = [];   // preenchido por main.js a cada consulta
let coresPagamentoGlobal = {};     // rótulo -> cor, igual ao gráfico principal
let graficosComparaLojas = [];

function rotuloPagamento(pgto) {
  const meio = (pgto.MEIO_PAGAMENTO || pgto.MEIOPAGAMENTO || 'NÃO ESPECIFICADO').trim();
  const parcelas = (pgto.N_PARCELAS || 'A VISTA').trim();
  return { rotulo: `${meio} (${parcelas})`, meio, parcelas };
}

function idLojaPagamento(pgto) {
  const texto = String(pgto.LOJA || pgto.CODIGOLOJA || '').trim();
  const m = texto.match(/^0*(\d+)/);
  return m ? m[1] : texto;
}

/** Agrupa os pagamentos: { loja: { total, porRotulo: { rotulo: valor } } } e a ordem dos rótulos. */
function agruparPagamentosPorLoja(pagamentos) {
  const lojas = {};
  const infoRotulo = {};
  pagamentos.forEach(p => {
    const id = idLojaPagamento(p);
    const { rotulo, meio, parcelas } = rotuloPagamento(p);
    const valor = parseNumeroBR(p.VENDAS_VALOR || 0);
    if (!lojas[id]) lojas[id] = { id, total: 0, porRotulo: {} };
    lojas[id].total += valor;
    lojas[id].porRotulo[rotulo] = (lojas[id].porRotulo[rotulo] || 0) + valor;
    infoRotulo[rotulo] = { meio, parcelas };
  });
  const rotulos = Object.keys(infoRotulo).sort((a, b) =>
    ordemMeioPagamento(infoRotulo[a].meio) - ordemMeioPagamento(infoRotulo[b].meio) ||
    numeroParcelas(infoRotulo[a].parcelas) - numeroParcelas(infoRotulo[b].parcelas) ||
    a.localeCompare(b));
  return { lojas, rotulos, infoRotulo };
}

function corDoRotulo(rotulo, i) {
  return coresPagamentoGlobal[rotulo] || CORES_PALETA[i % CORES_PALETA.length];
}

function nomeLojaComparar(id) {
  const loja = (typeof lojasDisponiveis !== 'undefined' ? lojasDisponiveis : []).find(l => String(l.id) === String(id));
  const nome = loja ? String(loja.nome || '').replace(/^0*\d+\s*/, '') : '';
  return { titulo: `Loja ${id}`, nome };
}

function pct(v, total) { return total > 0 ? (v / total) * 100 : 0; }
function fmtPct(v) { return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }

function fecharCompararLojas() {
  const modal = document.getElementById('modalCompararLojas');
  if (!modal) return;
  modal.classList.remove('aberto');
  setTimeout(() => {
    modal.style.display = 'none';
    graficosComparaLojas.forEach(g => g.destroy());
    graficosComparaLojas = [];
  }, 250);
}

function abrirCompararLojas() {
  const modal = document.getElementById('modalCompararLojas');
  const grade = document.getElementById('gradeCompararLojas');
  if (!modal || !grade) return;

  const { lojas, rotulos, infoRotulo } = agruparPagamentosPorLoja(pagamentosParaComparar || []);
  const lista = Object.values(lojas).sort((a, b) => b.total - a.total);

  // período e resumo
  const ini = document.getElementById('dataInicial').value;
  const fim = document.getElementById('dataFinal').value;
  const totalRede = lista.reduce((s, l) => s + l.total, 0);
  document.getElementById('subtituloCompararLojas').textContent =
    `${lista.length} loja(s) · ${formatarDataISOparaBR(ini)} a ${formatarDataISOparaBR(fim)} · total recebido ${formatarMoedaBR(totalRede)}`;

  // legenda única (mesma cor em todas as lojas)
  document.getElementById('legendaCompararLojas').innerHTML = rotulos.map((r, i) => `
    <span class="cl-legenda-item"><i style="background:${corDoRotulo(r, i)}; box-shadow: 0 0 8px ${corDoRotulo(r, i)};"></i>${escHTML(r)}</span>`).join('');

  graficosComparaLojas.forEach(g => g.destroy());
  graficosComparaLojas = [];

  if (!lista.length) {
    grade.innerHTML = '<p class="cl-vazio">Nenhum pagamento no período consultado.</p>';
  } else {
    grade.innerHTML = lista.map((l, i) => {
      const { titulo, nome } = nomeLojaComparar(l.id);
      // indicadores rápidos: à vista e cartão 10x (ou mais)
      let aVista = 0, longo = 0, maior = { r: '', v: 0 };
      Object.entries(l.porRotulo).forEach(([r, v]) => {
        const info = infoRotulo[r];
        if (ordemMeioPagamento(info.meio) <= 2) aVista += v;
        else if (numeroParcelas(info.parcelas) >= 9) longo += v;
        if (v > maior.v) maior = { r, v };
      });
      return `<div class="cl-card" style="animation-delay:${i * 90}ms">
        <div class="cl-card-topo">
          <div><strong>${escHTML(titulo)}</strong><small>${escHTML(nome)}</small></div>
          <span class="cl-total">${formatarMoedaBR(l.total)}</span>
        </div>
        <div class="cl-grafico"><canvas id="clGrafico${i}"></canvas>
          <div class="cl-centro"><b>${fmtPct(pct(l.total, totalRede))}</b><span>da rede</span></div>
        </div>
        <div class="cl-indicadores">
          <span title="Dinheiro, Pix e Débito">💵 À vista <b class="cl-bom">${fmtPct(pct(aVista, l.total))}</b></span>
          <span title="Cartão em 9 ou 10 parcelas">💳 9-10x <b class="${pct(longo, l.total) >= 40 ? 'cl-ruim' : ''}">${fmtPct(pct(longo, l.total))}</b></span>
        </div>
        <div class="cl-maior">Maior: <b>${escHTML(maior.r)}</b> · ${fmtPct(pct(maior.v, l.total))}</div>
      </div>`;
    }).join('');
  }

  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('aberto'));

  // desenha as roscas com um pequeno atraso entre elas (efeito em cascata)
  lista.forEach((l, i) => {
    setTimeout(() => {
      const canvas = document.getElementById(`clGrafico${i}`);
      if (!canvas || !modal.classList.contains('aberto')) return;
      const dados = rotulos.map(r => l.porRotulo[r] || 0);
      graficosComparaLojas.push(new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: rotulos,
          datasets: [{ data: dados, backgroundColor: rotulos.map((r, k) => corDoRotulo(r, k)) }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '60%',
          layout: { padding: { top: 6, bottom: 16, left: 10, right: 10 } },
          animation: { animateRotate: true, animateScale: true, duration: 1100, easing: 'easeOutBack' },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: c => ` ${c.label}: ${fmtPct(pct(c.raw, l.total))} · ${formatarMoedaBR(c.raw)}`
              }
            }
          }
        }
      }));
    }, 150 + i * 90);
  });
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalCompararLojas');
  if (e.key === 'Escape' && modal && modal.classList.contains('aberto')) fecharCompararLojas();
});
