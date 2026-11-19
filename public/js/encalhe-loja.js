/**
 * Estoque encalhado · visão "🏬 Produto × loja".
 *
 * Cruza o estoque de cada produto em cada loja (detalhe do painel do SavWin:
 * peças, custo e última entrada) com as VENDAS DO BI do mesmo produto na mesma
 * loja nos últimos 3/6/12 meses (rota /consulta, mês a mês).
 *
 *  - Não vendeu naquela loja no período  -> ENCALHADO
 *  - Dias parado = desde a última venda naquela loja; se não vendeu, desde a última entrada
 *  - "Vende em outra loja" = o mesmo produto vendeu em outra loja no período (remanejar)
 *  - Entradas recentes (padrão: menos de 60 dias) podem ser ocultadas: ainda não deu tempo de vender.
 */

const pl = {
  dados: null,           // { quando, meses, linhas: [...], vendasPorCodigo: Map }
  carregando: false,
  soEncalhados: true,
  ocultarRecentes: true,
  diasRecente: 60,
  soRemanejar: false,
  vendasCache: {}        // janela+lojas -> linhas de venda resumidas
};

const plBr = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const plLojaCod = v => { const m = String(v ?? '').match(/^\s*0*(\d+)/); return m ? m[1] : ''; };

function plJanelas(meses) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const lista = [];
  for (let i = 0; i < meses; i++) {
    const fim = new Date(hoje); fim.setMonth(fim.getMonth() - i);
    const ini = new Date(hoje); ini.setMonth(ini.getMonth() - i - 1); ini.setDate(ini.getDate() + 1);
    lista.push({ ini, fim });
  }
  return lista;
}

/** Vendas do BI de uma janela, resumidas por produto e loja: [codigo, loja, qtd, data(ms)]. */
async function plVendasJanela(j, lojas) {
  const chave = `${plBr(j.ini)}_${plBr(j.fim)}_${lojas}`;
  if (pl.vendasCache[chave]) return pl.vendasCache[chave];
  const resp = await fetchAutenticado('/consulta', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ DATAINICIAL: plBr(j.ini), DATAFINAL: plBr(j.fim), LOJAS: lojas, TIPODATA: 'VENDA', TIPOVENDA: '' })
  });
  if (!resp.ok) {
    const c = await resp.json().catch(() => ({}));
    throw new Error(c.error || `Erro ${resp.status} ao buscar as vendas de ${plBr(j.ini)} a ${plBr(j.fim)}`);
  }
  const dados = await resp.json();
  const lista = Array.isArray(dados) ? dados : (dados && dados.dados) || [];
  const chaves = typeof chavesDosDados === 'function' ? chavesDosDados(lista) : Object.keys(lista[0] || {});
  const kCod = (typeof detectarCampo === 'function' && detectarCampo(chaves, 'codigo')) || 'CODIGO';
  const resumo = lista.map(it => {
    const d = typeof epData === 'function' ? epData(it.DATA) : null;
    return [epCodigo(it[kCod]), plLojaCod(it.LOJANOME ?? it.CODIGOLOJA ?? it.LOJA), parseNumeroBR(it.QUANTIDADE) || 0, d ? d.getTime() : 0];
  }).filter(x => x[0] && x[1]);
  pl.vendasCache[chave] = resumo;
  return resumo;
}

/**
 * Índice das vendas do BI por produto e loja nos últimos N meses:
 * Map(código -> Map(loja -> { q, ult })). Guardado por período e lojas; pedidos
 * simultâneos esperam a mesma busca. Usado aqui, no detalhe da grife e na exportação.
 */
const plIndices = {};   // chave -> { mapa } | { promessa }
function plIndicePronto(meses = ep.meses || 12) {
  const x = plIndices[`${meses}|${epLojasPedido()}`];
  return x && x.mapa ? x.mapa : null;
}
async function plVendasIndice(meses = ep.meses || 12, aoProgresso = null, cancelado = null) {
  const lojas = epLojasPedido();
  const chave = `${meses}|${lojas}`;
  const x = plIndices[chave];
  if (x && x.mapa) return x.mapa;
  if (x && x.promessa) return x.promessa;
  const promessa = (async () => {
    const janelas = plJanelas(meses);
    const vendas = new Map();
    let m = 0;
    if (aoProgresso) aoProgresso(0, janelas.length, vendas.size);
    for (const j of janelas) {
      if (cancelado) cancelado();
      (await plVendasJanela(j, lojas)).forEach(([cod, loja, q, t]) => {
        let porLoja = vendas.get(cod);
        if (!porLoja) { porLoja = new Map(); vendas.set(cod, porLoja); }
        const v = porLoja.get(loja) || { q: 0, ult: 0 };
        v.q += q; if (t > v.ult) v.ult = t;
        porLoja.set(loja, v);
      });
      if (aoProgresso) aoProgresso(++m, janelas.length, vendas.size);
    }
    plIndices[chave] = { mapa: vendas };
    return vendas;
  })();
  plIndices[chave] = { promessa };
  try { return await promessa; } catch (e) { delete plIndices[chave]; throw e; }
}

/** Última venda e quantidade de um produto: na loja (código) ou na rede (sem loja). */
function plVendaDe(codigo, lojaCod) {
  const mapa = plIndicePronto();
  if (!mapa) return undefined;                       // ainda não carregado
  const porLoja = mapa.get(epCodigo(codigo));
  if (!porLoja) return null;
  if (lojaCod) return porLoja.get(String(lojaCod)) || null;
  let q = 0, ult = 0;
  porLoja.forEach(v => { q += v.q; if (v.ult > ult) ult = v.ult; });
  return q || ult ? { q, ult } : null;
}

async function plMontar() {
  if (pl.carregando || !ep.dados) return;
  pl.carregando = true;
  const meses = ep.meses || 12;
  Object.assign(epExp, { inicio: Date.now(), cancelar: false, fase: 'Preparando', feito: 0, total: 0, grifes: '', produtos: 0, precos: '', formato: '', titulo: '🏬 Produto × loja · cruzando estoque com vendas' });
  epExpDesenhar();
  epExp.timer = setInterval(() => epExpDesenhar(), 1000);
  const cancelado = () => { if (epExp.cancelar) throw Object.assign(new Error('Análise cancelada.'), { cancelado: true }); };
  try {
    // 1) estoque por produto × loja: todas as grifes da lista atual (tipo e busca)
    const doTipo = epGrifesDoTipo();
    const grifes = (ep.dados.Cobertura || []).filter(g => !doTipo || doTipo.has(String(g.Chave)));
    let i = 0, feitas = 0, achados = 0;
    epExpFase('Lendo estoque de cada produto em cada loja', 0, grifes.length);
    await Promise.all(Array.from({ length: Math.min(5, grifes.length) }, async () => {
      while (i < grifes.length) {
        cancelado();
        const g = grifes[i++];
        const chave = String(g.Chave);
        if (!(ep.detalhes[chave] && ep.detalhes[chave].linhas)) {
          const r = await epPost('/savwin/estoque/detalhe', { CHAVE: chave, LOJAS: epLojasPedido(), MESES: ep.meses });
          if (r.status === 409) { ep.situacao = { conectado: false }; epDesenharConexao(); throw new Error(r.j.error || 'Conecte o SavWin de novo.'); }
          if (r.ok) ep.detalhes[chave] = Object.assign(ep.detalhes[chave] || { aberto: false, mostrar: 60 }, { linhas: r.j.linhas || [], limitado: r.j.limitado });
        }
        const det = ep.detalhes[chave];
        if (det && det.linhas) achados += det.linhas.length;
        epExp.grifes = `${feitas + 1} de ${grifes.length} grifes`;
        epExp.produtos = achados;
        epExpFase('Lendo estoque de cada produto em cada loja', ++feitas, grifes.length);
      }
    }));
    cancelado();

    // 2) vendas do BI, mês a mês
    const lojas = epLojasPedido();
    const vendas = await plVendasIndice(meses, (feito, total, n) => {
      epExp.precos = `${n.toLocaleString('pt-BR')} produtos com venda`;
      epExpFase(`Lendo as vendas do BI (${meses} meses)`, feito, total);
    }, cancelado);

    // 3) cruzamento produto × loja
    const linhas = [];
    grifes.forEach(g => {
      const det = ep.detalhes[String(g.Chave)];
      if (!det || !det.linhas) return;
      det.linhas.forEach(l => {
        const cod = epCodigo(l.codigo);
        const loja = plLojaCod(l.loja);
        const porLoja = vendas.get(cod) || new Map();
        const aqui = porLoja.get(loja) || null;
        const entrada = epData(l.data);
        const diasEntrada = entrada ? epDiasDesde(entrada) : null;
        const outras = [...porLoja.entries()].filter(([lj, v]) => lj !== loja && v.q > 0)
          .map(([lj, v]) => ({ loja: lj, q: v.q, ult: v.ult })).sort((a, b) => b.q - a.q);
        const diasVenda = aqui && aqui.ult ? epDiasDesde(new Date(aqui.ult)) : null;
        linhas.push({
          grife: g.Descricao, produto: l.produto, codigo: l.codigo, tipo: l.tipo, loja: l.loja, lojaCod: loja,
          pecas: l.pecas, custo: l.custo, custoUn: l.custoUnit || (l.pecas ? l.custo / l.pecas : 0), entrada, diasEntrada,
          vendidas: aqui ? aqui.q : 0, ultVenda: aqui && aqui.ult ? new Date(aqui.ult) : null, diasVenda,
          encalhado: !aqui || aqui.q <= 0,
          diasParado: aqui && aqui.ult ? diasVenda : diasEntrada,
          outras
        });
      });
    });
    pl.dados = { quando: new Date().toISOString(), meses, linhas, lojasVenda: lojas };
    clearInterval(epExp.timer);
    const enc = linhas.filter(x => x.encalhado);
    epExpDesenhar('ok', `✅ Pronto: <b>${enc.length.toLocaleString('pt-BR')}</b> produtos × loja sem venda em ${meses} meses (de ${linhas.length.toLocaleString('pt-BR')}).`);
    setTimeout(() => { const el = document.getElementById('epExpPainel'); if (el && !pl.carregando) el.style.display = 'none'; }, 8000);
  } catch (e) {
    clearInterval(epExp.timer);
    epExpDesenhar(e.cancelado ? 'cancelado' : 'erro', e.cancelado ? '⏹ Análise cancelada.' : `⚠️ ${escHTML(e.message)}`);
  } finally {
    clearInterval(epExp.timer);
    pl.carregando = false;
    epRenderizarTabela();
  }
}

function plFiltro(campo, valor) { pl[campo] = valor; ep.mostrar = 100; epRenderizarTabela(); }

function plRenderizar(alvo) {
  const custoOk = ep.dados.CustoLiberado !== false;
  if (!pl.dados || pl.dados.meses !== ep.meses) {
    const nGrifes = (ep.dados.Cobertura || []).filter(g => { const t = epGrifesDoTipo(); return !t || t.has(String(g.Chave)); }).length;
    alvo.innerHTML = `<div class="pl-intro">
      <h4>🏬 Encalhado por produto em cada loja</h4>
      <p>Cruza o estoque de cada produto em cada loja com as <b>vendas do BI</b> do mesmo produto na mesma loja nos últimos <b>${ep.meses} meses</b>.
        Produto em estoque que <b>não aparece nas vendas daquela loja</b> no período é <b>encalhado</b>, mesmo que a grife venda bem.
        Mostra também quando ele <b>vende em outra loja</b> (dá para remanejar).</p>
      <p class="lf-ajuda">Vai ler ${nGrifes} grifes (${escHTML(TIPOS_EP[ep.tipo] || 'todos os tipos')}) e ${ep.meses} meses de vendas: de 1 a 3 minutos na primeira vez. Para mudar o período, use "Giro dos últimos".</p>
      ${pl.dados ? `<p class="lf-ajuda">A última análise foi de ${pl.dados.meses} meses; monte de novo para ${ep.meses} meses.</p>` : ''}
      <button type="button" class="btn-comparar-lojas" onclick="plMontar()" ${pl.carregando ? 'disabled' : ''}>${pl.carregando ? '⏳ Montando…' : '▶ Montar análise produto × loja'}</button>
    </div>`;
    ep.ultimaTabela = null;
    return;
  }

  const busca = ep.busca.trim().toUpperCase();
  const doTipo = epGrifesDoTipo();
  const tiposGrife = doTipo ? new Set((ep.dados.Cobertura || []).filter(g => doTipo.has(String(g.Chave))).map(g => g.Descricao)) : null;
  const base = pl.dados.linhas.filter(x =>
    (!tiposGrife || tiposGrife.has(x.grife)) && (!ep.loja || x.lojaCod === ep.loja) &&
    (!busca || `${x.grife} ${x.produto} ${x.loja}`.toUpperCase().includes(busca)));
  const recente = x => x.encalhado && x.diasEntrada !== null && x.diasEntrada < pl.diasRecente;
  let lista = base.filter(x => (!pl.soEncalhados || x.encalhado) && !(pl.ocultarRecentes && recente(x)) && (!pl.soRemanejar || (x.encalhado && x.outras.length)));
  const { campo, desc } = ep.ordem;
  const val = x => campo === 'diasParado' ? (x.diasParado ?? 1e6) : campo === 'outras' ? x.outras.length : x[campo];
  lista.sort((a, b) => { const A = val(a), B = val(b); const r = typeof A === 'string' ? String(A).localeCompare(String(B), 'pt-BR') : (A || 0) - (B || 0); return desc ? -r : r; });

  const enc = base.filter(x => x.encalhado && !(pl.ocultarRecentes && recente(x)));
  const soma = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const remanejar = enc.filter(x => x.outras.length);
  const pecasTot = soma(base, x => x.pecas), custoTot = soma(base, x => x.custo);
  const vis = lista.slice(0, ep.mostrar);
  const th = (c, r, cls = 'num') => `<th class="${cls} ee-ordenavel" onclick="epOrdenar('${c}')">${r}${ep.ordem.campo === c ? (ep.ordem.desc ? ' ▼' : ' ▲') : ''}</th>`;
  const quando = new Date(pl.dados.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  alvo.innerHTML = `
    <div class="pl-resumo">
      <div class="pl-num enc"><span>Encalhados (sem venda na loja em ${pl.dados.meses} m)</span><b>${epPc(soma(enc, x => x.pecas))} pç</b>${custoOk ? `<small>${epR(soma(enc, x => x.custo))} · ${custoTot ? (soma(enc, x => x.custo) / custoTot * 100).toFixed(0) : 0}% do custo</small>` : ''}</div>
      <div class="pl-num rem"><span>Vendem em outra loja (remanejar)</span><b>${epPc(soma(remanejar, x => x.pecas))} pç</b>${custoOk ? `<small>${epR(soma(remanejar, x => x.custo))} · ${remanejar.length} produtos × loja</small>` : ''}</div>
      <div class="pl-num"><span>Estoque analisado</span><b>${epPc(pecasTot)} pç</b>${custoOk ? `<small>${epR(custoTot)}</small>` : ''}</div>
    </div>
    <div class="pl-filtros">
      <label><input type="checkbox" ${pl.soEncalhados ? 'checked' : ''} onchange="plFiltro('soEncalhados', this.checked)"> Só encalhados</label>
      <label><input type="checkbox" ${pl.ocultarRecentes ? 'checked' : ''} onchange="plFiltro('ocultarRecentes', this.checked)"> Ocultar entradas com menos de
        <input type="number" min="0" max="365" value="${pl.diasRecente}" onchange="plFiltro('diasRecente', Number(this.value) || 0)"> dias</label>
      <label><input type="checkbox" ${pl.soRemanejar ? 'checked' : ''} onchange="plFiltro('soRemanejar', this.checked)"> Só os que vendem em outra loja</label>
      <span class="lf-ajuda">Vendas do BI de ${pl.dados.meses} meses · análise de ${quando} · <button type="button" class="tv-link" onclick="plMontar()">↻ refazer</button></span>
    </div>
    <div class="ee-tabela-rolagem"><table class="la-tabela ee-tabela pl-tabela">
      <thead><tr>${th('produto', 'Produto', 'ee-nome')}${th('loja', 'Loja', '')}${th('pecas', 'Peças')}${custoOk ? th('custo', 'Custo') : ''}
        ${th('diasEntrada', 'Última entrada')}${th('vendidas', `Vendidas (${pl.dados.meses} m)`)}${th('diasParado', 'Parado há')}${th('outras', 'Vende em outra loja', '')}</tr></thead>
      <tbody>${vis.map(x => `<tr class="${x.encalhado ? 'pl-enc' : ''}">
        <td class="ee-nome">${escHTML(x.produto)}<small>${escHTML(x.grife)}${x.codigo ? ' · cód. ' + escHTML(x.codigo) : ''}</small></td>
        <td>${escHTML(epLojaCurta(x.loja))}</td>
        <td class="num">${epPc(x.pecas)}</td>${custoOk ? `<td class="num">${epR(x.custo)}</td>` : ''}
        <td class="num">${x.entrada ? x.entrada.toLocaleDateString('pt-BR') + `<small>${x.diasEntrada} d</small>` : '—'}</td>
        <td class="num">${x.vendidas ? `${epPc(x.vendidas)}<small>últ. ${x.ultVenda.toLocaleDateString('pt-BR')}</small>` : '<span class="ee-enc">nenhuma</span>'}</td>
        <td class="num">${x.diasParado !== null ? `<b class="${x.diasParado > 365 ? 'ee-enc' : ''}">${x.diasParado} d</b><small>${x.vendidas ? 'desde a venda' : 'desde a entrada'}</small>` : '—'}</td>
        <td class="ee-lojas">${x.outras.length ? x.outras.slice(0, 3).map(o => `<span class="ee-chip ee-chip-vende" title="vendeu ${epPc(o.q)} em ${pl.dados.meses} meses">${escHTML(epNomeLoja(o.loja))} · ${epPc(o.q)}</span>`).join('') + (x.outras.length > 3 ? `<small>+${x.outras.length - 3}</small>` : '') : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${lista.length > vis.length ? `<button type="button" class="tv-link" onclick="ep.mostrar += 100; epRenderizarTabela()">Mostrar mais (${lista.length - vis.length} restantes)</button>` : ''}`;

  ep.ultimaTabela = {
    nome: 'encalhado_produto_por_loja',
    cab: ['Grife', 'Produto', 'Código', 'Tipo', 'Loja', 'Peças', ...(custoOk ? ['Custo unitário', 'Custo total'] : []), 'Última entrada', 'Dias desde a entrada',
      `Vendidas na loja (${pl.dados.meses} meses)`, 'Última venda na loja', 'Dias parado', 'Encalhado', 'Vende em outras lojas'],
    linhas: lista.map(x => [x.grife, x.produto, x.codigo, x.tipo, epLojaCurta(x.loja), x.pecas, ...(custoOk ? [Math.round(x.custoUn * 100) / 100, Math.round(x.custo * 100) / 100] : []),
      x.entrada ? x.entrada.toLocaleDateString('pt-BR') : '', x.diasEntrada ?? '', x.vendidas || 0, x.ultVenda ? x.ultVenda.toLocaleDateString('pt-BR') : '',
      x.diasParado ?? '', x.encalhado ? 'sim' : 'não', x.outras.map(o => `${epNomeLoja(o.loja)} (${o.q})`).join(' | ')])
  };
}
