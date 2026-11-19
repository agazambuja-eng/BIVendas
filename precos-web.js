/**
 * Pesquisa de preço da mesma peça na web com IA (Gemini + pesquisa Google).
 *
 * Configuração no Render (Environment):
 *   GEMINI_API_KEY      chave do Google AI Studio (obrigatória)
 *   GEMINI_MODEL        opcional; padrão gemini-3.6-flash
 *   PRECOS_LIMITE_MES   opcional; máximo de pesquisas por mês (padrão 500)
 * A chave nunca vai para o navegador.
 *
 * Como funciona:
 *  1. o Gemini pesquisa no Google (ferramenta google_search) e devolve as ofertas
 *     em JSON: loja, local (cidade/bairro ou online), preço, link;
 *  2. o servidor abre a página de cada oferta para pegar a foto e conferir o preço
 *     (a IA não traz foto confiável e pode errar o preço);
 *  3. cache de 24 h por peça e região.
 */

const MODELO = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const URL_GEMINI = () => process.env.GEMINI_URL || `https://generativelanguage.googleapis.com/v1beta/models/${MODELO()}:generateContent`;
const VALIDADE_MS = 24 * 60 * 60 * 1000;
const cache = new Map();                 // nome|regiao -> { quando, resultado }
const uso = { mes: '', pesquisas: 0 };   // contador do mês (em memória)

// ------------------------------------------------------------- utilidades
/** "R$ 1.234,56" / "1.234" / "1,234.56" / 1234.5 -> número. */
function precoNumero(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v || '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  const iv = s.lastIndexOf(','), ip = s.lastIndexOf('.');
  if (iv > ip) s = s.replace(/\./g, '').replace(',', '.');          // 1.234,56 (Brasil)
  else if (ip > iv && iv >= 0) s = s.replace(/,/g, '');             // 1,234.56
  else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, '');            // 1.234
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function mesAtual() { return new Date().toISOString().slice(0, 7); }
function limiteMes() { const n = Number(process.env.PRECOS_LIMITE_MES); return n > 0 ? n : 500; }
function situacaoUso() {
  if (uso.mes !== mesAtual()) { uso.mes = mesAtual(); uso.pesquisas = 0; }
  return { usadas: uso.pesquisas, limite: limiteMes() };
}

/** Só endereços públicos https (evita que um link da IA aponte para a rede interna). */
function urlSegura(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return false;
    const h = x.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return false;
    return true;
  } catch { return false; }
}

/** Primeiro objeto JSON do texto da IA (aceita ```json ... ```). */
function jsonDoTexto(texto) {
  const t = String(texto || '').replace(/```(?:json)?/gi, '');
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}

// ------------------------------------------------------------- IA
function montarPedido(nome, termo, chaves, regiao) {
  const partes = [
    'Você pesquisa preços para uma rede de óticas no Brasil.',
    `Pesquise no Google ofertas ATUAIS da peça: "${nome}".`,
    chaves.modelo ? `Código do modelo: ${chaves.modelo}.` : '',
    chaves.modeloSavwin ? `Modelo no cadastro: ${chaves.modeloSavwin}.` : '',
    chaves.cor ? `Código da cor: ${chaves.cor}.` : '',
    chaves.corNome ? `Cor: ${chaves.corNome}.` : '',
    chaves.tamanho ? `Aro/tamanho: ${chaves.tamanho}.` : '',
    `Termo de busca sugerido: "${termo}".`,
    regiao
      ? `Região: ${regiao}. Primeiro procure óticas e lojas físicas dessa cidade que vendam a peça (nome da loja e bairro ou endereço); depois lojas online que entregam lá.`
      : 'Considere lojas online do Brasil (Mercado Livre, Amazon, sites de óticas e da marca).',
    'Regras:',
    '- Só produto novo e original, do mesmo código de modelo (a cor pode variar, diga qual é).',
    '- NÃO invente preço, loja nem link: inclua apenas ofertas que aparecem nos resultados da pesquisa, com preço em reais.',
    '- "url" deve ser o link da página da oferta. Se não tiver certeza, deixe vazio.',
    '- Se não encontrar nada, devolva "ofertas": [].',
    'Responda SOMENTE com JSON, sem texto fora dele, neste formato:',
    '{"ofertas":[{"loja":"nome da loja","local":"cidade/bairro ou \\"online\\"","tipo":"online ou loja física","titulo":"nome do produto no anúncio","cor":"cor do anúncio","preco":0,"url":"https://...","observacao":"ex.: à vista, parcelado, frete"}],"resumo":"uma frase sobre os preços encontrados"}',
    'No máximo 12 ofertas, do menor para o maior preço.'
  ];
  return partes.filter(Boolean).join('\n');
}

async function perguntarGemini(texto) {
  const chave = String(process.env.GEMINI_API_KEY || '').trim();
  const resp = await fetch(URL_GEMINI(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: texto }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2 }
    }),
    signal: AbortSignal.timeout(90000)
  });
  const corpo = await resp.text();
  if (resp.status === 400 && /API key/i.test(corpo)) throw Object.assign(new Error('Chave do Gemini inválida (GEMINI_API_KEY).'), { http: 502 });
  if (resp.status === 401 || resp.status === 403) throw Object.assign(new Error('Chave do Gemini sem permissão (GEMINI_API_KEY).'), { http: 502 });
  if (resp.status === 404) throw Object.assign(new Error(`Modelo "${MODELO()}" não encontrado no Gemini. Ajuste GEMINI_MODEL no Render.`), { http: 502 });
  if (resp.status === 429) throw Object.assign(new Error('Limite do Gemini atingido. Tente mais tarde.'), { http: 429 });
  if (!resp.ok) throw Object.assign(new Error(`Gemini respondeu ${resp.status}: ${corpo.slice(0, 200)}`), { http: 502 });
  const j = JSON.parse(corpo);
  const cand = (j.candidates || [])[0] || {};
  const textoResp = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
  const meta = cand.groundingMetadata || {};
  const fontes = (meta.groundingChunks || []).map(c => c.web).filter(Boolean).map(w => ({ titulo: w.title || '', url: w.uri || '' }));
  return { textoResp, fontes, consultas: meta.webSearchQueries || [] };
}

// ------------------------------------------------------------- página da oferta
function metaConteudo(html, nome) {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${nome}["'][^>]*>`, 'i');
  const tag = (html.match(re) || [])[0] || '';
  const m = tag.match(/content=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

/** Abre a página e tenta achar foto, título e preço (og:image, JSON-LD, meta de produto). */
async function lerPagina(url) {
  if (!urlSegura(url)) return null;
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok || !urlSegura(resp.url)) return { urlFinal: resp.url || url };
    return { urlFinal: resp.url, ...extrairDaPagina((await resp.text()).slice(0, 1500000), resp.url) };
  } catch { return null; }
}

/** Foto, título e preço de uma página de produto (og:image, meta de produto, JSON-LD). */
function extrairDaPagina(html, urlBase) {
  {
    let imagem = metaConteudo(html, 'og:image') || metaConteudo(html, 'twitter:image');
    const titulo = metaConteudo(html, 'og:title') || ((html.match(/<title[^>]*>([^<]{3,200})<\/title>/i) || [])[1] || '').trim();
    let preco = precoNumero(metaConteudo(html, 'product:price:amount') || metaConteudo(html, 'og:price:amount') || metaConteudo(html, 'price'));
    if (!preco || !imagem) {
      for (const bloco of html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []) {
        try {
          const dados = JSON.parse(bloco.replace(/<\/?script[^>]*>/gi, ''));
          const lista = [].concat(dados['@graph'] || dados);
          const prod = lista.find(x => x && /Product/i.test([].concat(x['@type'] || '').join(',')));
          if (!prod) continue;
          const oferta = [].concat(prod.offers || [])[0] || {};
          if (!preco) preco = precoNumero(oferta.price || oferta.lowPrice || (oferta.priceSpecification || {}).price);
          if (!imagem) imagem = [].concat(prod.image || [])[0];
          if (imagem && typeof imagem === 'object') imagem = imagem.url || '';
          break;
        } catch { /* JSON-LD inválido: ignora */ }
      }
    }
    if (imagem && imagem.startsWith('//')) imagem = 'https:' + imagem;
    if (imagem && imagem.startsWith('/')) imagem = new URL(imagem, urlBase).href;
    return { imagem: urlSegura(imagem) ? imagem : '', tituloPagina: titulo, precoPagina: preco };
  }
}

// ------------------------------------------------------------- pesquisa
async function pesquisarComIA({ nome, termo, chaves, regiao }) {
  if (!String(process.env.GEMINI_API_KEY || '').trim()) {
    throw Object.assign(new Error('Pesquisa com IA não configurada: falta a variável GEMINI_API_KEY no Render.'), { http: 503 });
  }
  const k = `${nome.toUpperCase()}|${regiao}|${chaves.corNome || ''}`;
  const c = cache.get(k);
  if (c && Date.now() - c.quando < VALIDADE_MS) return { ...c.resultado, doCache: true, uso: situacaoUso() };
  const u = situacaoUso();
  if (u.usadas >= u.limite) throw Object.assign(new Error(`Limite de ${u.limite} pesquisas com IA neste mês atingido (PRECOS_LIMITE_MES).`), { http: 429 });
  const { textoResp, fontes, consultas } = await perguntarGemini(montarPedido(nome, termo, chaves, regiao));
  uso.pesquisas++;
  const json = jsonDoTexto(textoResp) || { ofertas: [] };
  let ofertas = (Array.isArray(json.ofertas) ? json.ofertas : []).slice(0, 12).map(o => ({
    loja: String(o.loja || '').slice(0, 80),
    local: String(o.local || '').slice(0, 120),
    tipo: /f[ií]sica/i.test(String(o.tipo || '')) ? 'loja física' : 'online',
    titulo: String(o.titulo || '').slice(0, 200),
    cor: String(o.cor || '').slice(0, 60),
    preco: precoNumero(o.preco),
    url: String(o.url || ''),
    observacao: String(o.observacao || '').slice(0, 160)
  })).filter(o => o.loja || o.titulo);

  // confere cada oferta na própria página (foto, título e preço), em paralelo
  const paginas = await Promise.all(ofertas.map(o => o.url ? lerPagina(o.url) : null));
  ofertas = ofertas.map((o, i) => {
    const p = paginas[i] || {};
    const precoPagina = p.precoPagina || 0;
    const confere = precoPagina > 0 && o.preco > 0 && Math.abs(precoPagina - o.preco) / o.preco <= 0.05;
    return {
      ...o,
      url: p.urlFinal && urlSegura(p.urlFinal) ? p.urlFinal : (urlSegura(o.url) ? o.url : ''),
      imagem: p.imagem || '',
      tituloPagina: p.tituloPagina || '',
      precoPagina,
      // preço da página manda quando existe; senão fica o informado pela IA
      preco: precoPagina > 0 ? precoPagina : o.preco,
      precoOrigem: precoPagina > 0 ? (confere ? 'conferido' : 'pagina') : 'ia'
    };
  }).filter(o => o.preco > 0);

  const resultado = {
    nome, termo, regiao, quando: new Date().toISOString(), modelo: MODELO(),
    resumo: String(json.resumo || '').slice(0, 300), ofertas, fontes: fontes.slice(0, 12), consultas
  };
  cache.set(k, { quando: Date.now(), resultado });
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return { ...resultado, uso: situacaoUso() };
}

function registrarRotaPrecos(app, { exigirUsuario }) {
  app.post('/precos/pesquisar', exigirUsuario('acessar_bi'), async (req, res) => {
    try {
      const b = req.body || {};
      const limpa = (v, n) => String(v || '').replace(/[\u0000-\u001f"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
      const nome = limpa(b.nome || b.termo, 150);
      if (nome.length < 3) return res.status(400).json({ error: 'Informe o produto a pesquisar.' });
      const chaves = { modelo: limpa(b.modelo, 30), cor: limpa(b.cor, 30), tamanho: limpa(b.tamanho, 10), corNome: limpa(b.corNome, 40), modeloSavwin: limpa(b.modeloSavwin, 40) };
      res.json(await pesquisarComIA({ nome, termo: limpa(b.termo || nome, 150), chaves, regiao: limpa(b.regiao, 80) }));
    } catch (err) {
      console.error('Erro na pesquisa de preços com IA:', err.message);
      res.status(err.http || 500).json({ error: err.message });
    }
  });
}

module.exports = { registrarRotaPrecos, precoNumero, jsonDoTexto, urlSegura, montarPedido, extrairDaPagina };
