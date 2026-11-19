/**
 * Pesquisa de preço da mesma peça na web (Google Shopping Brasil via Serper.dev).
 *
 * Precisa da variável SERPER_API_KEY no Render (conta grátis em serper.dev:
 * 2.500 buscas sem cartão). A chave nunca vai para o navegador.
 * Cada termo fica 24 h em cache para economizar buscas.
 */
const https = require('https');

const URL_SERPER = process.env.SERPER_URL || 'https://google.serper.dev/shopping';
const VALIDADE_MS = 24 * 60 * 60 * 1000;
const cache = new Map();   // termo -> { quando, resultado }

function postarSerper(corpo, chave) {
  return new Promise((ok, falha) => {
    const dados = Buffer.from(JSON.stringify(corpo));
    const req = https.request(URL_SERPER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': dados.length, 'X-API-KEY': chave }
    }, resp => {
      const partes = [];
      resp.on('data', c => partes.push(c));
      resp.on('end', () => ok({ status: resp.statusCode, texto: Buffer.concat(partes).toString('utf8') }));
      resp.on('error', falha);
    });
    req.setTimeout(30000, () => req.destroy(new Error('A pesquisa de preços não respondeu a tempo.')));
    req.on('error', falha);
    req.end(dados);
  });
}

/** "R$ 1.234,56" / "R$1.234" / "1,234.56" -> número. */
function precoNumero(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  const iv = s.lastIndexOf(','), ip = s.lastIndexOf('.');
  if (iv > ip) s = s.replace(/\./g, '').replace(',', '.');          // 1.234,56 (Brasil)
  else if (ip > iv && iv >= 0) s = s.replace(/,/g, '');               // 1,234.56
  else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, '');          // 1.234
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

async function pesquisarPrecos(termo, regiao) {
  const chave = String(process.env.SERPER_API_KEY || '').trim();
  if (!chave) throw Object.assign(new Error('Pesquisa de preços não configurada: falta a variável SERPER_API_KEY no Render.'), { http: 503 });
  const k = termo.toUpperCase() + '|' + (regiao || '');
  const c = cache.get(k);
  if (c && Date.now() - c.quando < VALIDADE_MS) return { ...c.resultado, doCache: true };

  const corpo = { q: termo, gl: 'br', hl: 'pt-br', num: 40 };
  if (regiao) corpo.location = regiao;            // ex.: "Maceio,State of Alagoas,Brazil" (como o Google escreve)
  let r = await postarSerper(corpo, chave);
  let aviso = '';
  if (regiao && r.status === 400) {               // região não reconhecida: pesquisa no Brasil todo
    delete corpo.location;
    r = await postarSerper(corpo, chave);
    aviso = `A região "${regiao}" não foi reconhecida; mostrando o Brasil todo.`;
  }
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Chave do Serper inválida (SERPER_API_KEY).'), { http: 502 });
  if (r.status === 429) throw Object.assign(new Error('Limite de buscas do Serper atingido. Tente mais tarde ou recarregue créditos.'), { http: 429 });
  if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`Serper respondeu ${r.status}: ${r.texto.slice(0, 150)}`), { http: 502 });
  const j = JSON.parse(r.texto);
  const itens = (j.shopping || []).map(x => ({
    titulo: x.title || '',
    loja: x.source || '',
    preco: precoNumero(x.price),
    precoTexto: x.price || '',
    imagem: x.imageUrl || '',
    link: x.link || '',
    entrega: x.delivery || '',
    nota: x.rating || null,
    avaliacoes: x.ratingCount || null
  })).filter(x => x.titulo && x.preco > 0);
  const resultado = { termo, regiao: aviso ? '' : (regiao || ''), aviso, quando: new Date().toISOString(), itens };
  cache.set(k, { quando: Date.now(), resultado });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return resultado;
}

function registrarRotaPrecos(app, { exigirUsuario }) {
  app.post('/precos/pesquisar', exigirUsuario('acessar_bi'), async (req, res) => {
    try {
      const termo = String((req.body && req.body.termo) || '').replace(/\s+/g, ' ').trim().slice(0, 150);
      if (termo.length < 3) return res.status(400).json({ error: 'Informe o produto a pesquisar.' });
      const regiao = String((req.body && req.body.regiao) || '').replace(/[^\p{L}\p{N} ,.'-]/gu, '').trim().slice(0, 80);
      res.json(await pesquisarPrecos(termo, regiao));
    } catch (err) {
      console.error('Erro na pesquisa de preços:', err.message);
      res.status(err.http || 500).json({ error: err.message });
    }
  });
}

module.exports = { registrarRotaPrecos, precoNumero };
