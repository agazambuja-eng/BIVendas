/**
 * Modal "Preço na web": pesquisa a mesma peça no Google Shopping Brasil
 * (pelo servidor, rota /precos/pesquisar) e mostra loja, preço e imagem.
 *
 * Filtragem pontual: tira do nome da peça o código do modelo, a cor e o
 * tamanho (ex.: "PRADA 0PR 15WS 24B40L 54" -> modelo 15WS, cor 24B40L, aro 54)
 * e confere cada anúncio. Por padrão só aparecem anúncios do mesmo modelo.
 */

const pw = { termo: '', ref: null, itens: [], filtro: 'modelo', chaves: null, carregando: false, regiao: '' };

/* Região da pesquisa: o Google mostra primeiro lojas/anúncios daquela cidade.
   Nomes no formato que o Google usa ("Cidade,State of Estado,Brazil"). */
const REGIOES_PW = [
  ['', 'Brasil todo'],
  ['Maceio,State of Alagoas,Brazil', 'Maceió · AL'],
  ['Arapiraca,State of Alagoas,Brazil', 'Arapiraca · AL'],
  ['Curitiba,State of Parana,Brazil', 'Curitiba · PR'],
  ['Sao Jose dos Pinhais,State of Parana,Brazil', 'São José dos Pinhais · PR'],
  ['Recife,State of Pernambuco,Brazil', 'Recife · PE'],
  ['Aracaju,State of Sergipe,Brazil', 'Aracaju · SE'],
  ['Salvador,State of Bahia,Brazil', 'Salvador · BA'],
  ['Sao Paulo,State of Sao Paulo,Brazil', 'São Paulo · SP'],
  ['Rio de Janeiro,State of Rio de Janeiro,Brazil', 'Rio de Janeiro · RJ'],
  ['Brasilia,Federal District,Brazil', 'Brasília · DF']
];
const CHAVE_REGIAO_PW = 'bi_regiao_precos';
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
  const t = pwCompacto(item.titulo);
  const tem = x => x && t.includes(pwCompacto(x));
  return { modelo: !ch.modelo || tem(ch.modelo), cor: !!ch.cor && tem(ch.cor), tamanho: !!ch.tamanho && new RegExp(`\\b${ch.tamanho}\\b`).test(pwNorm(item.titulo)) };
}

function pwModal() {
  let m = document.getElementById('modalPrecoWeb');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'modalPrecoWeb';
  m.className = 'pw-fundo';
  m.innerHTML = `<div class="pw-janela" role="dialog" aria-modal="true" aria-labelledby="pwTitulo">
      <div class="pw-cab"><div><h3 id="pwTitulo">🛒 Preço na web</h3><div id="pwSub" class="pw-sub"></div></div>
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
  pw.ref = el && el.dataset && el.dataset.ref ? { valor: Number(el.dataset.ref), rotulo: el.dataset.refRotulo || 'Nosso valor' } : null;
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
  document.getElementById('pwCorpo').innerHTML = `<div class="pw-aguarde">⏳ Pesquisando no Google Shopping${pw.regiao ? ' · ' + escHTML(pwRotuloRegiao(pw.regiao)) : ' Brasil'}...</div>`;
  try {
    const resp = await fetchAutenticado('/precos/pesquisar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ termo, regiao: pw.regiao })
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
    if (pw.termo !== termo) return;                            // outra pesquisa foi aberta
    pw.itens = (j.itens || []).map(x => ({ ...x, confere: pwConfere(x, pw.chaves) }));
    pw.quando = j.quando;
    pw.aviso = j.aviso || '';
    pwRenderizar();
  } catch (e) {
    document.getElementById('pwCorpo').innerHTML = `<div class="pw-aguarde">⚠️ ${escHTML(e.message)}</div>`;
  }
}

function pwFiltrar(f) { pw.filtro = f; pwRenderizar(); }

function pwRotuloRegiao(r) {
  const achada = REGIOES_PW.find(x => x[0] === r);
  return achada ? achada[1] : r.split(',')[0];
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
        const cidade = pwSemAcento(j.city || j.locality || '');
        const estado = pwSemAcento(j.principalSubdivision || '');
        if (!cidade) throw new Error('Não foi possível descobrir a cidade.');
        ok(estado === 'Distrito Federal' ? 'Brasilia,Federal District,Brazil' : `${cidade},State of ${estado},Brazil`);
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
      <div class="pw-num"><span>Anúncios</span><b>${lista.length}</b></div>
      <div class="pw-num"><span>Menor</span><b>${precos.length ? pwR(precos[0]) : '—'}</b></div>
      <div class="pw-num"><span>Mediana</span><b>${precos.length ? pwR(mediana) : '—'}</b></div>
      <div class="pw-num"><span>Maior</span><b>${precos.length ? pwR(precos[precos.length - 1]) : '—'}</b></div>
      ${ref ? `<div class="pw-num"><span>${escHTML(ref.rotulo)}</span><b>${pwR(ref.valor)}</b></div>` : ''}${comparar}
    </div>
    ${pw.aviso ? `<div class="pw-aviso">⚠️ ${escHTML(pw.aviso)}</div>` : ''}
    <div class="pw-filtros">
      ${pwSeletorRegiao()}
      <div class="ca-alternar">${pw.chaves.modelo ? botao('modelo', 'Mesmo modelo') + (pw.chaves.cor ? botao('cor', 'Modelo e cor') : '') : ''}${botao('todos', 'Todos')}</div>
      <a class="tv-link" href="https://www.google.com/search?tbm=shop&q=${encodeURIComponent(pw.termo)}" target="_blank" rel="noopener noreferrer">abrir no Google Shopping ↗</a>
    </div>
    ${lista.length ? `<div class="pw-lista">${lista.map(x => `
      <a class="pw-item" href="${escHTML(x.link)}" target="_blank" rel="noopener noreferrer">
        <div class="pw-img">${x.imagem ? `<img src="${escHTML(x.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '🕶️'}</div>
        <div class="pw-info">
          <div class="pw-titulo">${escHTML(x.titulo)}</div>
          <div class="pw-loja">🏪 ${escHTML(x.loja || 'loja não informada')}${x.entrega ? ` · ${escHTML(x.entrega)}` : ''}</div>
          <div class="pw-tags">${x.confere.modelo && pw.chaves.modelo ? '<span class="pw-tag ok">modelo ✓</span>' : ''}${x.confere.cor ? '<span class="pw-tag ok">cor ✓</span>' : ''}${x.confere.tamanho ? '<span class="pw-tag ok">aro ✓</span>' : ''}</div>
        </div>
        <div class="pw-preco">${pwR(x.preco)}${ref ? `<small>${x.preco >= ref.valor ? '+' : ''}${((x.preco / ref.valor - 1) * 100).toFixed(0)}% vs ${escHTML(ref.rotulo.toLowerCase())}</small>` : ''}</div>
      </a>`).join('')}</div>`
      : `<div class="pw-aguarde">Nenhum anúncio ${pw.filtro === 'todos' ? '' : 'com o mesmo modelo '}encontrado.${pw.filtro !== 'todos' && conta.todos ? ' Veja "Todos" para resultados parecidos.' : ''}</div>`}
    <p class="pw-rodape">Fonte: Google Shopping Brasil${pw.regiao ? ` · região ${escHTML(pwRotuloRegiao(pw.regiao))} (o Google mostra primeiro anúncios e lojas dessa cidade; loja física só aparece se anuncia no Google)` : ''} · preços dos anúncios no momento da pesquisa${pw.quando ? ' (' + new Date(pw.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + ')' : ''}. Confira o anúncio antes de usar o preço.</p>`;
}

/** Botão 🛒 que abre o modal (para pôr ao lado da lupa). */
function botaoPrecoWeb(p, ref) {
  const termo = typeof termoBuscaProduto === 'function' ? termoBuscaProduto(p) : String(p.descricao || '');
  if (!termo) return '';
  const attrRef = ref && ref.valor > 0 ? ` data-ref="${Number(ref.valor).toFixed(2)}" data-ref-rotulo="${escHTML(ref.rotulo)}"` : '';
  return `<button type="button" class="link-preco link-preco-web" data-termo="${escHTML(termo)}"${attrRef}
    onclick="event.stopPropagation(); abrirPesquisaPreco(this)" title="Pesquisar o preço desta peça na web aqui mesmo (loja, preço e imagem)">🛒</button>`;
}
