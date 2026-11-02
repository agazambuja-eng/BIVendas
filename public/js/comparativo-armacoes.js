/**
 * Aba COMPARATIVO · "Armações" (RX, Sun, Clip-on) período a período.
 *
 * - Gráfico de linhas: uma linha por tipo de armação, em unidades ou valor.
 * - Tabela com as variações; botões "Expandir por grifes" e "Expandir por
 *   loja" abrem os detalhes abaixo de cada linha (os dois juntos: linha >
 *   grife > loja). Cada linha da tabela também abre/fecha no triângulo.
 *
 * Os números vêm do mesmo resumo do comparativo (resumirVendas chama
 * resumirArmacoesDoPeriodo), então respeitam lojas e tipos de venda.
 */

let compArmMetrica = 'qtd';              // 'qtd' (unidades) ou 'liquido' (R$)
let compArmExpandirGrifes = false;
let compArmExpandirLojas = false;
const compArmFechados = new Set();       // nós que a pessoa fechou à mão
const compArmAbertos = new Set();        // nós que a pessoa abriu à mão
let graficoCompArmacoes = null;
let ultimoComparativoArm = null;         // { periodos, porPeriodo }

/** Resumo de armações de um período: { RX: { qtd, liquido, lojas, grifes: { g: { qtd, liquido, lojas } } }, ... } */
function resumirArmacoesDoPeriodo(itens) {
  const res = {};
  if (typeof linhaDeArmacao !== 'function' || !itens || !itens.length) return res;
  const chaves = chavesDosDados(itens);
  const campoGrife = detectarCampo(chaves, 'grife');
  const campoLinha = detectarCampo(chaves, 'linha', [campoGrife]);
  if (!campoLinha) return res;
  const soma = (obj, k, q, v) => {
    if (!obj[k]) obj[k] = { qtd: 0, liquido: 0 };
    obj[k].qtd += q; obj[k].liquido += v;
    return obj[k];
  };
  itens.forEach(item => {
    const chave = linhaDeArmacao(item[campoLinha]);
    if (!chave) return;
    const q = parseNumeroBR(item.QUANTIDADE) || 0;
    const v = parseNumeroBR(item.LIQUIDOPRODUTO);
    const loja = idLojaDoItem(item);
    const grife = campoGrife ? (String(item[campoGrife] ?? '').trim() || 'SEM GRIFE') : '—';
    if (!res[chave]) res[chave] = { qtd: 0, liquido: 0, lojas: {}, grifes: {}, titulo: String(item[campoLinha]).trim() };
    const l = res[chave];
    l.qtd += q; l.liquido += v;
    soma(l.lojas, loja, q, v);
    const g = soma(l.grifes, grife, q, v);
    if (!g.lojas) g.lojas = {};
    soma(g.lojas, loja, q, v);
  });
  return res;
}

function infoLinhaArm(chave, resumos) {
  const fixa = (typeof LINHAS_ARMACAO !== 'undefined' ? LINHAS_ARMACAO : []).find(l => l.chave === chave);
  if (fixa) return fixa;
  const r = resumos.find(x => x && x[chave]);
  return { chave, titulo: r ? r[chave].titulo : chave, icone: '👓', cor: '#3dffa8' };
}

function valorArm(no) { return no ? (no[compArmMetrica] || 0) : 0; }
function fmtArm(v) {
  return compArmMetrica === 'qtd'
    ? Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' un.'
    : formatarMoedaBR(v);
}

/** Chamado por renderizarComparativo (comparativo.js). */
function renderizarComparativoArmacoes(dados) {
  ultimoComparativoArm = dados;
  const { periodos, porPeriodo } = dados;
  const resumos = porPeriodo.map(r => (r && r.armacoes) || {});
  const ordemFixa = (typeof LINHAS_ARMACAO !== 'undefined' ? LINHAS_ARMACAO : []).map(l => l.chave);
  const chaves = [...new Set([...ordemFixa, ...resumos.flatMap(r => Object.keys(r))])];
  const linhas = chaves.map(c => infoLinhaArm(c, resumos));
  const vazio = resumos.every(r => !Object.keys(r).length);

  const aviso = document.getElementById('compArmVazio');
  if (aviso) aviso.style.display = vazio ? 'block' : 'none';
  document.querySelectorAll('#compArmMetrica button').forEach(b => b.classList.toggle('ativo', b.dataset.m === compArmMetrica));
  document.getElementById('btnCompArmGrifes')?.classList.toggle('ativo', compArmExpandirGrifes);
  document.getElementById('btnCompArmLojas')?.classList.toggle('ativo', compArmExpandirLojas);

  // ---- gráfico
  const canvas = document.getElementById('graficoComparativoArmacoes');
  if (graficoCompArmacoes) { graficoCompArmacoes.destroy(); graficoCompArmacoes = null; }
  if (canvas && !vazio) {
    graficoCompArmacoes = new Chart(canvas, {
      type: 'line',
      data: {
        labels: periodos.map(p => p.rotulo),
        datasets: linhas.map(l => ({
          label: `${l.icone} ${l.titulo}`,
          data: resumos.map(r => valorArm(r[l.chave])),
          borderColor: l.cor, backgroundColor: l.cor,
          tension: 0.3, borderWidth: 3, pointRadius: 5
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 12 } } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtArm(c.raw)}` } }
        },
        scales: { y: { beginAtZero: true, ticks: { callback: v => compArmMetrica === 'qtd' ? Number(v).toLocaleString('pt-BR') : 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
      }
    });
  }

  // ---- tabela
  const cab = document.getElementById('cabecalhoComparativoArmacoes');
  if (cab) {
    cab.innerHTML = `<tr>
      <th style="padding: 8px; text-align: left;">Armação</th>
      ${periodos.map(p => `<th style="padding: 8px; text-align: right;">${p.rotulo}</th>`).join('')}
      <th style="padding: 8px; text-align: right;">vs mês anterior</th>
      <th style="padding: 8px; text-align: right;">vs ${periodos.length - 1} meses atrás</th>
    </tr>`;
  }
  const corpo = document.getElementById('corpoComparativoArmacoes');
  if (!corpo) return;
  if (vazio) { corpo.innerHTML = ''; return; }

  const ult = resumos.length - 1;
  const aberto = (id, padrao) => compArmAbertos.has(id) || (padrao && !compArmFechados.has(id));
  const linhaTabela = (nivel, id, nome, valores, temFilhos, abertoAgora, cor) => `
    <tr class="ca-n${nivel}" ${temFilhos ? `onclick="alternarNoCompArm(${escHTML(JSON.stringify(id))}, ${abertoAgora})"` : ''} ${cor ? `style="--cor-linha:${cor}"` : ''}>
      <td class="ca-nome">${temFilhos ? `<span class="la-seta ${abertoAgora ? 'aberta' : ''}">▸</span>` : '<span class="la-seta"></span>'}${nome}</td>
      ${valores.map(v => `<td class="la-num ${v ? '' : 'la-zero'}">${fmtArm(v)}</td>`).join('')}
      <td class="la-num">${variacaoHTML(valores[ult], valores[ult - 1])}</td>
      <td class="la-num">${variacaoHTML(valores[ult], valores[0])}</td>
    </tr>`;
  const nomeLoja = id => escHTML(typeof nomeLojaComparativo === 'function' ? nomeLojaComparativo(id) : `Loja ${id}`);
  const ordenarPorAtual = (mapaAtual, ids) => ids.sort((a, b) => valorArm(mapaAtual[b]) - valorArm(mapaAtual[a]) || a.localeCompare(b));

  let html = '';
  linhas.forEach(l => {
    const nosL = resumos.map(r => r[l.chave]);
    const idL = `L:${l.chave}`;
    const filhosPadrao = compArmExpandirGrifes || compArmExpandirLojas;
    const abertoL = aberto(idL, filhosPadrao);
    html += linhaTabela(1, idL, `${l.icone} ${escHTML(l.titulo)}`, nosL.map(valorArm), true, abertoL, l.cor);
    if (!abertoL) return;

    if (compArmExpandirGrifes || !compArmExpandirLojas) {
      // linha > grife (> loja)
      const grifes = ordenarPorAtual(nosL[ult]?.grifes || {}, [...new Set(nosL.flatMap(n => Object.keys(n?.grifes || {})))]);
      grifes.forEach(g => {
        const nosG = nosL.map(n => n?.grifes?.[g]);
        const idG = `G:${l.chave}:${g}`;
        const abertoG = aberto(idG, compArmExpandirLojas);
        html += linhaTabela(2, idG, escHTML(g), nosG.map(valorArm), true, abertoG);
        if (!abertoG) return;
        const lojas = ordenarPorAtual(nosG[ult]?.lojas || {}, [...new Set(nosG.flatMap(n => Object.keys(n?.lojas || {})))]);
        lojas.forEach(id => html += linhaTabela(3, '', nomeLoja(id), nosG.map(n => valorArm(n?.lojas?.[id])), false, false));
      });
    } else {
      // só por loja: linha > loja
      const lojas = ordenarPorAtual(nosL[ult]?.lojas || {}, [...new Set(nosL.flatMap(n => Object.keys(n?.lojas || {})))]);
      lojas.forEach(id => html += linhaTabela(2, '', `🏬 ${nomeLoja(id)}`, nosL.map(n => valorArm(n?.lojas?.[id])), false, false));
    }
  });
  // total de armações
  const totais = resumos.map(r => Object.values(r).reduce((s, n) => s + valorArm(n), 0));
  html += `<tr class="ca-total"><td class="ca-nome">TOTAL ARMAÇÕES</td>
    ${totais.map(v => `<td class="la-num">${fmtArm(v)}</td>`).join('')}
    <td class="la-num">${variacaoHTML(totais[ult], totais[ult - 1])}</td>
    <td class="la-num">${variacaoHTML(totais[ult], totais[0])}</td></tr>`;
  corpo.innerHTML = html;
}

function redesenharComparativoArmacoes() {
  if (ultimoComparativoArm) renderizarComparativoArmacoes(ultimoComparativoArm);
}

function escolherMetricaCompArm(m) {
  compArmMetrica = m;
  redesenharComparativoArmacoes();
}

function alternarExpandirCompArm(tipo) {
  if (tipo === 'grifes') compArmExpandirGrifes = !compArmExpandirGrifes;
  else compArmExpandirLojas = !compArmExpandirLojas;
  compArmAbertos.clear(); compArmFechados.clear();
  redesenharComparativoArmacoes();
}

function alternarNoCompArm(id, estavaAberto) {
  if (estavaAberto) { compArmAbertos.delete(id); compArmFechados.add(id); }
  else { compArmFechados.delete(id); compArmAbertos.add(id); }
  redesenharComparativoArmacoes();
}
