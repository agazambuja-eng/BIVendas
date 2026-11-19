/**
 * Aba Avaliação de Produtos · "Estoque encalhado" pelo painel do SavWin.
 *
 * O servidor do BI entra no SavWin com o login que um gestor informa aqui
 * (só a chave de sessão fica em memória no servidor) e busca o painel
 * Dashboard Gestor · Estoque, apenas das lojas liberadas para quem está no BI.
 */

const ep = {
  situacao: null,
  dados: null,
  carregando: false,
  meses: 12,
  tipo: 'A',
  loja: '',
  busca: '',
  visao: 'grife',
  ordem: { campo: 'ordem', desc: false },
  mostrar: 100,
  detalhes: {},          // chave da grife -> { carregando, erro, linhas, mostrar }
  precos: {},            // código do produto -> { venda, promocao, modelo, cor, tamanho, linha } | null (sem cadastro)
  ultimaTabela: null,
  barra: { inicio: 0, t0: 0, timer: null }
};

const TIPOS_EP = { A: 'Armações', L: 'Lentes', O: 'Outros', '': 'Todos os tipos' };

// ---------------------------------------------------------------- utilidades
const epPc = n => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const epR = n => formatarMoedaBR(Number(n) || 0);
const epN = (n, d = 1) => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });
const epId = s => String(s).replace(/[^A-Za-z0-9_-]/g, '_');

function epLojasDoUsuario() {
  const lista = (typeof lojasDisponiveis !== 'undefined' ? lojasDisponiveis : []);
  return lista.map(l => String(l.id).replace(/\D/g, '')).filter(Boolean);
}
function epLojasPedido() { return ep.loja ? ep.loja : epLojasDoUsuario().join(','); }
function epNomeLoja(id) {
  const n = typeof nomeLojaComparar === 'function' ? nomeLojaComparar(id).nome : '';
  return n ? `${id} · ${n}` : `Loja ${id}`;
}
function epStatus(html) {
  const el = document.getElementById('epStatus');
  if (!el) return;
  el.innerHTML = html || '';
  el.style.display = html ? '' : 'none';
}

async function epPost(url, corpo) {
  const resp = await fetchAutenticado(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {})
  });
  const j = await resp.json().catch(() => ({}));
  return { status: resp.status, ok: resp.ok, j };
}

// ---------------------------------------------------------------- conexão
async function epCarregarSituacao() {
  const r = await epPost('/savwin/situacao');
  ep.situacao = r.ok ? r.j : { conectado: false };
  epDesenharConexao();
}

function epDesenharConexao() {
  const s = ep.situacao || { conectado: false };
  const gestor = typeof temPermissao === 'function' && temPermissao('gerenciar_usuarios');
  const caixa = document.getElementById('epConexao');
  const form = document.getElementById('epFormConectar');
  const btn = document.getElementById('epBtnCarregar');
  if (!caixa) return;
  if (s.conectado) {
    const quando = s.conectadoEm ? new Date(s.conectadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    caixa.innerHTML = `<span class="ep-ponto ep-on"></span> Conectado ao SavWin · usuário <b>${escHTML(s.usuarioSavwin || '')}</b>
      ${s.conectadoPor ? ` · por ${escHTML(s.conectadoPor)}` : ''}${quando ? ` em ${quando}` : ''}
      ${gestor ? ' <button type="button" class="tv-link" onclick="epDesconectar()">Desconectar</button>' : ''}`;
    form.style.display = 'none';
    btn.style.display = '';
  } else {
    caixa.innerHTML = `<span class="ep-ponto"></span> BI não conectado ao SavWin.` +
      (gestor ? ' Informe o acesso abaixo. A senha é usada só para entrar e não fica gravada.'
              : ' Peça a um gestor (quem gerencia usuários) para conectar.');
    form.style.display = gestor ? '' : 'none';
    btn.style.display = 'none';
  }
}

async function epConectar(ev) {
  if (ev) ev.preventDefault();
  const id = document.getElementById('epIdentificador');
  const lg = document.getElementById('epLogin');
  const sn = document.getElementById('epSenha');
  const msg = document.getElementById('epMsgConectar');
  const bt = document.getElementById('epBtnConectar');
  msg.textContent = '';
  bt.disabled = true; bt.textContent = 'Conectando...';
  try {
    const r = await epPost('/savwin/conectar', { identificador: id.value, login: lg.value, senha: sn.value });
    if (!r.ok) throw new Error(r.j.error || `Erro ${r.status}`);
    ep.situacao = r.j;
    sn.value = '';
    epDesenharConexao();
    epCarregar();
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    sn.value = '';
    bt.disabled = false; bt.textContent = 'Conectar SavWin';
  }
  return false;
}

async function epDesconectar() {
  await epPost('/savwin/desconectar');
  ep.situacao = { conectado: false };
  ep.dados = null;
  document.getElementById('epConteudo').style.display = 'none';
  epDesenharConexao();
}

// ---------------------------------------------------------------- barra
function epBarra(ligar) {
  if (ep.barra.timer) clearInterval(ep.barra.timer);
  ep.barra.timer = null;
  if (!ligar) return;
  ep.barra.inicio = Date.now();
  const desenhar = () => {
    const t = (Date.now() - ep.barra.inicio) / 1000;
    const pct = Math.min(97, 100 * (1 - Math.exp(-t / 30)));
    epStatus(`<div class="ee-progresso-topo"><span>⏳ Buscando o painel de estoque no SavWin (cerca de 40 s)</span><span>${Math.floor(pct)}% · ${Math.round(t)} s</span></div>
      <div class="ee-progresso"><i style="width:${pct.toFixed(1)}%"></i></div>`);
  };
  desenhar();
  ep.barra.timer = setInterval(desenhar, 250);
}

// ---------------------------------------------------------------- carregar
async function epCarregar(atualizar = false) {
  if (ep.carregando) return;
  ep.carregando = true;
  const btn = document.getElementById('epBtnCarregar');
  if (btn) btn.disabled = true;
  epBarra(true);
  try {
    const limite = Date.now() + 10 * 60 * 1000;
    let forcar = atualizar === true;
    for (;;) {
      const r = await epPost('/savwin/estoque', { LOJAS: epLojasPedido(), MESES: ep.meses, ATUALIZAR: forcar });
      forcar = false;
      if (r.status === 202) {
        if (Date.now() > limite) throw new Error('O SavWin passou de 10 minutos sem responder.');
        await new Promise(ok => setTimeout(ok, 3000));
        continue;
      }
      if (r.status === 409) { ep.situacao = { conectado: false }; epDesenharConexao(); throw new Error(r.j.error || 'Conecte o SavWin.'); }
      if (!r.ok) throw new Error(r.j.error || (r.status >= 502 ? `O servidor reiniciou ou não respondeu (erro ${r.status}). Tente de novo.` : `Erro ${r.status}`));
      ep.dados = r.j;
      break;
    }
    ep.detalhes = {};
    epBarra(false);
    epStatus('');
    document.getElementById('epConteudo').style.display = '';
    epRenderizar();
  } catch (e) {
    epBarra(false);
    epStatus(`⚠️ ${escHTML(e.message)}`);
  } finally {
    ep.carregando = false;
    if (btn) { btn.disabled = false; btn.textContent = '↻ Atualizar estoque'; }
  }
}

function epMudar(campo, valor) {
  ep[campo] = valor;
  ep.mostrar = 100;
  if (campo === 'meses' || campo === 'loja') return epCarregar();
  epRenderizarTabela();
}
function epVisao(v) {
  ep.visao = v; ep.mostrar = 100;
  ep.ordem = v === 'grife' ? { campo: 'ordem', desc: false } : { campo: 'Custo', desc: true };
  document.querySelectorAll('#epVisoes button').forEach(b => b.classList.toggle('ativo', b.dataset.v === v));
  epRenderizarTabela();
}
function epOrdenar(campo) {
  ep.ordem = ep.ordem.campo === campo ? { campo, desc: !ep.ordem.desc } : { campo, desc: !['Descricao', 'ordem'].includes(campo) };
  epRenderizarTabela();
}

// ---------------------------------------------------------------- tela
function epPreencherLojas() {
  const sel = document.getElementById('epLoja');
  if (!sel || sel.dataset.ok) return;
  sel.innerHTML = '<option value="">Todas as minhas lojas</option>' +
    epLojasDoUsuario().sort((a, b) => Number(a) - Number(b)).map(l => `<option value="${l}">${escHTML(epNomeLoja(l))}</option>`).join('');
  sel.dataset.ok = '1';
}

function epRenderizar() {
  const d = ep.dados;
  if (!d) return;
  epPreencherLojas();
  const r = d.Resumo || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
  set('epCardPecas', epPc(r.Pecas));
  set('epCardCusto', d.CustoLiberado === false ? '—' : epR(r.Custo));
  set('epCardProdutos', epN(r.Produtos, 0));
  set('epCardLojas', epN(r.Lojas, 0));
  set('epCardGiro', `${epPc(r.GiroMensal)}<small>peças/mês · ${epPc(r.VendidoNaJanela)} em ${d.meses} meses</small>`);
  set('epCardCob', `${epN(r.MesesCobertura, 2)}<small>meses de estoque</small>`);
  set('epCardDias', `${epN(r.DiasEmEstoque, 0)}<small>dias em estoque (média)</small>`);
  const quando = d.quando ? new Date(d.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  set('epInfo', `Painel SavWin de ${quando} · giro dos últimos ${d.meses} meses · ${ep.loja ? escHTML(epNomeLoja(ep.loja)) : 'todas as suas lojas'}` +
    (r.PecasSemCusto ? ` · ${epPc(r.PecasSemCusto)} peças sem custo cadastrado` : ''));
  set('epTipos', (d.PorTipo || []).map(t => `<span class="ep-chip-tipo"><b>${escHTML(t.Descricao)}</b> ${epPc(t.Qtde)} pç · ${d.CustoLiberado === false ? '' : epR(t.Custo)}</span>`).join(''));
  epRenderizarTabela();
}

function epGrifesDoTipo() {
  if (!ep.tipo) return null;
  const set = new Set();
  (ep.dados.TipoGrife || []).forEach(t => { const [tp, g] = String(t.Chave).split('|'); if (tp === ep.tipo) set.add(g); });
  return set;
}

function epOrdenarLista(lista) {
  const { campo, desc } = ep.ordem;
  return lista.sort((a, b) => {
    let A = a[campo], B = b[campo];
    if (campo === 'parado') { A = a.UltimaVenda ? a.DiasSemVender : 1e9; B = b.UltimaVenda ? b.DiasSemVender : 1e9; }
    if (campo === 'MesesCobertura') { A = a.GiroMensal > 0 ? a.MesesCobertura : 1e9; B = b.GiroMensal > 0 ? b.MesesCobertura : 1e9; }
    const r = typeof A === 'string' ? String(A).localeCompare(String(B), 'pt-BR') : (Number(A) || 0) - (Number(B) || 0);
    return desc ? -r : r;
  });
}
function epTh(campo, rotulo, cls = 'num') {
  const seta = ep.ordem.campo === campo ? (ep.ordem.desc ? ' ▼' : ' ▲') : '';
  return `<th class="${cls} ee-ordenavel" onclick="epOrdenar('${campo}')">${rotulo}${seta}</th>`;
}

function epRenderizarTabela() {
  const alvo = document.getElementById('epTabela');
  if (!alvo || !ep.dados) return;
  const custoOk = ep.dados.CustoLiberado !== false;
  const busca = ep.busca.trim().toUpperCase();
  const casa = x => !busca || String(x.Descricao || '').toUpperCase().includes(busca);
  const mais = (total, vis) => total > vis ? `<button type="button" class="tv-link" onclick="ep.mostrar += 100; epRenderizarTabela()">Mostrar mais (${total - vis} restantes)</button>` : '';

  if (ep.visao === 'grife') {
    const doTipo = epGrifesDoTipo();
    let lista = (ep.dados.Cobertura || []).map((g, i) => ({ ...g, ordem: i }))
      .filter(g => (!doTipo || doTipo.has(String(g.Chave))) && casa(g));
    epOrdenarLista(lista);
    const vis = lista.slice(0, ep.mostrar);
    const nunca = lista.filter(g => !g.UltimaVenda);
    alvo.innerHTML = `
      <p class="lf-ajuda"><b>${lista.length}</b> grifes${ep.tipo ? ' de ' + TIPOS_EP[ep.tipo].toLowerCase() : ''}, da mais parada para a que mais gira ·
        <b>${nunca.length}</b> sem venda em ${ep.dados.meses} meses (${epPc(nunca.reduce((s, g) => s + g.Qtde, 0))} peças${custoOk ? ' · ' + epR(nunca.reduce((s, g) => s + g.Custo, 0)) : ''}). Clique numa grife para ver os produtos por loja.</p>
      <div class="ee-tabela-rolagem"><table class="la-tabela ee-tabela">
        <thead><tr>${epTh('Descricao', 'Grife', 'ee-nome')}${epTh('Qtde', 'Peças')}${epTh('Produtos', 'Produtos')}${epTh('GiroMensal', 'Giro mensal')}${epTh('parado', 'Parado há')}${epTh('MesesCobertura', 'Cobertura (meses)')}${custoOk ? epTh('Custo', 'Custo') : ''}${epTh('DiasEmEstoque', 'Dias em estoque')}</tr></thead>
        <tbody>${vis.map(g => {
          const aberto = ep.detalhes[g.Chave] && ep.detalhes[g.Chave].aberto;
          const parado = g.UltimaVenda ? `${epN(g.DiasSemVender, 0)} d <small>últ. ${escHTML(g.UltimaVenda)}</small>` : '<span class="ee-enc">nunca vendeu</span>';
          return `<tr class="ee-prod" onclick="epAbrirGrife('${escHTML(String(g.Chave))}')">
            <td class="ee-nome"><span class="la-seta">${aberto ? '▾' : '▸'}</span> ${escHTML(g.Descricao)}</td>
            <td class="num">${epPc(g.Qtde)}</td><td class="num">${epN(g.Produtos, 0)}</td><td class="num">${epPc(g.GiroMensal)}</td>
            <td class="num">${parado}</td>
            <td class="num">${g.GiroMensal > 0 ? epN(g.MesesCobertura, 1) : '<span class="ee-sem-giro">sem giro</span>'}</td>
            ${custoOk ? `<td class="num">${epR(g.Custo)}</td>` : ''}<td class="num">${epN(g.DiasEmEstoque, 0)}</td></tr>
            ${aberto ? `<tr class="ep-det"><td colspan="${custoOk ? 8 : 7}" id="epDet_${epId(g.Chave)}">${epHtmlDetalhe(g.Chave)}</td></tr>` : ''}`;
        }).join('')}</tbody>
      </table></div>${mais(lista.length, vis.length)}`;
    ep.ultimaTabela = {
      nome: 'estoque_encalhado_grifes',
      cab: ['Grife', 'Pecas', 'Produtos', 'Giro mensal', 'Ultima venda', 'Dias sem vender', 'Cobertura (meses)', 'Custo', 'Dias em estoque'],
      linhas: lista.map(g => [g.Descricao, g.Qtde, g.Produtos, g.GiroMensal, g.UltimaVenda || 'nunca', g.UltimaVenda ? g.DiasSemVender : '', g.GiroMensal > 0 ? g.MesesCobertura : '', custoOk ? g.Custo : '', g.DiasEmEstoque])
    };
    return;
  }

  const fonte = { loja: 'PorLoja', fornecedor: 'PorFornecedor', tipo: 'PorTipo' }[ep.visao];
  const rotulo = { loja: 'Loja', fornecedor: 'Fornecedor', tipo: 'Tipo' }[ep.visao];
  const lista = epOrdenarLista((ep.dados[fonte] || []).filter(casa).map(x => ({ ...x })));
  const vis = lista.slice(0, ep.mostrar);
  alvo.innerHTML = `
    <div class="ee-tabela-rolagem"><table class="la-tabela ee-tabela">
      <thead><tr>${epTh('Descricao', rotulo, 'ee-nome')}${epTh('Qtde', 'Peças')}${epTh('Produtos', 'Produtos')}${custoOk ? epTh('Custo', 'Custo') : ''}${epTh('ParticipacaoPerc', '% das peças')}${epTh('DiasEmEstoque', 'Dias em estoque')}${epTh('PecasSemDataEntrada', 'Sem data de entrada')}</tr></thead>
      <tbody>${vis.map(x => `<tr><td class="ee-nome">${escHTML(x.Descricao)}</td><td class="num">${epPc(x.Qtde)}</td><td class="num">${epN(x.Produtos, 0)}</td>
        ${custoOk ? `<td class="num">${epR(x.Custo)}</td>` : ''}<td class="num">${epN(x.ParticipacaoPerc, 2)}%</td><td class="num">${epN(x.DiasEmEstoque, 0)}</td><td class="num">${epPc(x.PecasSemDataEntrada)}</td></tr>`).join('')}</tbody>
    </table></div>${mais(lista.length, vis.length)}`;
  ep.ultimaTabela = {
    nome: `estoque_por_${ep.visao}`,
    cab: [rotulo, 'Pecas', 'Produtos', 'Custo', '% das pecas', 'Dias em estoque', 'Sem data de entrada'],
    linhas: lista.map(x => [x.Descricao, x.Qtde, x.Produtos, custoOk ? x.Custo : '', x.ParticipacaoPerc, x.DiasEmEstoque, x.PecasSemDataEntrada])
  };
}

// ---------------------------------------------------------------- detalhe da grife
async function epAbrirGrife(chave) {
  const det = ep.detalhes[chave] || (ep.detalhes[chave] = { aberto: false, mostrar: 60 });
  det.aberto = !det.aberto;
  epRenderizarTabela();
  if (!det.aberto || det.linhas || det.carregando) return;
  det.carregando = true; det.erro = '';
  epAtualizarDetalhe(chave);
  try {
    const r = await epPost('/savwin/estoque/detalhe', { CHAVE: chave, LOJAS: epLojasPedido(), MESES: ep.meses });
    if (r.status === 409) { ep.situacao = { conectado: false }; epDesenharConexao(); }
    if (!r.ok) throw new Error(r.j.error || `Erro ${r.status}`);
    det.linhas = r.j.linhas || [];
    det.limitado = r.j.limitado;
  } catch (e) { det.erro = e.message; }
  det.carregando = false;
  epAtualizarDetalhe(chave);
  epCarregarPrecos(chave);
}

const epCodigo = c => String(c || '').replace(/\D/g, '').replace(/^0+/, '');

/** Produtos da grife aberta (somados entre as lojas), do maior custo para o menor. */
function epProdutosDaGrife(det) {
  const porProd = new Map();
  (det.linhas || []).forEach(l => {
    const k = l.codigo || l.produto;
    let p = porProd.get(k);
    if (!p) { p = { produto: l.produto, codigo: l.codigo, tipo: l.tipo, pecas: 0, custo: 0, lojas: [], entrada: null }; porProd.set(k, p); }
    p.pecas += l.pecas; p.custo += l.custo; p.lojas.push(l);
    const d = epData(l.data);
    if (d && (!p.entrada || d > p.entrada)) p.entrada = d;   // entrada mais recente entre as lojas
  });
  return [...porProd.values()].sort((a, b) => b.custo - a.custo || b.pecas - a.pecas);
}

/** Preço de venda/promoção (Consulta Preço Estoque do SavWin) dos produtos visíveis da grife. */
async function epCarregarPrecos(chave) {
  const det = ep.detalhes[chave];
  if (!det || !det.linhas) return;
  const codigos = epProdutosDaGrife(det).slice(0, det.mostrar).map(p => epCodigo(p.codigo))
    .filter(c => c && !(c in ep.precos));
  if (!codigos.length) return;
  codigos.forEach(c => { ep.precos[c] = undefined; });   // marca "buscando"
  for (let i = 0; i < codigos.length; i += 80) {
    const lote = codigos.slice(i, i + 80);
    try {
      const r = await epPost('/savwin/precos', { CODIGOS: lote });
      if (!r.ok) throw new Error(r.j.error || `Erro ${r.status}`);
      lote.forEach(c => { ep.precos[c] = r.j.precos[c] || null; });
    } catch (e) {
      lote.forEach(c => { delete ep.precos[c]; });
      det.erroPrecos = e.message;
    }
  }
  epAtualizarDetalhe(chave);
}
function epAtualizarDetalhe(chave) {
  const el = document.getElementById('epDet_' + epId(chave));
  if (el) el.innerHTML = epHtmlDetalhe(chave);
}
function epMaisDetalhe(chave) { ep.detalhes[chave].mostrar += 60; epAtualizarDetalhe(chave); epCarregarPrecos(chave); }

/** "dd/mm/aaaa" -> Date (ou null). */
function epData(t) {
  const m = String(t || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}
function epDiasDesde(d) {
  if (!d) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((hoje - d) / 86400000));
}
const epDataCurta = d => d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}` : '';

function epPrecoDe(p) { const c = epCodigo(p.codigo); return c ? ep.precos[c] : null; }

function epHtmlDetalhe(chave) {
  const det = ep.detalhes[chave] || {};
  if (det.carregando) return '<div class="ep-det-corpo">⏳ Buscando produtos e lojas no SavWin...</div>';
  if (det.erro) return `<div class="ep-det-corpo">⚠️ ${escHTML(det.erro)}</div>`;
  if (!det.linhas) return '';
  const custoOk = ep.dados.CustoLiberado !== false;
  const lista = epProdutosDaGrife(det);
  const vis = lista.slice(0, det.mostrar);
  const grife = ((ep.dados.Cobertura || []).find(g => String(g.Chave) === String(chave)) || {}).Descricao || '';
  const lupa = p => typeof linkImagemProduto === 'function'
    ? ` <a class="la-lupa" href="${linkImagemProduto({ descricao: p.produto, grife })}" target="_blank" rel="noopener noreferrer" title="Ver imagens deste produto na internet (Google Imagens)" onclick="event.stopPropagation()">🔍</a>${linksPrecoProduto({ descricao: p.produto, grife, corNome: (epPrecoDe(p) || {}).cor, modeloSavwin: (epPrecoDe(p) || {}).modelo }, [
      epPrecoDe(p) && epPrecoDe(p).venda ? { valor: epPrecoDe(p).promocao || epPrecoDe(p).venda, rotulo: epPrecoDe(p).promocao ? 'Nossa promoção' : 'Nosso preço de venda' } : null,
      p.pecas ? { valor: p.custo / p.pecas, rotulo: 'Nosso custo' } : null].filter(Boolean))}` : '';
  const venda = p => {
    const pr = epPrecoDe(p);
    if (pr === undefined) return '<small class="ep-venda">venda: buscando…</small>';
    if (!pr || !pr.venda) return '<small class="ep-venda ee-sem-giro">sem preço de venda</small>';
    const custoUn = p.pecas ? p.custo / p.pecas : 0;
    const efetivo = pr.promocao > 0 ? pr.promocao : pr.venda;
    const mk = custoUn > 0 ? efetivo / custoUn : 0;
    return `<small class="ep-venda">venda <b>${epR(pr.venda)}</b>${pr.promocao > 0 ? ` · promo <b class="ep-promo">${epR(pr.promocao)}</b>` : ''}${mk ? ` · markup <b class="${mk < 2 ? 'ee-enc' : ''}">${mk.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×</b>` : ''}</small>`;
  };
  const entrada = p => {
    if (!p.entrada) return '<span class="ee-sem-giro">sem data de entrada</span>';
    const dias = epDiasDesde(p.entrada);
    return `últ. entrada ${p.entrada.toLocaleDateString('pt-BR')} <b class="${dias > 365 ? 'ee-enc' : ''}">(${dias.toLocaleString('pt-BR')} d)</b>`;
  };
  return `<div class="ep-det-corpo">
    <div class="ep-det-cab">${lista.length} produtos em estoque${det.limitado ? ' (o SavWin limitou a lista)' : ''} · em cada loja: peças · data da última entrada (compra ou transferência) · 🔍 imagens · 💲 Google Shopping · ML Mercado Livre · 🤖 pesquisa de preço com IA · venda/promo do cadastro do SavWin${det.erroPrecos ? ` <span class="ee-enc">(preços: ${escHTML(det.erroPrecos)})</span>` : ''}</div>
    ${vis.map(p => `<div class="ep-det-prod">
      <div class="ep-det-nome">${escHTML(p.produto)}${lupa(p)}<small>${escHTML([p.codigo && 'cód. ' + p.codigo, p.tipo].filter(Boolean).join(' · '))}</small></div>
      <div class="ep-det-num">${epPc(p.pecas)} pç${custoOk ? ` · custo ${epR(p.custo)}${p.pecas > 1 ? ` <small class="ep-un">(${epR(p.custo / p.pecas)} un.)</small>` : ''}` : ''}${venda(p)}<small>${entrada(p)}</small></div>
      <div class="ep-det-lojas">${p.lojas.sort((a, b) => b.pecas - a.pecas).map(l => `<span class="ee-chip ee-chip-parado" title="${escHTML(l.loja)}${l.data ? ' · última entrada ' + escHTML(l.data) : ''}">${escHTML(String(l.loja).replace(/\s*-\s*OTIC\w*\s*/i, ' '))} · ${epPc(l.pecas)}${epData(l.data) ? ' · ' + epDataCurta(epData(l.data)) : ''}</span>`).join('')}</div>
    </div>`).join('')}
    ${lista.length > vis.length ? `<button type="button" class="tv-link" onclick="event.stopPropagation(); epMaisDetalhe('${escHTML(String(chave))}')">Mostrar mais (${lista.length - vis.length})</button>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- exportar
function epExportar() {
  const t = ep.ultimaTabela;
  if (!t) return;
  const cel = v => typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [t.cab.map(cel).join(';'), ...t.linhas.map(l => l.map(cel).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${t.nome}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// situação da conexão quando o BI abre (depois do login do BI)
document.addEventListener('DOMContentLoaded', () => {
  const tentar = (n = 0) => {
    if (typeof perfilAtual !== 'undefined' && perfilAtual) return epCarregarSituacao().catch(() => {});
    if (n < 40) setTimeout(() => tentar(n + 1), 250);
  };
  tentar();
});
