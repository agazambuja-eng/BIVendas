/**
 * Estoque encalhado · "🤖 Analisar com IA" (em lote).
 *
 * Pega as grifes da lista atual (tipo, busca e, se quiser, só as paradas), lê os
 * produtos e as lojas de cada uma, agrupa por MODELO (cores do mesmo modelo dividem
 * uma pesquisa só), escolhe os modelos de maior custo parado até o limite escolhido
 * e pesquisa cada um com a IA (rota /precos/pesquisar, 2 por vez). Monta uma tela
 * única com quantidade por loja, mercado, nível de preço e sugestão, exportável
 * para Excel. Pesquisas repetidas em 24 h saem do cache do servidor (sem custo).
 */

const ai = { rodando: false, cancelar: false, linhas: [], lojas: [], resumo: null, quando: '', regiao: '', erroGeral: '' };
const LIMITES_AI = [10, 20, 30, 50, 100];

function aiModal() {
  let m = document.getElementById('modalAnaliseIA');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'modalAnaliseIA';
  m.className = 'pw-fundo';
  m.innerHTML = `<div class="pw-janela ai-janela" role="dialog" aria-modal="true" aria-labelledby="aiTitulo">
      <div class="pw-cab"><div><h3 id="aiTitulo">🤖 Análise de preços com IA</h3><div class="pw-sub">Grifes do Estoque encalhado · por modelo · quantidade por loja · nível de preço e sugestão</div></div>
        <button type="button" class="pw-fechar" onclick="fecharAnaliseIA()" title="Fechar (Esc)">✕</button></div>
      <div id="aiCorpo" class="pw-corpo"></div>
    </div>`;
  document.body.appendChild(m);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.style.display === 'flex' && !ai.rodando) fecharAnaliseIA(); });
  return m;
}
function fecharAnaliseIA() {
  if (ai.rodando && !confirm('A análise ainda está rodando. Parar e fechar?')) return;
  ai.cancelar = true;
  const m = document.getElementById('modalAnaliseIA');
  if (m) m.style.display = 'none';
}

/** Grifes no escopo: as da lista atual (tipo e busca), opcionalmente só as paradas, do maior custo para o menor. */
function aiGrifesEscopo(soParadas) {
  if (!ep.dados) return [];
  const doTipo = typeof epGrifesDoTipo === 'function' ? epGrifesDoTipo() : null;
  const busca = String(ep.busca || '').trim().toUpperCase();
  return (ep.dados.Cobertura || [])
    .filter(g => (!doTipo || doTipo.has(String(g.Chave))) && (!busca || String(g.Descricao || '').toUpperCase().includes(busca)))
    .filter(g => !soParadas || !g.UltimaVenda || g.DiasSemVender >= 180)
    .sort((a, b) => b.Custo - a.Custo);
}

function abrirAnaliseIA() {
  if (!ep.dados) { alert('Carregue o estoque primeiro.'); return; }
  const m = aiModal();
  m.style.display = 'flex';
  if (!ai.rodando) aiDesenharConfig();
}

function aiDesenharConfig() {
  const soParadas = ai.cfgSoParadas !== false;
  const grifes = aiGrifesEscopo(soParadas);
  const limite = ai.cfgLimite || 20;
  const regiao = ai.cfgRegiao !== undefined ? ai.cfgRegiao : (pw.regiao || '');
  const opRegiao = [...REGIOES_PW, ...(pw.regioesExtra || []).filter(r => !REGIOES_PW.some(x => x[0] === r)).map(r => [r, r])].map(([v, t]) => `<option value="${escHTML(v)}" ${v === regiao ? 'selected' : ''}>${escHTML(t)}</option>`).join('');
  document.getElementById('aiCorpo').innerHTML = `
    <div class="ai-config">
      <div class="ai-escopo">
        <b>${grifes.length}</b> grifes no escopo · ${escHTML(TIPOS_EP[ep.tipo] || 'Todos os tipos')}${ep.busca ? ` · busca "${escHTML(ep.busca)}"` : ''} · ${ep.loja ? escHTML(epNomeLoja(ep.loja)) : 'todas as suas lojas'}
        <small>Muda o tipo, a loja ou a busca na tela do estoque para mudar o escopo.</small>
      </div>
      <label class="ai-op"><input type="checkbox" id="aiSoParadas" ${soParadas ? 'checked' : ''} onchange="ai.cfgSoParadas = this.checked; aiDesenharConfig()"> Só grifes paradas (sem venda ou sem vender há 180 dias ou mais)</label>
      <div class="ai-linha">
        <label>Analisar até <select id="aiLimite" onchange="ai.cfgLimite = Number(this.value); aiDesenharConfig()">${LIMITES_AI.map(n => `<option value="${n}" ${n === limite ? 'selected' : ''}>${n} modelos</option>`).join('')}</select></label>
        <label>📍 Região <select id="aiRegiao" onchange="ai.cfgRegiao = this.value">${opRegiao}</select></label>
        <label>Onde pesquisar <select id="aiAlcance" onchange="ai.cfgAlcance = this.value">${ALCANCES_PW.map(([v, t]) => `<option value="${v}" ${v === (ai.cfgAlcance || pw.alcance || 'todas') ? 'selected' : ''}>${t.replace(/^\S+\s/, '')}</option>`).join('')}</select></label>
      </div>
      <label class="ai-op"><input type="checkbox" id="aiRedes" ${(ai.cfgRedes ?? pw.redes) ? 'checked' : ''} onchange="ai.cfgRedes = this.checked"> 📱 Incluir publicações do Instagram, Facebook e TikTok</label>
      <p class="lf-ajuda">Escolhe os modelos de <b>maior custo parado</b>. Cores do mesmo modelo dividem uma pesquisa.
        Leva cerca de <b>${Math.max(1, Math.round(limite * 25 / 2 / 60))} min</b> (2 pesquisas por vez) e usa até <b>${limite}</b> pesquisas da IA no mês
        (o que já foi pesquisado nas últimas 24 h não conta). Pode parar quando quiser e exportar o que já veio.</p>
      <div class="ai-botoes">
        <button type="button" class="btn-comparar-lojas" onclick="aiIniciar()" ${grifes.length ? '' : 'disabled'}>▶ Iniciar análise</button>
        ${ai.linhas.length ? `<button type="button" class="tv-link" onclick="aiDesenharResultado()">ver a última análise (${ai.linhas.length} produtos)</button>` : ''}
      </div>
    </div>`;
}

async function aiEmParalelo(itens, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length && !ai.cancelar) { const k = i++; await fn(itens[k], k); }
  }));
}

function aiProgresso(fase, feito, total, extra = '') {
  const el = document.getElementById('aiProgresso');
  if (!el) return;
  const pct = total ? Math.round(feito / total * 100) : 0;
  el.innerHTML = `<div class="ee-progresso-topo"><span>⏳ ${fase} ${total ? `· ${feito} de ${total}` : ''}</span><span>${pct}%</span></div>
    <div class="ee-progresso"><i style="width:${pct}%"></i></div>${extra ? `<small class="ai-extra">${extra}</small>` : ''}`;
}

async function aiIniciar() {
  if (ai.rodando) return;
  const soParadas = document.getElementById('aiSoParadas').checked;
  const limite = Number(document.getElementById('aiLimite').value) || 20;
  const regiao = document.getElementById('aiRegiao').value;
  const alcance = document.getElementById('aiAlcance').value;
  const redes = document.getElementById('aiRedes').checked;
  Object.assign(ai, { rodando: true, cancelar: false, linhas: [], lojas: [], erroGeral: '', regiao, alcance, redes, quando: new Date().toISOString(), cfgSoParadas: soParadas, cfgLimite: limite, cfgRegiao: regiao, cfgAlcance: alcance, cfgRedes: redes });
  document.getElementById('aiCorpo').innerHTML = `
    <div class="ai-barra"><div id="aiProgresso" class="ee-status"></div>
      <button type="button" class="tv-link" onclick="ai.cancelar = true; this.textContent = 'Parando…'">⏹ Parar</button></div>
    <div id="aiTabela"></div>`;
  try {
    // 1) produtos e lojas de cada grife (para quando já houver modelos suficientes)
    const grifes = aiGrifesEscopo(soParadas).slice(0, 80);
    const modelos = new Map();
    let lidas = 0;
    const lerGrife = async g => {
      if (ai.cancelar || modelos.size >= limite * 2) return;
      const chave = String(g.Chave);
      let det = ep.detalhes[chave];
      if (!det || !det.linhas) {
        const r = await epPost('/savwin/estoque/detalhe', { CHAVE: chave, LOJAS: epLojasPedido(), MESES: ep.meses });
        if (r.status === 409) { ai.cancelar = true; throw new Error(r.j.error || 'Conecte o SavWin de novo.'); }
        if (!r.ok) return;
        det = ep.detalhes[chave] = Object.assign(det || { aberto: false, mostrar: 60 }, { linhas: r.j.linhas || [], limitado: r.j.limitado });
      }
      epProdutosDaGrife(det).forEach(p => {
        const desc = termoBuscaProduto({ descricao: p.produto, grife: g.Descricao });
        const k = termoPrecoProduto(desc);
        let m = modelos.get(k);
        if (!m) { m = { termo: k, grife: g, produtos: [], custo: 0 }; modelos.set(k, m); }
        m.produtos.push({ ...p, desc });
        m.custo += p.custo;
      });
      aiProgresso('Lendo produtos e lojas das grifes', ++lidas, grifes.length, `${modelos.size} modelos encontrados`);
    };
    aiProgresso('Lendo produtos e lojas das grifes', 0, grifes.length);
    await aiEmParalelo(grifes, 3, lerGrife);
    const escolhidos = [...modelos.values()].sort((a, b) => b.custo - a.custo).slice(0, limite);
    if (!escolhidos.length) throw new Error('Nenhum produto encontrado nas grifes do escopo.');

    // 2) preço de venda (cadastro do SavWin)
    aiProgresso('Buscando preço de venda no SavWin', 0, 1);
    const codigos = [...new Set(escolhidos.flatMap(m => m.produtos.map(p => epCodigo(p.codigo))).filter(c => c && !(c in ep.precos)))];
    for (let i = 0; i < codigos.length && !ai.cancelar; i += 80) {
      const lote = codigos.slice(i, i + 80);
      const r = await epPost('/savwin/precos', { CODIGOS: lote });
      if (r.ok) lote.forEach(c => { ep.precos[c] = r.j.precos[c] || null; });
    }

    // 3) IA, 2 modelos por vez
    let feitos = 0;
    aiProgresso('Pesquisando preços com IA', 0, escolhidos.length);
    await aiEmParalelo(escolhidos, 2, async m => {
      const rep = m.produtos.slice().sort((a, b) => b.custo - a.custo)[0];
      const chaves = pwChavesDoProduto(rep.desc);
      const pr = ep.precos[epCodigo(rep.codigo)] || {};
      let ofertas = [], erro = '';
      try {
        const resp = await fetchAutenticado('/precos/pesquisar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: rep.desc, termo: m.termo, modelo: chaves.modelo, cor: chaves.cor, tamanho: chaves.tamanho, regiao, corNome: pr.cor || '', modeloSavwin: pr.modelo || '', alcance, redes })
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          erro = j.error || `Erro ${resp.status}`;
          if (resp.status === 429 || resp.status === 503) { ai.cancelar = true; ai.erroGeral = erro; }
        } else ofertas = j.ofertas || [];
      } catch (e) { erro = e.message; }
      aiAdicionarModelo(m, chaves, ofertas, erro);
      aiProgresso('Pesquisando preços com IA', ++feitos, escolhidos.length, ai.erroGeral ? '⚠️ ' + escHTML(ai.erroGeral) : '');
      aiDesenharTabela();
    });
  } catch (e) {
    ai.erroGeral = e.message;
  } finally {
    ai.rodando = false;
    aiDesenharResultado();
  }
}

function aiAdicionarModelo(m, chaves, ofertas, erro) {
  const validas = pwOfertasDoModelo(pwFiltrarAlcance(ofertas, ai.alcance, ai.regiao).dentro, chaves);
  const precos = validas.map(o => o.preco);
  const mediana = pwMediana(precos);
  const g = m.grife;
  const parado = g.UltimaVenda ? g.DiasSemVender : -1;
  // lojas das ofertas (mais baratas primeiro), com link; sem link -> pesquisa da loja no Google
  const lojasOfertas = validas.slice(0, 10).map(o => ({
    loja: o.loja || 'loja não informada', local: o.local && !/^online$/i.test(o.local) ? o.local : '', tipo: o.tipo || '',
    preco: o.preco, url: o.url || `https://www.google.com/search?q=${encodeURIComponent(`${o.loja || ''} ${m.termo}`.trim())}`, linkDireto: !!o.url
  }));
  m.produtos.forEach(p => {
    const pr = ep.precos[epCodigo(p.codigo)] || null;
    const custoUn = p.pecas ? p.custo / p.pecas : 0;
    const nosso = pr ? (pr.promocao > 0 ? pr.promocao : pr.venda) : 0;
    const contexto = { diasEntrada: p.entrada ? epDiasDesde(p.entrada) : null, parado };
    const sug = precos.length ? pwCalcularSugestao({ precos, mediana, nosso, custo: custoUn, contexto }) : null;
    const lojas = p.lojas.map(l => ({ loja: String(l.loja), pecas: l.pecas }));
    lojas.forEach(l => { if (!ai.lojas.includes(l.loja)) ai.lojas.push(l.loja); });
    ai.linhas.push({
      grife: g.Descricao, produto: p.produto, codigo: p.codigo, desc: p.desc, termo: m.termo, chaves,
      lojas, pecas: p.pecas, custoUn, custo: p.custo, venda: pr ? pr.venda : 0, promocao: pr ? pr.promocao : 0, nosso,
      ofertas: precos.length, menor: precos[0] || 0, mediana, maior: precos[precos.length - 1] || 0,
      sug, contexto, erro, corNome: pr ? pr.cor : '', modeloSavwin: pr ? pr.modelo : '', lojasOfertas
    });
  });
}

const AI_ORDEM_NIVEL = { 'n-alto': 0, 'n-acima': 1, 'n-ok': 2, 'n-baixo': 3 };
function aiOrdenadas() {
  return ai.linhas.slice().sort((a, b) =>
    ((a.sug && a.sug.nivel ? AI_ORDEM_NIVEL[a.sug.nivel.cls] : 9) - (b.sug && b.sug.nivel ? AI_ORDEM_NIVEL[b.sug.nivel.cls] : 9)) || b.custo - a.custo);
}
const aiLojaCurta = l => String(l).replace(/\s*-\s*OTIC\w*\s*(VIA\s+VISAO\s*-\s*)?/i, ' ').replace(/\bMACEIO\s*-\s*/i, '').replace(/\s+/g, ' ').trim();

/** As 3 ofertas mais baratas: loja (com link), cidade/bairro e preço. */
function aiLinksLojas(l) {
  const of = (l.lojasOfertas || []).slice(0, 3);
  if (!of.length) return '';
  return `<div class="ai-lojas-of">${of.map(o => `<a href="${escHTML(o.url)}" target="_blank" rel="noopener noreferrer"
      title="${escHTML(o.loja)}${o.local ? ' · ' + escHTML(o.local) : ''}${o.linkDireto ? '' : ' (sem link da oferta: abre a pesquisa da loja)'}">
      ${o.tipo === 'loja física' ? '📍' : '🌐'} ${escHTML(o.loja)}${o.local ? ` <em>${escHTML(o.local)}</em>` : ''} <b>${epR(o.preco)}</b> ↗</a>`).join('')}
    ${l.lojasOfertas.length > 3 ? `<span class="ai-mais-of">+${l.lojasOfertas.length - 3} na 🔍</span>` : ''}</div>`;
}

function aiDesenharTabela() {
  const alvo = document.getElementById('aiTabela');
  if (!alvo) return;
  const linhas = aiOrdenadas();
  const conta = c => linhas.filter(l => l.sug && l.sug.nivel && l.sug.nivel.cls === c).length;
  const recDe = l => l.sug ? (l.sug.opcoes.find(o => o.id === l.sug.rec) || null) : null;
  alvo.innerHTML = `
    <div class="ai-resumo">
      <span><b>${new Set(linhas.map(l => l.termo)).size}</b> modelos · <b>${linhas.length}</b> produtos</span>
      <span class="ai-n n-alto">🔴 ${conta('n-alto')} acima de todas</span><span class="ai-n n-acima">🟠 ${conta('n-acima')} acima da mediana</span>
      <span class="ai-n n-ok">🟢 ${conta('n-ok')} na média</span><span class="ai-n n-baixo">🔵 ${conta('n-baixo')} abaixo</span>
      <span>⚪ ${linhas.filter(l => !l.ofertas).length} sem ofertas</span>
    </div>
    <div class="ee-tabela-rolagem ai-rolagem"><table class="la-tabela ee-tabela ai-tabela">
      <thead><tr><th class="ee-nome">Produto</th><th>Lojas · peças</th><th class="num">Custo<br>un.</th><th class="num">Nosso<br>preço</th>
        <th class="num">Mercado</th><th>Nível</th><th class="num">Sugestão ⭐</th><th class="num">Markup<br>margem</th><th class="num">Parado</th><th></th></tr></thead>
      <tbody>${linhas.map((l, i) => {
        const r = recDe(l);
        return `<tr>
          <td class="ee-nome">${escHTML(l.produto)}<small>${escHTML(l.grife)}${l.codigo ? ' · cód. ' + escHTML(l.codigo) : ''}</small></td>
          <td class="ee-lojas">${l.lojas.map(x => `<span class="ee-chip ee-chip-parado" title="${escHTML(x.loja)}">${escHTML(aiLojaCurta(x.loja))} · ${epPc(x.pecas)}</span>`).join('')}</td>
          <td class="num">${epR(l.custoUn)}</td>
          <td class="num">${l.nosso ? epR(l.nosso) + (l.promocao > 0 ? '<small>promo</small>' : '') : '—'}</td>
          <td class="num">${l.erro ? `<span class="ee-enc" title="${escHTML(l.erro)}">erro</span>` : l.ofertas ? `<b>${epR(l.mediana)}</b><small>${l.ofertas} ofertas · ${epR(l.menor)} a ${epR(l.maior)}</small>${aiLinksLojas(l)}` : '<span class="ee-sem-giro">sem ofertas</span>'}</td>
          <td>${l.sug && l.sug.nivel ? `<span class="ai-nivel ${l.sug.nivel.cls}" title="${escHTML(l.sug.nivel.txt)}">${escHTML(l.sug.nivel.txt.split(' ')[0] + ' ' + l.sug.nivel.curto)}</span><small class="ai-pos">${l.sug.nivel.pos}% mais baratas</small>` : '—'}</td>
          <td class="num">${r ? `<b class="ai-sug">${epR(r.preco)}</b><small>${escHTML(r.rot)}${r.desconto !== null ? ` · −${Math.max(0, r.desconto).toFixed(0)}%` : ''}</small>` : l.sug ? '<small class="ai-okpreco">preço ok</small>' : '—'}</td>
          <td class="num">${r && r.markup ? `${r.markup.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×<small>${r.margem.toFixed(0)}%</small>` : '—'}</td>
          <td class="num">${l.contexto.diasEntrada != null ? l.contexto.diasEntrada + ' d' : '—'}<small>${l.contexto.parado === -1 ? 'grife sem venda' : l.contexto.parado != null ? 'grife: ' + l.contexto.parado + ' d' : ''}</small></td>
          <td><button type="button" class="link-preco link-preco-web" title="Ver as ofertas (do cache, sem nova pesquisa)" onclick="aiVerOfertas(${ai.linhas.indexOf(l)})">🔍</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function aiDesenharResultado() {
  const corpo = document.getElementById('aiCorpo');
  if (!corpo) return;
  const quando = ai.quando ? new Date(ai.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  corpo.innerHTML = `
    <div class="ai-barra">
      <div class="ai-info">${ai.cancelar && !ai.erroGeral ? '⏹ Análise interrompida · ' : ''}${ai.erroGeral ? `⚠️ ${escHTML(ai.erroGeral)} · ` : ''}Análise de ${quando}${ai.regiao ? ' · região ' + escHTML(pwRotuloRegiao(ai.regiao)) : ' · Brasil'} · ${{ todas: 'lojas físicas e internet', fisicas: 'só lojas físicas', internet: 'só internet' }[ai.alcance || 'todas']}${ai.redes ? ' + redes sociais' : ''}</div>
      <div class="ai-botoes">
        <button type="button" class="btn-comparar-lojas" onclick="aiExportarExcel()" ${ai.linhas.length ? '' : 'disabled'}>⬇ Excel</button>
        <button type="button" class="tv-link" onclick="aiExportarCSV()" ${ai.linhas.length ? '' : 'disabled'}>⬇ CSV</button>
        <button type="button" class="tv-link" onclick="aiDesenharConfig()">↻ Nova análise</button>
      </div>
    </div>
    <div id="aiTabela"></div>`;
  aiDesenharTabela();
}

/** Abre o modal de ofertas do produto (o servidor responde do cache de 24 h). */
function aiVerOfertas(i) {
  const l = ai.linhas[i];
  if (!l) return;
  const el = document.createElement('button');
  Object.assign(el.dataset, {
    termo: l.desc, ref: l.nosso ? l.nosso.toFixed(2) : '', refRotulo: l.promocao > 0 ? 'Nossa promoção' : 'Nosso preço de venda',
    ref2: l.custoUn ? l.custoUn.toFixed(2) : '', ref2Rotulo: 'Nosso custo', corNome: l.corNome || '', modeloSavwin: l.modeloSavwin || '',
    diasEntrada: l.contexto.diasEntrada != null ? l.contexto.diasEntrada : '', parado: l.contexto.parado != null ? l.contexto.parado : ''
  });
  pw.regiao = ai.regiao;
  if (ai.alcance) pw.alcance = ai.alcance;      // mesmo alcance do lote (aproveita o cache)
  if (ai.redes !== undefined) pw.redes = !!ai.redes;
  abrirPesquisaPreco(el);
}

// ---------------------------------------------------------------- exportar
function aiTabelaExport() {
  const lojas = ai.lojas.slice().sort();
  const cab = ['Grife', 'Produto', 'Código', 'Peças', ...lojas.map(aiLojaCurta), 'Custo unitário', 'Preço de venda', 'Promoção',
    'Ofertas', 'Menor', 'Mediana', 'Maior', 'Nível', '% ofertas mais baratas', 'Recomendação', 'Preço sugerido', 'Desconto %', 'Markup sugerido', 'Margem %',
    'Alinhar ao mercado', 'Girar rápido', 'Piso de margem', 'Dias desde última entrada', 'Grife: dias sem vender', 'Observação',
    ...[1, 2, 3].flatMap(i => [`Oferta ${i}: loja`, `Oferta ${i}: local`, `Oferta ${i}: preço`, `Oferta ${i}: link`])];
  const n = v => (v === null || v === undefined || v === '' || !isFinite(v)) ? '' : Math.round(v * 100) / 100;
  const linhas = aiOrdenadas().map(l => {
    const s = l.sug || {};
    const op = id => ((s.opcoes || []).find(o => o.id === id) || {}).preco;
    const r = (s.opcoes || []).find(o => o.id === s.rec) || null;
    const porLoja = Object.fromEntries(l.lojas.map(x => [x.loja, x.pecas]));
    return [l.grife, l.produto, l.codigo, n(l.pecas), ...lojas.map(lj => porLoja[lj] ? n(porLoja[lj]) : ''), n(l.custoUn), n(l.venda), n(l.promocao),
      l.ofertas, n(l.menor), n(l.mediana), n(l.maior), s.nivel ? s.nivel.curto : '', s.nivel ? s.nivel.pos : '',
      r ? r.rot : (s.nivel ? 'Preço ok' : ''), r ? n(r.preco) : '', r && r.desconto !== null ? n(r.desconto) : '', r && r.markup ? n(r.markup) : '', r && r.margem !== null ? n(r.margem) : '',
      n(op('mediana')), n(op('girar')), n(op('piso')),
      l.contexto.diasEntrada != null ? l.contexto.diasEntrada : '', l.contexto.parado === -1 ? 'sem venda' : (l.contexto.parado != null ? l.contexto.parado : ''),
      l.erro || (s.texto || ''),
      ...[0, 1, 2].flatMap(i => { const o = (l.lojasOfertas || [])[i]; return o ? [o.loja, o.local || (o.tipo === 'online' ? 'online' : ''), n(o.preco), o.url] : ['', '', '', '']; })];
  });
  return { cab, linhas };
}

function aiNomeArquivo(ext) { return `analise_precos_ia_${new Date().toISOString().slice(0, 10)}.${ext}`; }

function aiExportarCSV() {
  const { cab, linhas } = aiTabelaExport();
  const cel = v => typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cab.map(cel).join(';'), ...linhas.map(l => l.map(cel).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = aiNomeArquivo('csv');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function aiCarregarXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => window.XLSX ? ok(window.XLSX) : falha(new Error('Biblioteca do Excel não carregou.'));
    s.onerror = () => falha(new Error('Não foi possível carregar a biblioteca do Excel.'));
    document.head.appendChild(s);
  });
}

async function aiExportarExcel() {
  let XLSX;
  try { XLSX = await aiCarregarXLSX(); } catch (e) { alert(e.message + ' Vou baixar em CSV (abre no Excel).'); return aiExportarCSV(); }
  const { cab, linhas } = aiTabelaExport();
  const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
  // colunas de link viram hiperlink clicável no Excel
  cab.forEach((c, ci) => {
    if (!/: link$/.test(c)) return;
    for (let r = 1; r <= linhas.length; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: ci });
      const cel = ws[ref];
      if (cel && typeof cel.v === 'string' && /^https?:/.test(cel.v)) { cel.l = { Target: cel.v, Tooltip: 'Abrir a oferta' }; cel.v = 'abrir ↗'; }
    }
  });
  ws['!cols'] = cab.map((c, i) => ({ wch: i === 1 ? 38 : i === 0 ? 18 : c.length > 14 ? 16 : 11 }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhas.length, c: cab.length - 1 } }) };
  ws['!freeze'] = { xSplit: 2, ySplit: 1 };
  // formato de moeda nas colunas de preço
  const moeda = new Set(['Custo unitário', 'Preço de venda', 'Promoção', 'Menor', 'Mediana', 'Maior', 'Preço sugerido', 'Alinhar ao mercado', 'Girar rápido', 'Piso de margem', 'Oferta 1: preço', 'Oferta 2: preço', 'Oferta 3: preço']);
  cab.forEach((c, ci) => {
    if (!moeda.has(c)) return;
    for (let r = 1; r <= linhas.length; r++) {
      const cel = ws[XLSX.utils.encode_cell({ r, c: ci })];
      if (cel && typeof cel.v === 'number') cel.z = '"R$" #,##0.00';
    }
  });
  const info = XLSX.utils.aoa_to_sheet([
    ['Análise de preços com IA · BI Vendas'],
    ['Data', new Date(ai.quando).toLocaleString('pt-BR')],
    ['Região', ai.regiao ? pwRotuloRegiao(ai.regiao) : 'Brasil'],
    ['Markup mínimo usado no piso', pwMarkupMinimo()],
    ['Fonte', 'Ofertas pesquisadas por IA (Gemini com pesquisa no Google); confira antes de aplicar o preço.']
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Análise');
  XLSX.utils.book_append_sheet(wb, info, 'Sobre');
  XLSX.writeFile(wb, aiNomeArquivo('xlsx'));
}
