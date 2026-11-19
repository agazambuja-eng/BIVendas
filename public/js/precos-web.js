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
  pw.chaves = pwChavesDoProduto(nome);
  pw.filtro = pw.chaves.modelo ? 'modelo' : 'todos';
  pw.itens = [];
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, termo, modelo: pw.chaves.modelo, cor: pw.chaves.cor, tamanho: pw.chaves.tamanho, regiao: pw.regiao, corNome: pw.extra.corNome, modeloSavwin: pw.extra.modeloSavwin })
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
    if (pw.termo !== termo) return;                            // outra pesquisa foi aberta
    pw.itens = (j.ofertas || []).map(x => ({ ...x, confere: pwConfere(x, pw.chaves) }));
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

function pwRotuloRegiao(r) {
  const achada = REGIOES_PW.find(x => x[0] === r);
  return achada ? achada[1] : r;
}
function pwSeletorRegiao() {
  const lista = REGIOES_PW.some(x => x[0] === pw.regiao) ? REGIOES_PW : [...REGIOES_PW, [pw.regiao, pwRotuloRegiao(pw.regiao)]];
  return `<label class="pw-regiao">📍 Região
    <select onchange="pwMudarRegiao(this.value)">${lista.map(([v, t]) => `<option value="${escHTML(v)}" ${v === pw.regiao ? 'selected' : ''}>${escHTML(t)}</option>`).join('')}
      <option value="__minha">Usar minha localização…</option></select></label>`;
}
async function pwMudarRegiao(v) {
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
        ok(estado ? `${cidade} - ${estado}` : cidade);
      } catch (e) { falha(new Error('Não foi possível descobrir a cidade pela localização.')); }
    }, () => falha(new Error('Localização não permitida no navegador.')), { timeout: 10000, maximumAge: 3600000 });
  });
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
    <div class="pw-filtros">
      ${pwSeletorRegiao()}
      <div class="ca-alternar">${pw.chaves.modelo ? botao('modelo', 'Mesmo modelo') + (pw.chaves.cor ? botao('cor', 'Modelo e cor') : '') : ''}${botao('todos', 'Todos')}</div>
      <a class="tv-link" href="https://www.google.com/search?tbm=shop&q=${encodeURIComponent(pw.termo)}" target="_blank" rel="noopener noreferrer">abrir no Google Shopping ↗</a>
    </div>
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
          <div class="pw-tags">${x.confere.modelo && pw.chaves.modelo ? '<span class="pw-tag ok">modelo ✓</span>' : ''}${x.confere.cor ? '<span class="pw-tag ok">cor ✓</span>' : ''}${x.confere.tamanho ? '<span class="pw-tag ok">aro ✓</span>' : ''}${origem}</div>
        </div>
        <div class="pw-preco">${pwR(x.preco)}${ref ? `<small>${x.preco >= ref.valor ? '+' : ''}${((x.preco / ref.valor - 1) * 100).toFixed(0)}% vs ${escHTML(ref.rotulo.toLowerCase())}</small>` : ''}</div>
      </a>`; }).join('')}</div>`
      : `<div class="pw-aguarde">Nenhuma oferta ${pw.filtro === 'todos' ? '' : 'com o mesmo modelo '}encontrada.${pw.filtro !== 'todos' && conta.todos ? ' Veja "Todos" para resultados parecidos.' : ''}</div>`}
    ${pw.fontes && pw.fontes.length ? `<details class="pw-fontes"><summary>Fontes consultadas pela IA (${pw.fontes.length})</summary>${pw.fontes.map(f => `<a href="${escHTML(f.url)}" target="_blank" rel="noopener noreferrer">${escHTML(f.titulo || f.url)}</a>`).join('')}</details>` : ''}
    <p class="pw-rodape">Pesquisa feita por IA (Gemini com pesquisa no Google${pw.ia ? ' · ' + escHTML(pw.ia) : ''})${pw.regiao ? ` · região ${escHTML(pwRotuloRegiao(pw.regiao))}` : ''}${pw.quando ? ' · ' + new Date(pw.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}${pw.doCache ? ' (guardada; repete a mesma pesquisa sem custo por 24 h)' : ''}${pw.uso ? ` · ${pw.uso.usadas} de ${pw.uso.limite} pesquisas neste mês` : ''}.
      A IA pode errar: confira a oferta antes de usar o preço.</p>`;
}

/** Botão 🛒 que abre o modal (para pôr ao lado da lupa). */
function botaoPrecoWeb(p, ref) {
  const termo = typeof termoBuscaProduto === 'function' ? termoBuscaProduto(p) : String(p.descricao || '');
  if (!termo) return '';
  const refs = [].concat(ref || []).filter(r => r && r.valor > 0);
  const attrRef = refs.map((r, i) => ` data-ref${i ? i + 1 : ''}="${Number(r.valor).toFixed(2)}" data-ref${i ? i + 1 : ''}-rotulo="${escHTML(r.rotulo)}"`).join('') +
    (p.corNome ? ` data-cor-nome="${escHTML(p.corNome)}"` : '') + (p.modeloSavwin ? ` data-modelo-savwin="${escHTML(p.modeloSavwin)}"` : '');
  return `<button type="button" class="link-preco link-preco-web" data-termo="${escHTML(termo)}"${attrRef}
    onclick="event.stopPropagation(); abrirPesquisaPreco(this)" title="Pesquisar o preço desta peça com IA (lojas da região e online, com foto e preço)">🤖</button>`;
}
