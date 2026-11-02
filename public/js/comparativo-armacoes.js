/**
 * Aba COMPARATIVO · "Armações" (RX, Sun, Clip-on) período a período.
 *
 * - Gráfico de linhas: uma linha por tipo de armação, em unidades ou valor.
 * - "Expandir por grifes" / "Expandir por loja" abrem um gráfico por linha
 *   (RX, Sun, Clip-on) com a evolução dos N itens mais vendidos (padrão 5).
 * - Tabela com as variações; cada linha abre/fecha no triângulo
 *   (linha > grife > loja).
 *
 * Os números vêm do mesmo resumo do comparativo (resumirVendas chama
 * resumirArmacoesDoPeriodo), então respeitam lojas e tipos de venda.
 */

let compArmMetrica = 'qtd';              // 'qtd' (unidades) ou 'liquido' (R$)
let compArmExpandirGrifes = false;
let compArmExpandirLojas = false;
let compArmGrifesPorLoja = false;        // um gráfico por loja com as grifes dela
let compArmLinhaGL = 'TODAS';            // filtro de linha para "Grifes por loja"
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
        scales: { y: { beginAtZero: true, ticks: { precision: compArmMetrica === 'qtd' ? 0 : undefined, callback: v => compArmMetrica === 'qtd' ? Number(v).toLocaleString('pt-BR') : 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
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
    const abertoL = aberto(idL, false);
    html += linhaTabela(1, idL, `${l.icone} ${escHTML(l.titulo)}`, nosL.map(valorArm), true, abertoL, l.cor);
    if (!abertoL) return;

    {
      // linha > grife (> loja)
      const grifes = ordenarPorAtual(nosL[ult]?.grifes || {}, [...new Set(nosL.flatMap(n => Object.keys(n?.grifes || {})))]);
      grifes.forEach(g => {
        const nosG = nosL.map(n => n?.grifes?.[g]);
        const idG = `G:${l.chave}:${g}`;
        const abertoG = aberto(idG, false);
        html += linhaTabela(2, idG, escHTML(g), nosG.map(valorArm), true, abertoG);
        if (!abertoG) return;
        const lojas = ordenarPorAtual(nosG[ult]?.lojas || {}, [...new Set(nosG.flatMap(n => Object.keys(n?.lojas || {})))]);
        lojas.forEach(id => html += linhaTabela(3, '', nomeLoja(id), nosG.map(n => valorArm(n?.lojas?.[id])), false, false));
      });
    }
  });
  // total de armações
  const totais = resumos.map(r => Object.values(r).reduce((s, n) => s + valorArm(n), 0));
  html += `<tr class="ca-total"><td class="ca-nome">TOTAL ARMAÇÕES</td>
    ${totais.map(v => `<td class="la-num">${fmtArm(v)}</td>`).join('')}
    <td class="la-num">${variacaoHTML(totais[ult], totais[ult - 1])}</td>
    <td class="la-num">${variacaoHTML(totais[ult], totais[0])}</td></tr>`;
  corpo.innerHTML = html;

  renderizarGraficosExpandidosCompArm(periodos, resumos, linhas);
  renderizarGrifesPorLojaCompArm(periodos, resumos, linhas);
}

/* ---------- "Grifes por loja": um gráfico por loja, top N grifes da loja ---------- */
let graficosGrifesLojaCompArm = [];

function renderizarGrifesPorLojaCompArm(periodos, resumos, linhas) {
  graficosGrifesLojaCompArm.forEach(g => g.destroy());
  graficosGrifesLojaCompArm = [];
  document.getElementById('btnCompArmGrifesLoja')?.classList.toggle('ativo', compArmGrifesPorLoja);
  const caixa = document.getElementById('compArmGraficosGrifesLoja');
  if (!caixa) return;
  caixa.style.display = compArmGrifesPorLoja ? '' : 'none';
  if (!compArmGrifesPorLoja) { caixa.innerHTML = ''; return; }

  const n = topNCompArm();
  const linhasUsadas = compArmLinhaGL === 'TODAS' ? linhas : linhas.filter(l => l.chave === compArmLinhaGL);
  // porLoja[id][grife][periodo] = valor
  const porLoja = {};
  resumos.forEach((r, pi) => {
    linhasUsadas.forEach(l => {
      Object.entries(r[l.chave]?.grifes || {}).forEach(([g, no]) => {
        Object.entries(no.lojas || {}).forEach(([id, v]) => {
          if (!porLoja[id]) porLoja[id] = {};
          if (!porLoja[id][g]) porLoja[id][g] = new Array(resumos.length).fill(0);
          porLoja[id][g][pi] += valorArm(v);
        });
      });
    });
  });
  const somaArr = a => a.reduce((s, v) => s + v, 0);
  const lojas = Object.keys(porLoja)
    .map(id => ({ id, grifes: porLoja[id], total: Object.values(porLoja[id]).reduce((s, a) => s + somaArr(a), 0) }))
    .sort((a, b) => b.total - a.total);
  const nomeLinhaSel = compArmLinhaGL === 'TODAS' ? 'todas as armações' : (linhasUsadas[0] ? linhasUsadas[0].titulo : compArmLinhaGL);
  const opcoes = [['TODAS', 'Todas']].concat(linhas.map(l => [l.chave, l.titulo.replace('Armação ', '')]));

  caixa.innerHTML = `<div class="ca-graf-cabecalho ca-graf-cab-flex">
      <span>🏬🏷️ Grifes por loja · evolução das ${n} grifes mais vendidas em cada loja <small>(${escHTML(nomeLinhaSel)})</small></span>
      <span class="ca-alternar">${opcoes.map(([v, t]) => `<button type="button" class="${compArmLinhaGL === v ? 'ativo' : ''}" onclick="escolherLinhaGrifesLoja('${v}')">${escHTML(t)}</button>`).join('')}</span>
    </div>
    ${lojas.length ? `<div class="ca-graf-grade">${lojas.map((lj, i) => {
      const nGrifes = Object.keys(lj.grifes).length;
      return `<div class="ca-graf-card" style="--cor-linha:${CORES_PALETA[i % CORES_PALETA.length]}">
        <div class="ca-graf-titulo">${escHTML(typeof nomeLojaComparativo === 'function' ? nomeLojaComparativo(lj.id) : 'Loja ' + lj.id)}
          <small>${fmtArm(lj.total)} no total · top ${Math.min(n, nGrifes)} de ${nGrifes} grifes</small></div>
        <div class="ca-graf-area"><canvas id="caGrafGL_${i}"></canvas></div>
      </div>`;
    }).join('')}</div>` : '<p class="arm-vazio">Sem vendas nos períodos.</p>'}`;

  lojas.forEach((lj, i) => {
    const canvas = document.getElementById(`caGrafGL_${i}`);
    if (!canvas) return;
    const top = Object.keys(lj.grifes).sort((a, b) => somaArr(lj.grifes[b]) - somaArr(lj.grifes[a])).slice(0, n);
    graficosGrifesLojaCompArm.push(new Chart(canvas, {
      type: 'line',
      data: {
        labels: periodos.map(p => p.rotulo),
        datasets: top.map((g, j) => {
          const cor = (typeof resumoArmacoes !== 'undefined' && resumoArmacoes && resumoArmacoes.coresGrife && resumoArmacoes.coresGrife[g])
            || CORES_PALETA[j % CORES_PALETA.length];
          return { label: g, data: lj.grifes[g], borderColor: cor, backgroundColor: cor, tension: 0.3, borderWidth: 2.5, pointRadius: 4, fill: false };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10.5 } } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtArm(c.raw)}` } }
        },
        scales: { y: { beginAtZero: true, ticks: { precision: compArmMetrica === 'qtd' ? 0 : undefined,
          callback: v => compArmMetrica === 'qtd' ? Number(v).toLocaleString('pt-BR') : 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
      }
    }));
  });
}

function escolherLinhaGrifesLoja(v) {
  compArmLinhaGL = v;
  redesenharComparativoArmacoes();
}

/* ---------- "Expandir": um gráfico por linha de armação (RX, Sun, Clip-on) ---------- */
let graficosExpandidosCompArm = [];

function topNCompArm() {
  const campo = document.getElementById('compArmTopN');
  let n = parseInt(campo && campo.value, 10);
  if (isNaN(n)) n = 5;
  n = Math.min(15, Math.max(3, n));
  if (campo) campo.value = n;
  return n;
}

/**
 * Para cada linha (RX, Sun, Clip-on) desenha a evolução dos N itens mais
 * vendidos: grifes (Expandir por grifes) e/ou lojas (Expandir por loja).
 * "Mais vendidos" = maior soma em todos os períodos mostrados.
 */
function renderizarGraficosExpandidosCompArm(periodos, resumos, linhas) {
  graficosExpandidosCompArm.forEach(g => g.destroy());
  graficosExpandidosCompArm = [];
  const n = topNCompArm();
  const blocos = [
    { tipo: 'grifes', ligado: compArmExpandirGrifes, caixa: 'compArmGraficosGrifes', titulo: 'grifes', campo: 'grifes',
      nome: k => k },
    { tipo: 'lojas', ligado: compArmExpandirLojas, caixa: 'compArmGraficosLojas', titulo: 'lojas', campo: 'lojas',
      nome: k => (typeof nomeLojaComparativo === 'function' ? nomeLojaComparativo(k) : `Loja ${k}`) }
  ];
  blocos.forEach(b => {
    const caixa = document.getElementById(b.caixa);
    if (!caixa) return;
    caixa.style.display = b.ligado ? '' : 'none';
    if (!b.ligado) { caixa.innerHTML = ''; return; }
    const itensPorLinha = linhas.map(l => {
      const nos = resumos.map(r => r[l.chave]?.[b.campo] || {});
      const soma = {};
      nos.forEach(m => Object.entries(m).forEach(([k, v]) => { soma[k] = (soma[k] || 0) + valorArm(v); }));
      const top = Object.keys(soma).sort((a, c) => soma[c] - soma[a]).slice(0, n);
      return { l, nos, top, total: Object.keys(soma).length };
    });
    caixa.innerHTML = `<div class="ca-graf-cabecalho">${b.tipo === 'grifes' ? '🏷️' : '🏬'} Evolução das ${n} ${b.titulo} mais vendidas em cada linha</div>
      <div class="ca-graf-grade">${itensPorLinha.map((x, i) => `
        <div class="ca-graf-card" style="--cor-linha:${x.l.cor}">
          <div class="ca-graf-titulo">${x.l.icone} ${escHTML(x.l.titulo)} <small>top ${Math.min(n, x.top.length)} de ${x.total} ${b.titulo}</small></div>
          ${x.top.length ? `<div class="ca-graf-area"><canvas id="caGraf_${b.tipo}_${i}"></canvas></div>` : '<p class="arm-vazio">Sem vendas nos períodos.</p>'}
        </div>`).join('')}</div>`;
    itensPorLinha.forEach((x, i) => {
      const canvas = document.getElementById(`caGraf_${b.tipo}_${i}`);
      if (!canvas) return;
      graficosExpandidosCompArm.push(new Chart(canvas, {
        type: 'line',
        data: {
          labels: periodos.map(p => p.rotulo),
          datasets: x.top.map((k, j) => {
            const cor = b.tipo === 'grifes' && resumoArmacoes && resumoArmacoes.coresGrife && resumoArmacoes.coresGrife[k]
              ? resumoArmacoes.coresGrife[k] : CORES_PALETA[j % CORES_PALETA.length];
            return {
              label: b.nome(k), data: x.nos.map(m => valorArm(m[k])),
              borderColor: cor, backgroundColor: cor, tension: 0.3, borderWidth: 2.5, pointRadius: 4, fill: false
            };
          })
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10.5 } } },
            tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtArm(c.raw)}` } }
          },
          scales: { y: { beginAtZero: true, ticks: { precision: compArmMetrica === 'qtd' ? 0 : undefined, callback: v => compArmMetrica === 'qtd' ? Number(v).toLocaleString('pt-BR') : 'R$ ' + Number(v).toLocaleString('pt-BR') } } }
        }
      }));
    });
  });
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
  else if (tipo === 'grifesLoja') compArmGrifesPorLoja = !compArmGrifesPorLoja;
  else compArmExpandirLojas = !compArmExpandirLojas;
  redesenharComparativoArmacoes();
  const alvo = document.getElementById({ grifes: 'compArmGraficosGrifes', grifesLoja: 'compArmGraficosGrifesLoja' }[tipo] || 'compArmGraficosLojas');
  if (alvo && alvo.style.display !== 'none') alvo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function alternarNoCompArm(id, estavaAberto) {
  if (estavaAberto) { compArmAbertos.delete(id); compArmFechados.add(id); }
  else { compArmFechados.delete(id); compArmAbertos.add(id); }
  redesenharComparativoArmacoes();
}
