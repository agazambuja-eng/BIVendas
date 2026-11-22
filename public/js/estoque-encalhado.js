/**
 * Aba Avaliação de Produtos · "Estoque encalhado".
 *
 * Estoque: rota /consultaestoque (SavWin EstoqueAnaliticoGrid, só estoque > 0).
 * Giro:    vendas dos últimos 3/6/12 meses (rota /consulta), casadas com o
 *          estoque por MATID, SEQUENCIAL/CÓDIGO ou descrição (o que casar mais).
 *
 *  Dias sem vender = hoje − última venda (vazio = nunca vendeu)
 *  Giro mensal     = vendido na janela ÷ meses
 *  Cobertura       = estoque ÷ giro mensal (meses)
 *  Encalhado       = sem venda há X dias ou mais (X escolhido na tela; padrão 180).
 *                    Nunca vendeu: conta pela data da última compra.
 */

const FAIXAS_EE = [
  { id: 'f90',   rotulo: '0 a 90 dias',    cor: '#3dffa8' },
  { id: 'f180',  rotulo: '90 a 180 dias',  cor: '#ffd35e' },
  { id: 'f365',  rotulo: '180 a 365 dias', cor: '#ff9f43' },
  { id: 'fmais', rotulo: 'Mais de 365',    cor: '#ff5c8a' },
  { id: 'nunca', rotulo: 'Nunca vendeu',   cor: '#8a93c9' }
];
const LIMITE_LINHAS_EE = 150;

const ee = {
  linhas: null,            // linhas do estoque já decodificadas
  quando: '',
  carregando: false,
  limite: 180,
  meses: 3,
  metrica: 'custo',
  visao: 'loja',
  faixa: '',
  loja: '', tipo: '', busca: '',
  ordem: { campo: 'custoEnc', desc: true },
  mostrar: LIMITE_LINHAS_EE,
  abertos: new Set(),
  vendas: {},              // cache por janela: chave -> tuplas
  giro: null,              // { campo, porChave: Map(chave -> {q, porLoja}), casados, grife: Map }
  grafico: null,
  ultimaTabela: null       // para exportar CSV
};

// ---------------------------------------------------------------- utilidades
const fmtPc = n => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtR = n => formatarMoedaBR(Number(n) || 0);
const fmtRc = n => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCob = c => c === Infinity ? '<span class="ee-sem-giro" title="Sem venda no período do giro">sem giro</span>'
  : !isFinite(c) ? '—' : c.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const normDesc = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function hojeEE() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function diasDesde(iso) {
  if (!iso) return null;
  const [a, m, d] = iso.split('-').map(Number);
  return Math.max(0, Math.round((hojeEE() - new Date(a, m - 1, d)) / 86400000));
}
function faixaDe(dias) {
  if (dias === null) return 'nunca';
  if (dias <= 90) return 'f90';
  if (dias <= 180) return 'f180';
  if (dias <= 365) return 'f365';
  return 'fmais';
}
function nomeLojaEE(id) {
  const n = typeof nomeLojaComparar === 'function' ? nomeLojaComparar(id).nome : '';
  return n ? `${id} · ${n}` : `Loja ${id}`;
}
function lojasDoUsuarioEE() {
  const lista = (typeof lojasDisponiveis !== 'undefined' ? lojasDisponiveis : []);
  return lista.map(l => String(l.id).replace(/\D/g, '')).filter(Boolean).join(',');
}
function statusEE(html) {
  const el = document.getElementById('eeStatus');
  if (!el) return;
  el.innerHTML = html || '';
  el.style.display = html ? '' : 'none';
}

// ---------------------------------------------------------------- barra de carregamento
/* A SavWin não informa o progresso: na etapa do estoque a barra avança por
   estimativa (aproxima-se do fim da etapa sem chegar); nas vendas, mês a mês. */
const barraEE = { inicio: 0, timer: null, de: 0, ate: 0, t0: 0, estim: 0, texto: '' };

function iniciarBarraEE() {
  pararBarraEE();
  barraEE.inicio = Date.now();
  barraEE.timer = setInterval(desenharBarraEE, 250);
}
function etapaBarraEE(de, ate, texto, estimSeg) {
  Object.assign(barraEE, { de, ate, texto, estim: estimSeg || 0, t0: Date.now() });
  desenharBarraEE();
}
function pararBarraEE() {
  if (barraEE.timer) clearInterval(barraEE.timer);
  barraEE.timer = null;
}
function desenharBarraEE() {
  const el = document.getElementById('eeStatus');
  if (!el) return;
  const t = (Date.now() - barraEE.t0) / 1000;
  const frac = barraEE.estim ? 1 - Math.exp(-t / barraEE.estim) : 0;
  const pct = Math.min(99, barraEE.de + (barraEE.ate - barraEE.de) * frac * 0.97);
  const total = Math.round((Date.now() - barraEE.inicio) / 1000);
  const demora = barraEE.de === 0 && t > 60
    ? '<small class="ee-barra-aviso">A SavWin ainda está processando. Pode deixar a tela aberta: a busca continua no servidor.</small>' : '';
  el.innerHTML = `
    <div class="ee-progresso-topo"><span>⏳ ${barraEE.texto}</span><span>${Math.floor(pct)}% · ${total} s</span></div>
    <div class="ee-progresso"><i style="width:${pct.toFixed(1)}%"></i></div>${demora}`;
  el.style.display = '';
}

// ---------------------------------------------------------------- carregar
async function carregarEstoqueEncalhado(atualizar = false) {
  if (ee.carregando) return;
  ee.carregando = true;
  const btn = document.getElementById('eeBtnCarregar');
  if (btn) btn.disabled = true;
  try {
    iniciarBarraEE();
    etapaBarraEE(0, 65, 'Etapa 1 de 2 · buscando o estoque na SavWin (pode levar alguns minutos)', 45);
    // O servidor busca na SavWin em segundo plano e responde 202 enquanto não termina.
    const limite = Date.now() + 20 * 60 * 1000;
    let corpo, forcar = atualizar === true;
    while (true) {
      const resp = await fetchAutenticado('/consultaestoque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ LOJAS: lojasDoUsuarioEE(), ATUALIZAR: forcar })
      });
      forcar = false;
      corpo = await resp.json().catch(() => ({}));
      if (resp.status === 202) {
        if (Date.now() > limite) throw new Error('A SavWin passou de 20 minutos sem responder. Tente de novo mais tarde.');
        await new Promise(r => setTimeout(r, 4000));
        continue;
      }
      if (!resp.ok) throw new Error(corpo.error || `Erro ${resp.status} ao buscar o estoque`);
      break;
    }
    etapaBarraEE(65, 70, 'Organizando o estoque...', 0);
    await new Promise(r => setTimeout(r, 30));   // deixa a barra aparecer antes do processamento
    decodificarEstoque(corpo);
    await prepararGiro(70, 100);
    pararBarraEE();
    statusEE('');
    document.getElementById('eeConteudo').style.display = '';
    renderizarEstoqueEncalhado();
  } catch (e) {
    pararBarraEE();
    statusEE(`⚠️ ${escHTML(e.message)}`);
  } finally {
    ee.carregando = false;
    if (btn) { btn.disabled = false; btn.textContent = '↻ Atualizar estoque'; }
  }
}

function decodificarEstoque(corpo) {
  const c = {};
  (corpo.colunas || []).forEach((nome, i) => { c[nome] = i; });
  const dic = corpo.dic || {};
  ee.quando = corpo.quando || '';
  ee.linhas = (corpo.linhas || []).map(l => {
    const produto = (dic.produto || [])[l[c.produto]] || '';
    const r = {
      loja: String(l[c.loja]),
      matid: l[c.matid] || '',
      seq: l[c.seq] || '',
      produto,
      desc: normDesc(produto),
      fornecedor: (dic.fornecedor || [])[l[c.fornecedor]] || '',
      tipo: (dic.tipo || [])[l[c.tipo]] || '',
      grifeApi: (dic.grife || [])[l[c.grife]] || '',
      estoque: Number(l[c.estoque]) || 0,
      custoUnit: Number(l[c.custoUnit]) || 0,
      custo: Number(l[c.custoTotal]) || 0,
      ultVenda: l[c.ultVenda] || '',
      ultCompra: l[c.ultCompra] || ''
    };
    r.chave = r.matid || r.seq || r.desc;
    r.dias = diasDesde(r.ultVenda);
    r.diasCompra = diasDesde(r.ultCompra);
    r.faixa = faixaDe(r.dias);
    return r;
  });
  preencherFiltrosEE();
}

// ----- giro: vendas da janela -----
function janelasGiro(meses) {
  const hoje = hojeEE();
  const lista = [];
  for (let i = 0; i < meses; i++) {
    const fim = new Date(hoje); fim.setMonth(fim.getMonth() - i);
    const ini = new Date(hoje); ini.setMonth(ini.getMonth() - i - 1); ini.setDate(ini.getDate() + 1);
    lista.push({ ini, fim });
  }
  return lista;
}
const brData = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function tuplasDeVendas(dados) {
  const chaves = chavesDosDados(dados);
  const achar = res => { for (const re of res) { const k = chaves.find(x => re.test(x)); if (k) return k; } return null; };
  const kMat = achar([/^MATID$/i, /MAT.?ID/i]);
  const kSeq = achar([/^SEQUENCIAL$/i, /^CODIGO$/i, /^COD.?PRODUTO$/i, /CODIGO.?PRODUTO/i]);
  const kDesc = achar([/^DESCRICAO$/i, /^PRODUTO$/i, /DESCRICAO.?PRODUTO/i]);
  const kGrife = achar([/^GRIFE$/i, /GRIFE/i, /^MARCA$/i]);
  return (dados || []).map(it => {
    const m = String(it.LOJANOME ?? it.CODIGOLOJA ?? it.LOJA ?? '').match(/^0*(\d+)/);
    return [m ? m[1] : '', kMat ? String(it[kMat] ?? '').trim() : '', kSeq ? String(it[kSeq] ?? '').trim() : '',
      kDesc ? normDesc(it[kDesc]) : '', parseNumeroBR(it.QUANTIDADE) || 0, kGrife ? String(it[kGrife] ?? '').trim() : ''];
  });
}

async function prepararGiro(de = 0, ate = 100) {
  const lojas = lojasDoUsuarioEE();
  const janelas = janelasGiro(ee.meses);
  const tuplas = [];
  for (let i = 0; i < janelas.length; i++) {
    const j = janelas[i];
    const chave = `${brData(j.ini)}_${brData(j.fim)}_${lojas}`;
    if (!ee.vendas[chave]) {
      const passo = (ate - de) / janelas.length;
      etapaBarraEE(de + passo * i, de + passo * (i + 1), `Etapa 2 de 2 · vendas para o giro: mês ${i + 1} de ${janelas.length}`, 4);
      const resp = await fetchAutenticado('/consulta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ DATAINICIAL: brData(j.ini), DATAFINAL: brData(j.fim), LOJAS: lojas, TIPODATA: 'VENDA', TIPOVENDA: '' })
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.error || `Erro ${resp.status} ao buscar as vendas do giro`);
      }
      const dados = await resp.json();
      ee.vendas[chave] = tuplasDeVendas(Array.isArray(dados) ? dados : (dados && dados.dados) || []);
    }
    tuplas.push(...ee.vendas[chave]);
  }
  ee.giro = casarGiro(tuplas);
}

/** Escolhe o campo que mais casa vendas com estoque e soma as vendas por produto/loja. */
function casarGiro(tuplas) {
  const opcoes = [['matid', 1], ['seq', 2], ['desc', 3]];
  let melhor = null;
  for (const [campo, pos] of opcoes) {
    const vendidos = new Set(tuplas.map(t => t[pos]).filter(Boolean));
    if (!vendidos.size) continue;
    const doEstoque = new Set(ee.linhas.map(r => r[campo]).filter(Boolean));
    let casados = 0;
    doEstoque.forEach(k => { if (vendidos.has(k)) casados++; });
    if (!melhor || casados > melhor.casados) melhor = { campo, pos, casados, total: doEstoque.size };
  }
  const porChave = new Map();
  const grife = new Map();
  if (melhor && melhor.casados) {
    for (const t of tuplas) {
      const k = t[melhor.pos];
      if (!k) continue;
      let g = porChave.get(k);
      if (!g) { g = { q: 0, porLoja: {} }; porChave.set(k, g); }
      g.q += t[4];
      g.porLoja[t[0]] = (g.porLoja[t[0]] || 0) + t[4];
      if (t[5] && !grife.has(k)) grife.set(k, t[5]);
    }
  }
  return { ...(melhor || { campo: null, casados: 0, total: 0 }), porChave, grife };
}

/** Vendas mensais do produto da linha, na loja da linha. */
function giroLinha(r) {
  if (!ee.giro || !ee.giro.campo) return 0;
  const g = ee.giro.porChave.get(r[ee.giro.campo]);
  return g ? Math.max(0, g.porLoja[r.loja] || 0) / ee.meses : 0;
}
function grifeLinha(r) {
  if (r.grifeApi) return r.grifeApi;
  if (ee.giro && ee.giro.campo) return ee.giro.grife.get(r[ee.giro.campo]) || '';
  return '';
}
function encalhada(r) {
  const ref = r.dias !== null ? r.dias : (r.diasCompra !== null ? r.diasCompra : Infinity);
  return ref >= ee.limite;
}

// ---------------------------------------------------------------- filtros
function preencherFiltrosEE() {
  const selLoja = document.getElementById('eeLoja');
  const selTipo = document.getElementById('eeTipo');
  const lojas = [...new Set(ee.linhas.map(r => r.loja))].sort((a, b) => Number(a) - Number(b));
  const tipos = [...new Set(ee.linhas.map(r => r.tipo).filter(Boolean))].sort();
  selLoja.innerHTML = '<option value="">Todas as lojas</option>' + lojas.map(l => `<option value="${escHTML(l)}">${escHTML(nomeLojaEE(l))}</option>`).join('');
  selTipo.innerHTML = '<option value="">Todos os tipos</option>' + tipos.map(t => `<option value="${escHTML(t)}">${escHTML(t)}</option>`).join('');
  selLoja.value = lojas.includes(ee.loja) ? ee.loja : (ee.loja = '');
  selTipo.value = tipos.includes(ee.tipo) ? ee.tipo : (ee.tipo = '');
}

function filtroEE(r, { ignorarLoja = false, ignorarFaixa = false } = {}) {
  if (!ignorarLoja && ee.loja && r.loja !== ee.loja) return false;
  if (ee.tipo && r.tipo !== ee.tipo) return false;
  if (!ignorarFaixa && ee.faixa && r.faixa !== ee.faixa) return false;
  if (ee.busca) {
    const b = normDesc(ee.busca);
    if (!(r.desc.includes(b) || normDesc(r.fornecedor).includes(b) || r.matid === ee.busca.trim() ||
          r.seq === ee.busca.trim() || normDesc(grifeLinha(r)).includes(b))) return false;
  }
  return true;
}

function mudarFiltroEE(campo, valor) {
  ee[campo] = valor;
  ee.mostrar = LIMITE_LINHAS_EE;
  renderizarEstoqueEncalhado();
}
async function mudarMesesGiroEE(v) {
  ee.meses = Number(v) || 3;
  if (!ee.linhas) return;
  if (ee.carregando) return;
  ee.carregando = true;
  iniciarBarraEE();
  try { await prepararGiro(0, 100); statusEE(''); } catch (e) { statusEE(`⚠️ ${escHTML(e.message)}`); }
  finally { pararBarraEE(); ee.carregando = false; }
  renderizarEstoqueEncalhado();
}
function escolherVisaoEE(v) {
  ee.visao = v;
  ee.mostrar = LIMITE_LINHAS_EE;
  ee.ordem = { campo: v === 'remanejar' ? 'custo' : 'custoEnc', desc: true };
  document.querySelectorAll('#eeVisoes button').forEach(b => b.classList.toggle('ativo', b.dataset.v === v));
  renderizarTabelaEE();
}
function escolherMetricaEE(m) {
  ee.metrica = m;
  document.querySelectorAll('#eeMetrica button').forEach(b => b.classList.toggle('ativo', b.dataset.m === m));
  desenharFaixasEE();
}
function ordenarEE(campo) {
  ee.ordem = ee.ordem.campo === campo ? { campo, desc: !ee.ordem.desc } : { campo, desc: campo !== 'nome' };
  renderizarTabelaEE();
}

// ---------------------------------------------------------------- tela
function renderizarEstoqueEncalhado() {
  if (!ee.linhas) return;
  const linhas = ee.linhas.filter(r => filtroEE(r, { ignorarFaixa: true }));
  const sel = ee.faixa ? linhas.filter(r => r.faixa === ee.faixa) : linhas;

  const soma = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
  const pecas = soma(sel, r => r.estoque), custo = soma(sel, r => r.custo);
  const enc = sel.filter(encalhada);
  const pecasEnc = soma(enc, r => r.estoque), custoEnc = soma(enc, r => r.custo);
  const giro = soma(sel, giroLinha);
  const nunca = sel.filter(r => r.dias === null);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
  set('eeCardPecas', fmtPc(pecas));
  set('eeCardCusto', fmtR(custo));
  set('eeCardProdutos', new Set(sel.map(r => r.chave)).size.toLocaleString('pt-BR'));
  set('eeCardLojas', new Set(sel.map(r => r.loja)).size.toLocaleString('pt-BR'));
  set('eeCardEnc', `${fmtR(custoEnc)}<small>${fmtPc(pecasEnc)} peças · ${custo ? ((custoEnc / custo) * 100).toFixed(1).replace('.', ',') : '0'}% do custo</small>`);
  set('eeCardEncTitulo', `ENCALHADO · ${ee.limite}+ DIAS SEM VENDER`);
  set('eeCardCob', `${giro > 0 ? (pecas / giro).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}<small>meses · giro de ${ee.meses} meses</small>`);
  set('eeCardNunca', `${new Set(nunca.map(r => r.chave)).size.toLocaleString('pt-BR')}<small>${fmtPc(soma(nunca, r => r.estoque))} peças · ${fmtRc(soma(nunca, r => r.custo))}</small>`);

  const quando = ee.quando ? new Date(ee.quando) : null;
  const g = ee.giro || {};
  set('eeInfo', [
    quando ? `Estoque de ${quando.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : '',
    g.campo ? `giro casado por <b>${{ matid: 'MATID', seq: 'código/sequencial', desc: 'descrição' }[g.campo]}</b> (${g.total ? Math.round(g.casados / g.total * 100) : 0}% dos produtos em estoque venderam nos últimos ${ee.meses} meses)`
            : '<span class="ee-alerta">não foi possível casar as vendas com o estoque: giro e cobertura ficam sem valor</span>',
    ee.faixa ? `filtro: <b>${FAIXAS_EE.find(f => f.id === ee.faixa).rotulo}</b> <button type="button" class="tv-link" onclick="mudarFiltroEE('faixa','')">limpar</button>` : ''
  ].filter(Boolean).join(' · '));

  desenharFaixasEE(linhas);
  renderizarTabelaEE();
}

function desenharFaixasEE(linhas) {
  if (!ee.linhas) return;
  linhas = linhas || ee.linhas.filter(r => filtroEE(r, { ignorarFaixa: true }));
  const val = r => ee.metrica === 'custo' ? r.custo : r.estoque;
  const tot = FAIXAS_EE.map(f => linhas.filter(r => r.faixa === f.id));
  const valores = tot.map(arr => arr.reduce((s, r) => s + val(r), 0));
  const pecas = tot.map(arr => arr.reduce((s, r) => s + r.estoque, 0));
  const custos = tot.map(arr => arr.reduce((s, r) => s + r.custo, 0));
  const totalV = valores.reduce((a, b) => a + b, 0);

  // legenda/resumo ao lado do gráfico
  const leg = document.getElementById('eeFaixasLegenda');
  if (leg) leg.innerHTML = FAIXAS_EE.map((f, i) => `
    <li class="${ee.faixa === f.id ? 'ativo' : ''}" onclick="mudarFiltroEE('faixa', ee.faixa === '${f.id}' ? '' : '${f.id}')" title="Clique para filtrar">
      <i style="background:${f.cor}"></i><span>${f.rotulo}</span>
      <b>${totalV ? ((valores[i] / totalV) * 100).toFixed(1).replace('.', ',') : '0'}%</b>
      <small>${fmtPc(pecas[i])} pç · ${fmtRc(custos[i])}</small>
    </li>`).join('');

  const canvas = document.getElementById('graficoFaixasEE');
  if (!canvas) return;
  if (ee.grafico) ee.grafico.destroy();
  ee.grafico = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: FAIXAS_EE.map(f => f.rotulo),
      datasets: [{
        data: valores,
        backgroundColor: FAIXAS_EE.map(f => (!ee.faixa || ee.faixa === f.id) ? f.cor : f.cor + '40'),
        borderRadius: 6, maxBarThickness: 70
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => [`${fmtPc(pecas[ctx.dataIndex])} peças`, fmtR(custos[ctx.dataIndex])] } }
      },
      scales: { y: { beginAtZero: true, ticks: { callback: v => ee.metrica === 'custo' ? fmtRc(v) : fmtPc(v) } } },
      onClick: (ev, els) => {
        if (!els.length) return;
        const id = FAIXAS_EE[els[0].index].id;
        mudarFiltroEE('faixa', ee.faixa === id ? '' : id);
      }
    }
  });
}

// ---------------------------------------------------------------- tabelas
function barraFaixas(porFaixa, total) {
  if (!total) return '';
  return `<div class="ee-barra" title="${FAIXAS_EE.map(f => `${f.rotulo}: ${fmtRc(porFaixa[f.id] || 0)}`).join('\n')}">` +
    FAIXAS_EE.map(f => porFaixa[f.id] ? `<i style="width:${(porFaixa[f.id] / total) * 100}%;background:${f.cor}"></i>` : '').join('') + '</div>';
}

function agruparEE(linhas, chaveDe, nomeDe) {
  const mapa = new Map();
  for (const r of linhas) {
    const k = chaveDe(r);
    let g = mapa.get(k);
    if (!g) { g = { chave: k, nome: nomeDe(r), pecas: 0, custo: 0, pecasEnc: 0, custoEnc: 0, giro: 0, porFaixa: {}, linhas: [] }; mapa.set(k, g); }
    g.pecas += r.estoque; g.custo += r.custo;
    if (encalhada(r)) { g.pecasEnc += r.estoque; g.custoEnc += r.custo; }
    g.giro += giroLinha(r);
    g.porFaixa[r.faixa] = (g.porFaixa[r.faixa] || 0) + r.custo;
    g.linhas.push(r);
  }
  const lista = [...mapa.values()];
  lista.forEach(g => {
    g.pctEnc = g.custo ? (g.custoEnc / g.custo) * 100 : 0;
    g.cob = g.giro > 0 ? g.pecas / g.giro : (g.pecas > 0 ? Infinity : NaN);
  });
  return lista;
}

function ordenarListaEE(lista) {
  const { campo, desc } = ee.ordem;
  const v = x => { const y = x[campo]; return typeof y === 'string' ? y : (isFinite(y) ? y : (y === Infinity ? 1e15 : -1)); };
  return lista.sort((a, b) => {
    const A = v(a), B = v(b);
    const r = typeof A === 'string' ? A.localeCompare(B, 'pt-BR') : A - B;
    return desc ? -r : r;
  });
}

function th(campo, rotulo, classe = 'num') {
  const seta = ee.ordem.campo === campo ? (ee.ordem.desc ? ' ▼' : ' ▲') : '';
  return `<th class="${classe} ee-ordenavel" onclick="ordenarEE('${campo}')">${rotulo}${seta}</th>`;
}

function renderizarTabelaEE() {
  const alvo = document.getElementById('eeTabela');
  if (!alvo || !ee.linhas) return;
  const linhas = ee.linhas.filter(r => filtroEE(r));
  if (!linhas.length) { alvo.innerHTML = '<p class="arm-vazio">Nenhum item de estoque com esses filtros.</p>'; ee.ultimaTabela = null; return; }
  if (ee.visao === 'produto') return renderizarProdutosEE(alvo, linhas);
  if (ee.visao === 'remanejar') return renderizarRemanejamentoEE(alvo);

  const def = {
    loja: [r => r.loja, r => nomeLojaEE(r.loja), 'Loja'],
    fornecedor: [r => r.fornecedor || '—', r => r.fornecedor || '(sem fornecedor)', 'Fornecedor / fabricante'],
    tipo: [r => r.tipo || '—', r => r.tipo || '(sem tipo)', 'Tipo de produto'],
    grife: [r => grifeLinha(r) || '—', r => grifeLinha(r) || '(grife não identificada)', 'Grife']
  }[ee.visao];
  const lista = ordenarListaEE(agruparEE(linhas, def[0], def[1]));
  const tot = agruparEE(linhas, () => 'total', () => 'TOTAL')[0];
  const vis = lista.slice(0, ee.mostrar);

  const linha = (g, cls = '') => `<tr class="${cls}">
      <td class="ee-nome">${escHTML(g.nome)}</td>
      <td class="num">${fmtPc(g.pecas)}</td><td class="num">${fmtR(g.custo)}</td>
      <td class="num">${fmtPc(g.pecasEnc)}</td><td class="num ee-enc">${fmtR(g.custoEnc)}</td>
      <td class="num">${g.pctEnc.toFixed(1).replace('.', ',')}%</td>
      <td class="num">${fmtPc(g.giro)}</td><td class="num">${fmtCob(g.cob)}</td>
      <td class="ee-col-barra">${barraFaixas(g.porFaixa, g.custo)}</td></tr>`;

  alvo.innerHTML = `
    ${ee.visao === 'grife' && !ee.linhas.some(r => r.grifeApi) ? '<p class="lf-ajuda">A API de estoque não traz a grife: ela vem das vendas do período do giro. Produto que não vendeu nesse período aparece como "grife não identificada".</p>' : ''}
    <div class="ee-tabela-rolagem"><table class="la-tabela ee-tabela">
      <thead><tr>${th('nome', def[2], 'ee-nome')}${th('pecas', 'Peças')}${th('custo', 'Custo')}${th('pecasEnc', 'Peças encalhadas')}${th('custoEnc', 'Custo encalhado')}${th('pctEnc', '% encalhado')}${th('giro', 'Venda/mês')}${th('cob', 'Cobertura (meses)')}<th>Idade do estoque (custo)</th></tr></thead>
      <tbody>${vis.map(g => linha(g)).join('')}${linha(tot, 'ee-total')}</tbody>
    </table></div>
    ${lista.length > vis.length ? `<button type="button" class="tv-link" onclick="ee.mostrar += ${LIMITE_LINHAS_EE}; renderizarTabelaEE()">Mostrar mais (${lista.length - vis.length} restantes)</button>` : ''}`;

  ee.ultimaTabela = {
    nome: `estoque_por_${ee.visao}`,
    cab: [def[2], 'Pecas', 'Custo', 'Pecas encalhadas', 'Custo encalhado', '% encalhado', 'Venda/mes', 'Cobertura (meses)'],
    linhas: lista.map(g => [g.nome, g.pecas, g.custo, g.pecasEnc, g.custoEnc, g.pctEnc, g.giro, isFinite(g.cob) ? g.cob : ''])
  };
}

function renderizarProdutosEE(alvo, linhas) {
  const lista = agruparEE(linhas, r => r.chave, r => r.produto || r.chave);
  lista.forEach(g => {
    const r0 = g.linhas[0];
    g.fornecedor = r0.fornecedor; g.tipo = r0.tipo; g.grife = grifeLinha(r0);
    g.codigo = [r0.matid && `MATID ${r0.matid}`, r0.seq && `SEQ ${r0.seq}`].filter(Boolean).join(' · ');
    g.lojas = new Set(g.linhas.map(r => r.loja)).size;
    const dias = g.linhas.map(r => r.dias).filter(d => d !== null);
    g.dias = dias.length ? Math.min(...dias) : Infinity;   // última venda em qualquer loja
  });
  ordenarListaEE(lista);
  const vis = lista.slice(0, ee.mostrar);
  const diasTxt = d => d === Infinity ? '<span class="ee-sem-giro">nunca</span>' : `${d} d`;

  alvo.innerHTML = `
    <div class="ee-tabela-rolagem"><table class="la-tabela ee-tabela">
      <thead><tr>${th('nome', 'Produto', 'ee-nome')}${th('lojas', 'Lojas')}${th('pecas', 'Peças')}${th('custo', 'Custo')}${th('custoEnc', 'Custo encalhado')}${th('dias', 'Última venda (rede)')}${th('giro', 'Venda/mês')}${th('cob', 'Cobertura (meses)')}</tr></thead>
      <tbody>${vis.map(g => {
        const aberto = ee.abertos.has(g.chave);
        const sub = aberto ? g.linhas.slice().sort((a, b) => b.custo - a.custo).map(r => {
          const gi = giroLinha(r);
          return `<tr class="ee-sub ${encalhada(r) ? 'ee-sub-enc' : ''}"><td class="ee-nome">${escHTML(nomeLojaEE(r.loja))}<small>${r.ultVenda ? 'últ. venda ' + r.ultVenda.split('-').reverse().join('/') : 'nunca vendeu'}${r.ultCompra ? ' · últ. compra ' + r.ultCompra.split('-').reverse().join('/') : ''}</small></td>
            <td></td><td class="num">${fmtPc(r.estoque)}</td><td class="num">${fmtR(r.custo)}</td><td class="num">${encalhada(r) ? fmtR(r.custo) : '—'}</td>
            <td class="num">${diasTxt(r.dias === null ? Infinity : r.dias)}</td><td class="num">${fmtPc(gi)}</td><td class="num">${fmtCob(gi > 0 ? r.estoque / gi : Infinity)}</td></tr>`;
        }).join('') : '';
        return `<tr class="ee-prod" onclick="alternarProdutoEE(${escHTML(JSON.stringify(g.chave))})">
            <td class="ee-nome"><span class="la-seta">${aberto ? '▾' : '▸'}</span> ${escHTML(g.nome)}<small>${escHTML([g.fornecedor, g.tipo, g.grife, g.codigo].filter(Boolean).join(' · '))}</small></td>
            <td class="num">${g.lojas}</td><td class="num">${fmtPc(g.pecas)}</td><td class="num">${fmtR(g.custo)}</td>
            <td class="num ee-enc">${g.custoEnc ? fmtR(g.custoEnc) : '—'}</td><td class="num">${diasTxt(g.dias)}</td>
            <td class="num">${fmtPc(g.giro)}</td><td class="num">${fmtCob(g.cob)}</td></tr>${sub}`;
      }).join('')}</tbody>
    </table></div>
    ${lista.length > vis.length ? `<button type="button" class="tv-link" onclick="ee.mostrar += ${LIMITE_LINHAS_EE}; renderizarTabelaEE()">Mostrar mais (${lista.length - vis.length} restantes)</button>` : ''}`;

  ee.ultimaTabela = {
    nome: 'estoque_por_produto',
    cab: ['Produto', 'MATID', 'Sequencial', 'Fornecedor', 'Tipo', 'Grife', 'Lojas', 'Pecas', 'Custo', 'Custo encalhado', 'Dias desde ultima venda (rede)', 'Venda/mes', 'Cobertura (meses)'],
    linhas: lista.map(g => [g.nome, g.linhas[0].matid, g.linhas[0].seq, g.fornecedor, g.tipo, g.grife, g.lojas, g.pecas, g.custo, g.custoEnc,
      isFinite(g.dias) ? g.dias : 'nunca', g.giro, isFinite(g.cob) ? g.cob : ''])
  };
}
function alternarProdutoEE(chave) {
  if (ee.abertos.has(chave)) ee.abertos.delete(chave); else ee.abertos.add(chave);
  renderizarTabelaEE();
}

/** Parado numa loja, vendendo em outra. */
function sugestoesRemanejamento() {
  const base = ee.linhas.filter(r => filtroEE(r, { ignorarLoja: true, ignorarFaixa: true }));
  const porProduto = new Map();
  base.forEach(r => { if (!porProduto.has(r.chave)) porProduto.set(r.chave, []); porProduto.get(r.chave).push(r); });
  const lista = [];
  porProduto.forEach((rows, chave) => {
    const origens = rows.filter(r => encalhada(r) && (!ee.loja || r.loja === ee.loja) && (!ee.faixa || r.faixa === ee.faixa));
    if (!origens.length) return;
    const lojasOrigem = new Set(origens.map(r => r.loja));
    const vendas = (ee.giro && ee.giro.campo && ee.giro.porChave.get(rows[0][ee.giro.campo])) || null;
    const destinos = new Map();
    if (vendas) Object.entries(vendas.porLoja).forEach(([loja, q]) => {
      if (q > 0 && !lojasOrigem.has(loja)) destinos.set(loja, { loja, vendidas: q, estoque: 0 });
    });
    rows.forEach(r => {
      if (lojasOrigem.has(r.loja)) return;
      const d = destinos.get(r.loja);
      if (d) d.estoque += r.estoque;
      else if (r.dias !== null && r.dias <= 90) destinos.set(r.loja, { loja: r.loja, vendidas: 0, estoque: r.estoque, dias: r.dias });
    });
    if (!destinos.size) return;
    const dest = [...destinos.values()].sort((a, b) => b.vendidas - a.vendidas || a.estoque - b.estoque);
    lista.push({
      chave, nome: rows[0].produto || chave, fornecedor: rows[0].fornecedor, tipo: rows[0].tipo,
      origens: origens.sort((a, b) => b.custo - a.custo), destinos: dest,
      pecas: origens.reduce((s, r) => s + r.estoque, 0), custo: origens.reduce((s, r) => s + r.custo, 0),
      vendidas: dest.reduce((s, d) => s + d.vendidas, 0)
    });
  });
  return lista;
}

function renderizarRemanejamentoEE(alvo) {
  const lista = ordenarListaEE(sugestoesRemanejamento());
  const vis = lista.slice(0, ee.mostrar);
  const pecas = lista.reduce((s, x) => s + x.pecas, 0), custo = lista.reduce((s, x) => s + x.custo, 0);
  alvo.innerHTML = `
    <p class="lf-ajuda"><b>${lista.length.toLocaleString('pt-BR')}</b> produtos parados há ${ee.limite}+ dias numa loja e vendendo em outra
      (vendeu nos últimos ${ee.meses} meses ou teve venda nos últimos 90 dias): <b>${fmtPc(pecas)} peças · ${fmtR(custo)}</b> a custo que podem girar sem nova compra.</p>
    ${lista.length ? `<div class="ee-tabela-rolagem"><table class="la-tabela ee-tabela">
      <thead><tr>${th('nome', 'Produto', 'ee-nome')}<th>Parado em</th><th>Vendendo em</th>${th('pecas', 'Peças paradas')}${th('custo', 'Custo parado')}${th('vendidas', `Vendidas (${ee.meses}m)`)}</tr></thead>
      <tbody>${vis.map(x => `<tr>
        <td class="ee-nome">${escHTML(x.nome)}<small>${escHTML([x.fornecedor, x.tipo].filter(Boolean).join(' · '))}</small></td>
        <td class="ee-lojas">${x.origens.map(r => `<span class="ee-chip ee-chip-parado">${escHTML(nomeLojaEE(r.loja))} · ${fmtPc(r.estoque)} pç · ${r.dias === null ? 'nunca vendeu' : r.dias + ' d'}</span>`).join('')}</td>
        <td class="ee-lojas">${x.destinos.slice(0, 4).map(d => `<span class="ee-chip ee-chip-vende">${escHTML(nomeLojaEE(d.loja))} · ${d.vendidas ? fmtPc(d.vendidas) + ' vend.' : 'venda há ' + d.dias + ' d'} · estoque ${fmtPc(d.estoque)}</span>`).join('')}${x.destinos.length > 4 ? `<small>+${x.destinos.length - 4} lojas</small>` : ''}</td>
        <td class="num">${fmtPc(x.pecas)}</td><td class="num ee-enc">${fmtR(x.custo)}</td><td class="num">${fmtPc(x.vendidas)}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    ${lista.length > vis.length ? `<button type="button" class="tv-link" onclick="ee.mostrar += ${LIMITE_LINHAS_EE}; renderizarTabelaEE()">Mostrar mais (${lista.length - vis.length} restantes)</button>` : ''}`;

  ee.ultimaTabela = {
    nome: 'remanejamento',
    cab: ['Produto', 'Fornecedor', 'Tipo', 'Parado em', 'Vendendo em', 'Pecas paradas', 'Custo parado', `Vendidas (${ee.meses}m)`],
    linhas: lista.map(x => [x.nome, x.fornecedor, x.tipo,
      x.origens.map(r => `${r.loja} (${r.estoque} pc)`).join(' | '),
      x.destinos.map(d => `${d.loja} (${d.vendidas} vend.)`).join(' | '), x.pecas, x.custo, x.vendidas])
  };
}

// ---------------------------------------------------------------- exportar
function exportarEstoqueEE() {
  const t = ee.ultimaTabela;
  if (!t) return;
  const cel = v => typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [t.cab.map(cel).join(';'), ...t.linhas.map(l => l.map(cel).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${t.nome}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
