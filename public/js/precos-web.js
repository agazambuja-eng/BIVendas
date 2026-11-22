/**
 * Modal "Preço na web com IA": o servidor pede ao Gemini (com pesquisa no Google)
 * as ofertas da mesma peça — loja, local (cidade/bairro ou online), preço e link —
 * e confere cada oferta na própria página (foto e preço). Rota /precos/pesquisar.
 *
 * Filtragem pontual: tira do nome da peça o código do modelo, a cor e o
 * tamanho (ex.: "PRADA 0PR 15WS 24B40L 54" -> modelo 15WS, cor 24B40L, aro 54)
 * e confere cada oferta. Por padrão só aparecem ofertas do mesmo modelo.
 */

const pw = { termo: '', ref: null, itens: [], filtro: 'modelo', chaves: null, carregando: false, regiao: '' };

/* Região da pesquisa: a IA procura primeiro óticas e lojas físicas da cidade,
   depois lojas online que entregam lá. */
const REGIOES_PW = [
  ['', 'Brasil todo'],
  ['Maceió - AL', 'Maceió · AL'],
  ['Arapiraca - AL', 'Arapiraca · AL'],
  ['Curitiba - PR', 'Curitiba · PR'],
  ['São José dos Pinhais - PR', 'São José dos Pinhais · PR'],
  ['Recife - PE', 'Recife · PE'],
  ['Aracaju - SE', 'Aracaju · SE'],
  ['Salvador - BA', 'Salvador · BA'],
  ['São Paulo - SP', 'São Paulo · SP'],
  ['Rio de Janeiro - RJ', 'Rio de Janeiro · RJ'],
  ['Brasília - DF', 'Brasília · DF']
];
const CHAVE_REGIAO_PW = 'bi_regiao_precos_ia';
try { pw.regiao = localStorage.getItem(CHAVE_REGIAO_PW) || ''; } catch { /* sem armazenamento */ }

/* Alcance da pesquisa: lojas físicas da região, web ou ambas; e redes sociais. */
const ALCANCES_PW = [['fisicas', '📍 Lojas físicas'], ['internet', '🌐 Web'], ['todas', '🔀 Ambas']];
pw.alcance = 'todas'; pw.redes = false; pw.regioesExtra = []; pw.mostrarFora = false;
try {
  pw.alcance = localStorage.getItem('bi_alcance_precos') || 'todas';
  pw.redes = localStorage.getItem('bi_redes_precos') === '1';
  pw.regioesExtra = JSON.parse(localStorage.getItem('bi_regioes_extra') || '[]');
} catch { /* sem armazenamento */ }
const pwNormLocal = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const pwCidade = r => pwNormLocal(String(r || '').split(/\s*[-,]\s*/)[0]).trim();

/**
 * Filtro rígido do lado do BI (a IA nem sempre obedece):
 *  - lojas físicas: só "loja física" e, com região, só as que citam a cidade no local;
 *  - internet: só online / marketplaces / redes.
 */
function pwFiltrarAlcance(ofertas, alcance = pw.alcance, regiao = pw.regiao) {
  const cidade = pwCidade(regiao);
  const dentro = [], fora = [];
  (ofertas || []).forEach(o => {
    let ok = true;
    if (alcance === 'fisicas') ok = o.tipo === 'loja física' && (!cidade || pwNormLocal(o.local).includes(cidade));
    else if (alcance === 'internet') ok = o.tipo !== 'loja física';
    (ok ? dentro : fora).push(o);
  });
  return { dentro, fora };
}
const pwSemAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const pwNorm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pwCompacto = s => pwNorm(s).replace(/[^A-Z0-9]/g, '');
const pwR = n => formatarMoedaBR(Number(n) || 0);

/** Separa modelo, cor e tamanho do nome da peça. */
function pwChavesDoProduto(nome) {
  const tokens = pwNorm(nome).split(/[\s/]+/).map(t => t.replace(/[^A-Z0-9-]/g, '')).filter(Boolean);
  let modelo = '', cor = '', tamanho = '';
  for (let t of tokens) {
    const misto = /[A-Z]/.test(t) && /\d/.test(t);
    if (misto && /^0[A-Z]+$/.test(t)) continue;               // "0PR", "0RB": prefixo Luxottica
    if (!modelo && misto) { modelo = t.replace(/^0(?=[A-Z])/, ''); continue; }
    if (modelo && !cor && (misto || /^\d{3,}$/.test(t))) { cor = t; continue; }
    if (modelo && !tamanho && /^\d{2}$/.test(t)) { tamanho = t; continue; }
  }
  if (!modelo) {                                              // sem código misto: usa número longo (ex.: "MOD 28")
    const num = tokens.find(t => /^\d{3,}$/.test(t));
    if (num) modelo = num;
  }
  return { modelo, cor, tamanho };
}

/**
 * Termo para pesquisar PREÇO: grife + código do modelo (ex.: "OAKLEY 0OO9471 947104 36" -> "OAKLEY OO9471").
 * Cor e aro no termo derrubam resultados no Shopping/Mercado Livre; eles são conferidos depois, anúncio a anúncio.
 */
function termoPrecoProduto(nome) {
  const ch = pwChavesDoProduto(nome);
  if (!ch.modelo) return String(nome || '').replace(/\s+/g, ' ').trim();
  const tokens = pwNorm(nome).split(/\s+/).filter(Boolean);
  const marca = [];
  for (const t of tokens) {
    const limpo = t.replace(/[^A-Z0-9-]/g, '');
    if (/\d/.test(limpo)) break;                               // chegou nos códigos
    marca.push(limpo);
  }
  return [...marca.filter(t => !/^(MOD|MODELO|OCULOS|ARMACAO|SOLAR|SOL)$/.test(t)), ch.modelo].join(' ').trim();
}

function pwConfere(item, ch) {
  const t = pwCompacto([item.titulo, item.tituloPagina, item.url].join(' '));
  const tem = x => x && t.includes(pwCompacto(x));
  return { modelo: !ch.modelo || tem(ch.modelo), cor: !!ch.cor && tem(ch.cor), tamanho: !!ch.tamanho && new RegExp(`\\b${ch.tamanho}\\b`).test(pwNorm([item.titulo, item.tituloPagina].join(' '))) };
}

function pwModal() {
  let m = document.getElementById('modalPrecoWeb');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'modalPrecoWeb';
  m.className = 'pw-fundo';
  m.innerHTML = `<div class="pw-janela" role="dialog" aria-modal="true" aria-labelledby="pwTitulo">
      <div class="pw-cab"><div><h3 id="pwTitulo">🤖 Preço na web · pesquisa com IA</h3><div id="pwSub" class="pw-sub"></div></div>
        <button type="button" class="pw-fechar" onclick="fecharPesquisaPreco()" title="Fechar (Esc)">✕</button></div>
      <div id="pwCorpo" class="pw-corpo"></div>
    </div>`;
  m.addEventListener('click', e => { if (e.target === m) fecharPesquisaPreco(); });
  document.body.appendChild(m);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.style.display === 'flex') fecharPesquisaPreco(); });
  return m;
}
function fecharPesquisaPreco() { const m = document.getElementById('modalPrecoWeb'); if (m) m.style.display = 'none'; }

/**
 * Abre a pesquisa. Chamado pelo botão 🛒 (data-termo, data-ref, data-ref-rotulo).
 * ref = valor nosso para comparar (custo unitário ou preço médio vendido).
 */
async function abrirPesquisaPreco(el) {
  const nome = el && el.dataset ? el.dataset.termo : String(el || '');
  const termo = termoPrecoProduto(nome);
  pw.termo = termo;
  pw.nome = nome;
  const ds = (el && el.dataset) || {};
  pw.ref = ds.ref ? { valor: Number(ds.ref), rotulo: ds.refRotulo || 'Nosso valor' } : null;
  pw.ref2 = ds.ref2 ? { valor: Number(ds.ref2), rotulo: ds.ref2Rotulo || 'Nosso custo' } : null;
  pw.extra = { corNome: ds.corNome || '', modeloSavwin: ds.modeloSavwin || '' };
  pw.contexto = {
    diasEntrada: ds.diasEntrada != null && ds.diasEntrada !== '' ? Number(ds.diasEntrada) : null,
    parado: ds.parado != null && ds.parado !== '' ? Number(ds.parado) : null      // dias sem vender da grife; -1 = nunca vendeu
  };
  pw.chaves = pwChavesDoProduto(nome);
  pw.filtro = pw.chaves.modelo ? 'modelo' : 'todos';
  pw.itens = []; pw.itensTodos = []; pw.foraDoAlcance = 0; pw.mostrarFora = false;
  pw.el = el;
  const m = pwModal();
  m.style.display = 'flex';
  document.getElementById('pwSub').innerHTML = `${escHTML(nome)}${termo !== nome ? ` · pesquisado como <b>${escHTML(termo)}</b>` : ''}` +
    (pw.chaves.modelo ? ` · <span class="pw-chave">modelo <b>${escHTML(pw.chaves.modelo)}</b></span>` : '') +
    (pw.chaves.cor ? ` <span class="pw-chave">cor <b>${escHTML(pw.chaves.cor)}</b></span>` : '') +
    (pw.chaves.tamanho ? ` <span class="pw-chave">aro <b>${escHTML(pw.chaves.tamanho)}</b></span>` : '');
  document.getElementById('pwCorpo').innerHTML = `<div class="pw-aguarde">🤖 A IA está pesquisando na web${pw.regiao ? ' · ' + escHTML(pwRotuloRegiao(pw.regiao)) : ' (Brasil)'}…<br><small>leva de 15 a 40 segundos: ela pesquisa no Google e o BI confere foto e preço em cada página</small></div>`;
  try {
    const resp = await fetchAutenticado('/precos/pesquisar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, termo, modelo: pw.chaves.modelo, cor: pw.chaves.cor, tamanho: pw.chaves.tamanho, regiao: pw.regiao, corNome: pw.extra.corNome, modeloSavwin: pw.extra.modeloSavwin, alcance: pw.alcance, redes: pw.redes })
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
    if (pw.termo !== termo) return;                            // outra pesquisa foi aberta
    pw.itensTodos = (j.ofertas || []).map(x => ({ ...x, confere: pwConfere(x, pw.chaves) }));
    pwAplicarAlcance();
    if (pw.filtro === 'modelo' && !pw.itens.some(x => x.confere.modelo)) pw.filtro = 'todos';   // a IA nem sempre repete o código
    pw.quando = j.quando;
    pw.resumoIA = j.resumo || '';
    pw.fontes = j.fontes || [];
    pw.uso = j.uso || null;
    pw.doCache = !!j.doCache;
    pw.ia = j.modelo ? `${j.modelo} · chave ${j.chaveN}${j.tentativas > 1 ? ` (${j.tentativas}ª tentativa)` : ''}` : '';
    pwRenderizar();
  } catch (e) {
    document.getElementById('pwCorpo').innerHTML = `<div class="pw-aguarde">⚠️ ${escHTML(e.message)}</div>`;
  }
}

function pwFiltrar(f) { pw.filtro = f; pwRenderizar(); }

function pwAplicarAlcance() {
  const { dentro, fora } = pwFiltrarAlcance(pw.itensTodos || []);
  pw.foraDoAlcance = fora.length;
  pw.itens = pw.mostrarFora ? (pw.itensTodos || []) : dentro;
}
function pwMudarAlcance(a) {
  pw.alcance = a;
  try { localStorage.setItem('bi_alcance_precos', a); } catch { /* sem armazenamento */ }
  abrirPesquisaPreco(pw.el || pw.nome);           // a IA pesquisa de novo com o novo alcance
}
function pwMudarRedes(v) {
  pw.redes = !!v;
  try { localStorage.setItem('bi_redes_precos', v ? '1' : '0'); } catch { /* sem armazenamento */ }
  abrirPesquisaPreco(pw.el || pw.nome);
}
function pwAlternarFora() { pw.mostrarFora = !pw.mostrarFora; pwAplicarAlcance(); pwRenderizar(); }

/** Atalhos (grátis) para ver a peça nas redes, via pesquisa do Google. */
function pwLinksRedes() {
  const cidade = pw.regiao ? ' ' + String(pw.regiao).split(/\s*-\s*/)[0] : '';
  const q = site => `https://www.google.com/search?q=${encodeURIComponent(`site:${site} ${pw.termo}${cidade}`)}`;
  return `<span class="pw-redes-links">ver nas redes: <a href="${q('instagram.com')}" target="_blank" rel="noopener noreferrer">📷 Instagram</a> · <a href="${q('facebook.com')}" target="_blank" rel="noopener noreferrer">📘 Facebook</a> · <a href="${q('tiktok.com')}" target="_blank" rel="noopener noreferrer">🎵 TikTok</a></span>`;
}

function pwRotuloRegiao(r) {
  const achada = REGIOES_PW.find(x => x[0] === r);
  return achada ? achada[1] : r;
}
function pwSeletorRegiao() {
  const extras = (pw.regioesExtra || []).filter(r => r && !REGIOES_PW.some(x => x[0] === r)).map(r => [r, r]);
  let lista = [...REGIOES_PW, ...extras];
  if (pw.regiao && !lista.some(x => x[0] === pw.regiao)) lista = [...lista, [pw.regiao, pwRotuloRegiao(pw.regiao)]];
  return `<label class="pw-regiao">📍 Região
    <select onchange="pwMudarRegiao(this.value)">${lista.map(([v, t]) => `<option value="${escHTML(v)}" ${v === pw.regiao ? 'selected' : ''}>${escHTML(t)}</option>`).join('')}
      <option value="__outra">Outra cidade…</option>
      <option value="__minha">Usar minha localização…</option></select></label>`;
}
async function pwMudarRegiao(v) {
  if (v === '__outra') {
    const c = prompt('Cidade e estado (ex.: Arapiraca - AL, Campina Grande - PB):', '');
    if (!c || !c.trim()) { pwRenderizar(); return; }
    v = c.trim().replace(/\s+/g, ' ');
    pw.regioesExtra = [v, ...(pw.regioesExtra || []).filter(x => x !== v)].slice(0, 8);
    try { localStorage.setItem('bi_regioes_extra', JSON.stringify(pw.regioesExtra)); } catch { /* sem armazenamento */ }
  }
  if (v === '__minha') {
    try { v = await pwRegiaoDoNavegador(); }
    catch (e) { alert(e.message); pwRenderizar(); return; }
  }
  pw.regiao = v;
  try { localStorage.setItem(CHAVE_REGIAO_PW, v); } catch { /* sem armazenamento */ }
  abrirPesquisaPreco(pw.el || pw.nome);
}
/** Cidade pela localização do aparelho (pede permissão ao navegador). */
function pwRegiaoDoNavegador() {
  return new Promise((ok, falha) => {
    if (!navigator.geolocation) return falha(new Error('Este navegador não informa a localização.'));
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude, longitude } = pos.coords;
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=pt`);
        const j = await r.json();
        const cidade = String(j.city || j.locality || '').trim();
        const estado = String(j.principalSubdivision || '').trim();
        if (!cidade) throw new Error('Não foi possível descobrir a cidade.');
        const reg = estado ? `${cidade} - ${estado}` : cidade;
        pw.regioesExtra = [reg, ...(pw.regioesExtra || []).filter(x => x !== reg)].slice(0, 8);
        try { localStorage.setItem('bi_regioes_extra', JSON.stringify(pw.regioesExtra)); } catch { /* sem armazenamento */ }
        ok(reg);
      } catch (e) { falha(new Error('Não foi possível descobrir a cidade pela localização.')); }
    }, () => falha(new Error('Localização não permitida no navegador.')), { timeout: 10000, maximumAge: 3600000 });
  });
}

// ---------------------------------------------------------------- nível de preço e sugestão de promoção
const CHAVE_MARKUP_MIN = 'bi_markup_minimo';
function pwMarkupMinimo() {
  let v = 2;
  try { v = Number(localStorage.getItem(CHAVE_MARKUP_MIN)) || 2; } catch { /* sem armazenamento */ }
  return Math.min(10, Math.max(1, v));
}
function pwMudarMarkupMinimo(v) {
  const n = Number(String(v).replace(',', '.'));
  if (!(n >= 1 && n <= 10)) return;
  try { localStorage.setItem(CHAVE_MARKUP_MIN, String(n)); } catch { /* sem armazenamento */ }
  pwRenderizar();
}
/** Preço "de vitrine": 1.305 -> 1.299,90 · 950 -> 949,90 · 87 -> 86,90 */
function pwPrecoVitrine(p) {
  if (!(p > 0)) return 0;
  if (p >= 100) return Math.floor(p / 10) * 10 - 0.10;
  return Math.max(1, Math.floor(p) - 0.10);
}
function pwQuantil(ordenados, q) {
  if (!ordenados.length) return 0;
  const pos = (ordenados.length - 1) * q, b = Math.floor(pos), r = pos - b;
  return ordenados[b + 1] !== undefined ? ordenados[b] + r * (ordenados[b + 1] - ordenados[b]) : ordenados[b];
}

/** Painel ao lado das ofertas: onde estamos no mercado e 3 preços sugeridos. */
/**
 * Cálculo da sugestão (usado no modal e na análise em lote).
 * precos: ofertas ordenadas; nosso: nosso preço de venda (0 se não houver); custo: custo unitário;
 * contexto: { diasEntrada, parado (-1 = grife sem venda) }.
 */
function pwCalcularSugestao({ precos, mediana, nosso, custo, contexto }) {
  if (!precos.length) return null;
  const mkMin = pwMarkupMinimo();
  const piso = custo ? custo * mkMin : 0;
  const p25 = precos.length >= 4 ? pwQuantil(precos, 0.25) : precos[0] * 1.02;
  const maior = precos[precos.length - 1];
  const c = contexto || {};
  const nunca = c.parado === -1;
  const urg = nunca || (c.diasEntrada || 0) > 365 ? 'alta' : (c.diasEntrada || 0) > 180 || (c.parado || 0) > 180 ? 'media' : 'baixa';

  let nivel = null;
  if (nosso) {
    const pos = Math.round(precos.filter(p => p < nosso).length / precos.length * 100);
    nivel = nosso > maior ? { cls: 'n-alto', txt: '🔴 Acima de todas as ofertas', curto: 'Acima de todas' }
      : nosso > mediana * 1.05 ? { cls: 'n-acima', txt: '🟠 Acima da mediana do mercado', curto: 'Acima da mediana' }
      : nosso >= mediana * 0.95 ? { cls: 'n-ok', txt: '🟢 Na média do mercado', curto: 'Na média' }
      : { cls: 'n-baixo', txt: '🔵 Abaixo da mediana do mercado', curto: 'Abaixo da mediana' };
    nivel.pos = pos;
    nivel.det = `${pos}% das ofertas estão mais baratas que o nosso preço`;
  }

  const ajustar = p => {
    let v = pwPrecoVitrine(p);
    if (piso && v < piso) v = Math.ceil((piso + 0.1) / 10) * 10 - 0.10;     // não passa do piso de margem
    return v;
  };
  const opcoes = [
    { id: 'mediana', rot: 'Alinhar ao mercado', ajuda: 'preço da mediana das ofertas', preco: ajustar(mediana) },
    { id: 'girar', rot: 'Girar rápido', ajuda: 'entre as 25% mais baratas', preco: ajustar(p25) },
    ...(piso ? [{ id: 'piso', rot: 'Piso de margem', ajuda: `custo × ${mkMin.toLocaleString('pt-BR')} (markup mínimo)`, preco: Math.ceil((piso + 0.1) / 10) * 10 - 0.10 }] : [])
  ].map(o => ({
    ...o,
    desconto: nosso ? (1 - o.preco / nosso) * 100 : null,
    markup: custo ? o.preco / custo : null,
    margem: custo ? (1 - custo / o.preco) * 100 : null
  }));

  let rec, texto;
  if (nosso && nosso <= mediana * 1.05) {
    rec = null;
    texto = 'Nosso preço já está competitivo. Se a peça está parada, o motivo provável não é preço: veja exposição, remanejar para lojas que vendem este modelo ou uma ação com os vendedores.';
  } else {
    rec = urg === 'alta' ? 'girar' : 'mediana';
    texto = urg === 'alta'
      ? `Peça ${nunca ? 'de grife sem venda no período' : 'parada há mais de 1 ano'}: vale uma promoção para girar rápido.`
      : urg === 'media' ? 'Parada há mais de 6 meses: alinhe ao preço do mercado.'
      : 'Alinhe ao preço do mercado para não perder venda.';
    if (piso && pwPrecoVitrine(rec === 'girar' ? p25 : mediana) < piso) {
      texto += ` O mercado está abaixo do nosso piso de margem (${pwR(piso)}): a promoção vai até o piso; abaixo disso, considere trocar com o fornecedor ou remanejar.`;
    }
  }
  return { nivel, opcoes, rec, texto, piso, mkMin, urg };
}

/** Ofertas que valem para a comparação: mesmo modelo (se houver alguma), senão todas. */
function pwOfertasDoModelo(ofertas, chaves) {
  const conf = ofertas.map(x => ({ ...x, confere: pwConfere(x, chaves) }));
  const doModelo = conf.filter(x => x.confere.modelo);
  return (doModelo.length ? doModelo : conf).sort((a, b) => a.preco - b.preco);
}
function pwMediana(precos) {
  return precos.length ? (precos.length % 2 ? precos[(precos.length - 1) / 2] : (precos[precos.length / 2 - 1] + precos[precos.length / 2]) / 2) : 0;
}

function pwSugestao(precos, mediana) {
  const venda = pw.ref && pw.ref.valor > 0 ? pw.ref.valor : 0;
  const ehCusto = pw.ref && /custo/i.test(pw.ref.rotulo);
  const custo = pw.ref2 && pw.ref2.valor > 0 ? pw.ref2.valor : (ehCusto ? venda : 0);
  const nosso = ehCusto ? 0 : venda;
  if (!precos.length) return '<aside class="pw-sugestao"><h4>💡 Sugestão de preço</h4><p class="pw-sug-txt">Sem ofertas para comparar.</p></aside>';
  const c = pw.contexto || {};
  const nunca = c.parado === -1;
  const { nivel, opcoes, rec, texto, mkMin } = pwCalcularSugestao({ precos, mediana, nosso, custo, contexto: c });

  const linha = o => {
    const desc = o.desconto, mk = o.markup, margem = o.margem;
    return `<div class="pw-opcao ${o.id === rec ? 'rec' : ''}">
      <div class="pw-op-cab"><span>${o.id === rec ? '⭐ ' : ''}${o.rot}</span><b>${pwR(o.preco)}</b></div>
      <div class="pw-op-det">${o.ajuda}${desc !== null ? ` · ${desc > 0 ? '−' : '+'}${Math.abs(desc).toFixed(0)}% no nosso preço` : ''}${mk ? ` · markup ${mk.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×` : ''}${margem !== null ? ` · margem ${margem.toFixed(0)}%` : ''}</div>
    </div>`;
  };

  return `<aside class="pw-sugestao">
    <h4>💡 Nível de preço e sugestão</h4>
    ${nivel ? `<div class="pw-nivel ${nivel.cls}"><b>${nivel.txt}</b><small>${escHTML(nivel.det)}</small></div>` : '<p class="pw-sug-txt">Sem o nosso preço de venda: sugestões calculadas pelo mercado e pelo custo.</p>'}
    <div class="pw-sug-ctx">${[
      nosso ? `Nosso preço: <b>${pwR(nosso)}</b>` : '',
      custo ? `Custo: <b>${pwR(custo)}</b>` : '',
      c.diasEntrada != null ? `Última entrada há <b>${c.diasEntrada} d</b>` : '',
      c.parado != null ? (nunca ? 'Grife <b>sem venda</b> no período' : `Grife vendeu há <b>${c.parado} d</b>`) : ''
    ].filter(Boolean).join('<br>')}</div>
    <p class="pw-sug-txt">${escHTML(texto)}</p>
    ${opcoes.map(linha).join('')}
    ${custo ? `<label class="pw-mkmin">Markup mínimo <input type="number" min="1" max="10" step="0.1" value="${mkMin}" onchange="pwMudarMarkupMinimo(this.value)"> ×</label>` : ''}
    <p class="pw-sug-nota">Cálculo do BI com as ofertas do filtro atual (${precos.length}). Preços arredondados para vitrine (,90).</p>
  </aside>`;
}

function pwRenderizar() {
  const corpo = document.getElementById('pwCorpo');
  const conta = { todos: pw.itens.length, modelo: pw.itens.filter(x => x.confere.modelo).length, cor: pw.itens.filter(x => x.confere.modelo && x.confere.cor).length };
  const lista = pw.itens
    .filter(x => pw.filtro === 'todos' || (pw.filtro === 'modelo' ? x.confere.modelo : x.confere.modelo && x.confere.cor))
    .sort((a, b) => a.preco - b.preco);
  const precos = lista.map(x => x.preco);
  const mediana = precos.length ? (precos.length % 2 ? precos[(precos.length - 1) / 2] : (precos[precos.length / 2 - 1] + precos[precos.length / 2]) / 2) : 0;
  const ref = pw.ref && pw.ref.valor > 0 ? pw.ref : null;
  const comparar = ref && mediana ? (() => {
    const dif = (mediana / ref.valor - 1) * 100;
    return `<div class="pw-num"><span>Mediana ÷ ${escHTML(ref.rotulo.toLowerCase())}</span><b>${(mediana / ref.valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×</b><small>${dif >= 0 ? '+' : ''}${dif.toFixed(0)}%</small></div>`;
  })() : '';

  const botao = (id, rot) => `<button type="button" class="${pw.filtro === id ? 'ativo' : ''}" onclick="pwFiltrar('${id}')">${rot} (${conta[id]})</button>`;
  corpo.innerHTML = `
    <div class="pw-resumo">
      <div class="pw-num"><span>Ofertas</span><b>${lista.length}</b></div>
      <div class="pw-num"><span>Menor</span><b>${precos.length ? pwR(precos[0]) : '—'}</b></div>
      <div class="pw-num"><span>Mediana</span><b>${precos.length ? pwR(mediana) : '—'}</b></div>
      <div class="pw-num"><span>Maior</span><b>${precos.length ? pwR(precos[precos.length - 1]) : '—'}</b></div>
      ${ref ? `<div class="pw-num"><span>${escHTML(ref.rotulo)}</span><b>${pwR(ref.valor)}</b></div>` : ''}${comparar}
      ${pw.ref2 && pw.ref2.valor > 0 ? `<div class="pw-num"><span>${escHTML(pw.ref2.rotulo)}</span><b>${pwR(pw.ref2.valor)}</b>${mediana ? `<small>mediana ${(mediana / pw.ref2.valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×</small>` : ''}</div>` : ''}
    </div>
    ${pw.resumoIA ? `<div class="pw-ia">🤖 ${escHTML(pw.resumoIA)}</div>` : ''}
    <div class="pw-filtros pw-filtros-alcance">
      ${pwSeletorRegiao()}
      <div class="ca-alternar">${ALCANCES_PW.map(([v, t]) => `<button type="button" class="${pw.alcance === v ? 'ativo' : ''}" onclick="pwMudarAlcance('${v}')">${t}</button>`).join('')}</div>
      <label class="pw-redes"><input type="checkbox" ${pw.redes ? 'checked' : ''} onchange="pwMudarRedes(this.checked)"> 📱 Incluir Instagram, Facebook e TikTok</label>
      ${pwLinksRedes()}
    </div>
    ${pw.foraDoAlcance ? `<div class="pw-aviso">${pw.mostrarFora ? 'Mostrando também' : 'Ocultadas'} <b>${pw.foraDoAlcance}</b> oferta(s) fora do filtro (${pw.alcance === 'fisicas' ? `não são lojas físicas${pw.regiao ? ' de ' + escHTML(pwRotuloRegiao(pw.regiao)) : ''}` : 'não são da web'}). <button type="button" class="tv-link" onclick="pwAlternarFora()">${pw.mostrarFora ? 'ocultar' : 'mostrar'}</button></div>` : ''}
    ${pw.alcance === 'fisicas' && !pw.itens.length && !pw.mostrarFora ? `<div class="pw-aviso">Nenhuma loja física${pw.regiao ? ' de ' + escHTML(pwRotuloRegiao(pw.regiao)) : ''} com preço publicado foi encontrada. Lojas físicas raramente publicam preço; tente incluir as redes sociais ou use os atalhos "ver nas redes".</div>` : ''}
    <div class="pw-filtros">
      <div class="ca-alternar">${pw.chaves.modelo ? botao('modelo', 'Mesmo modelo') + (pw.chaves.cor ? botao('cor', 'Modelo e cor') : '') : ''}${botao('todos', 'Todos')}</div>
      <a class="tv-link" href="https://www.google.com/search?tbm=shop&q=${encodeURIComponent(pw.termo)}" target="_blank" rel="noopener noreferrer">abrir no Google Shopping ↗</a>
    </div>
    <div class="pw-dupla">
    <div class="pw-col-lista">
    ${lista.length ? `<div class="pw-lista">${lista.map(x => {
      const link = x.url || `https://www.google.com/search?q=${encodeURIComponent((x.loja || '') + ' ' + pw.termo)}`;
      const origem = { conferido: '<span class="pw-tag ok">preço conferido na página ✓</span>', pagina: '<span class="pw-tag">preço da página</span>', ia: '<span class="pw-tag aviso">preço informado pela IA · confira</span>' }[x.precoOrigem] || '';
      return `
      <a class="pw-item" href="${escHTML(link)}" target="_blank" rel="noopener noreferrer">
        <div class="pw-img">${x.imagem ? `<img src="${escHTML(x.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith('🕶️')">` : '🕶️'}</div>
        <div class="pw-info">
          <div class="pw-titulo">${escHTML(x.titulo || x.tituloPagina || pw.nome)}</div>
          <div class="pw-loja">${x.tipo === 'loja física' ? '📍' : '🌐'} <b>${escHTML(x.loja || 'loja não informada')}</b>${x.local && !/^online$/i.test(x.local) ? ` · ${escHTML(x.local)}` : x.tipo === 'online' ? ' · online' : ''}${x.cor ? ` · cor ${escHTML(x.cor)}` : ''}</div>
          ${x.observacao ? `<div class="pw-obs">${escHTML(x.observacao)}</div>` : ''}
          <div class="pw-tags">${{ instagram: '<span class="pw-tag rede">📷 Instagram</span>', facebook: '<span class="pw-tag rede">📘 Facebook</span>', tiktok: '<span class="pw-tag rede">🎵 TikTok</span>', marketplace: '<span class="pw-tag">🛒 marketplace</span>' }[x.origem] || ''}${x.confere.modelo && pw.chaves.modelo ? '<span class="pw-tag ok">modelo ✓</span>' : ''}${x.confere.cor ? '<span class="pw-tag ok">cor ✓</span>' : ''}${x.confere.tamanho ? '<span class="pw-tag ok">aro ✓</span>' : ''}${origem}</div>
        </div>
        <div class="pw-preco">${pwR(x.preco)}${ref ? `<small>${x.preco >= ref.valor ? '+' : ''}${((x.preco / ref.valor - 1) * 100).toFixed(0)}% vs ${escHTML(ref.rotulo.toLowerCase())}</small>` : ''}</div>
      </a>`; }).join('')}</div>`
      : `<div class="pw-aguarde">Nenhuma oferta ${pw.filtro === 'todos' ? '' : 'com o mesmo modelo '}encontrada.${pw.filtro !== 'todos' && conta.todos ? ' Veja "Todos" para resultados parecidos.' : ''}</div>`}
    </div>
    ${pwSugestao(precos, mediana)}
    </div>
    ${pw.fontes && pw.fontes.length ? `<details class="pw-fontes"><summary>Fontes consultadas pela IA (${pw.fontes.length})</summary>${pw.fontes.map(f => `<a href="${escHTML(f.url)}" target="_blank" rel="noopener noreferrer">${escHTML(f.titulo || f.url)}</a>`).join('')}</details>` : ''}
    <p class="pw-rodape">Pesquisa feita por IA (Gemini com pesquisa no Google${pw.ia ? ' · ' + escHTML(pw.ia) : ''})${pw.regiao ? ` · região ${escHTML(pwRotuloRegiao(pw.regiao))}` : ''}${pw.quando ? ' · ' + new Date(pw.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}${pw.doCache ? ' (guardada; repete a mesma pesquisa sem custo por 24 h)' : ''}${pw.uso ? ` · ${pw.uso.usadas} de ${pw.uso.limite} pesquisas neste mês` : ''}.
      A IA pode errar: confira a oferta antes de usar o preço.</p>`;
}

/** Botão 🛒 que abre o modal (para pôr ao lado da lupa). */
function botaoPrecoWeb(p, ref) {
  if (typeof iaLiberada === 'function' && !iaLiberada('precos')) return '';
  const termo = typeof termoBuscaProduto === 'function' ? termoBuscaProduto(p) : String(p.descricao || '');
  if (!termo) return '';
  const refs = [].concat(ref || []).filter(r => r && r.valor > 0);
  const attrRef = refs.map((r, i) => ` data-ref${i ? i + 1 : ''}="${Number(r.valor).toFixed(2)}" data-ref${i ? i + 1 : ''}-rotulo="${escHTML(r.rotulo)}"`).join('') +
    (p.corNome ? ` data-cor-nome="${escHTML(p.corNome)}"` : '') + (p.modeloSavwin ? ` data-modelo-savwin="${escHTML(p.modeloSavwin)}"` : '') +
    (p.diasEntrada != null ? ` data-dias-entrada="${Number(p.diasEntrada)}"` : '') + (p.parado != null ? ` data-parado="${Number(p.parado)}"` : '');
  return `<button type="button" class="link-preco link-preco-web" data-termo="${escHTML(termo)}"${attrRef}
    onclick="event.stopPropagation(); abrirPesquisaPreco(this)" title="Pesquisar o preço desta peça com IA (lojas da região e online, com foto e preço)">🤖</button>`;
}
