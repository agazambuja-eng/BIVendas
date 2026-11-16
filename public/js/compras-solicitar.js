/**
 * Solicitação (gerente): monta e envia o pedido da loja e acompanha as
 * solicitações até a entrega. O rascunho fica guardado neste navegador.
 */

let catalogoAtivo = [];
let lojasUsuario = [];
let itensPedido = [];           // [{produto_id, codigo, nome, unidade, qtd, obs}]
let produtoEscolhido = null;
let pedidosMeus = [];
let filtroMeus = 'todos';
const abertosMeus = new Set();

const chaveRascunho = () => 'compras_rascunho_' + (perfilAtual ? perfilAtual.id : '');

function numeroDigitado(t) {
  const s = String(t || '').trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

// ---------------------------------------------------------- abas
function mostrarAba(aba) {
  $('painelNovo').style.display = aba === 'novo' ? '' : 'none';
  $('painelMeus').style.display = aba === 'meus' ? '' : 'none';
  $('abaNovo').classList.toggle('ativa', aba === 'novo');
  $('abaMeus').classList.toggle('ativa', aba === 'meus');
  if (aba === 'meus') carregarMeus();
}

// ---------------------------------------------------------- rascunho
function salvarRascunho() {
  try { localStorage.setItem(chaveRascunho(), JSON.stringify({ loja: $('pedLoja').value, itens: itensPedido, obs: $('pedObs').value })); } catch { /* sem armazenamento */ }
}
function lerRascunho() {
  try {
    const r = JSON.parse(localStorage.getItem(chaveRascunho()) || 'null');
    if (!r) return;
    const ativos = new Set(catalogoAtivo.map(p => p.id));
    itensPedido = (r.itens || []).filter(i => ativos.has(i.produto_id));
    $('pedObs').value = r.obs || '';
    if (r.loja && lojasUsuario.some(l => String(l.codigo) === String(r.loja))) $('pedLoja').value = r.loja;
  } catch { /* sem armazenamento */ }
}
function descartarRascunho() {
  if (itensPedido.length && !confirm('Descartar os itens deste pedido?')) return;
  itensPedido = [];
  $('pedObs').value = '';
  salvarRascunho();
  renderizarItens();
}

// ---------------------------------------------------------- busca no catálogo
function semAcento(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }

function sugerirProdutos() {
  const termos = semAcento($('pedBusca').value).split(/\s+/).filter(Boolean);
  const caixa = $('pedSugestoes');
  produtoEscolhido = null;
  $('pedUnidade').value = '';
  if (!termos.length) { caixa.style.display = 'none'; return; }
  const achados = catalogoAtivo.filter(p => termos.every(t => semAcento(`${p.codigo} ${p.nome} ${p.categoria || ''}`).includes(t))).slice(0, 10);
  caixa.innerHTML = achados.length
    ? achados.map(p => `<button type="button" class="cp-sug" data-id="${p.id}"><span><b>${escHTML(p.nome)}</b> · ${escHTML(p.unidade)}</span><small>${escHTML(p.codigo)}${p.categoria ? ' · ' + escHTML(p.categoria) : ''}</small></button>`).join('')
    : '<div class="cp-sug-vazio">Nenhum produto com esse texto. Peça ao gestor para incluir no catálogo.</div>';
  caixa.style.display = '';
  caixa.querySelectorAll('.cp-sug').forEach(b => b.addEventListener('click', () => escolherProduto(Number(b.dataset.id))));
}

function escolherProduto(id) {
  produtoEscolhido = catalogoAtivo.find(p => p.id === id) || null;
  if (!produtoEscolhido) return;
  $('pedBusca').value = produtoEscolhido.nome;
  $('pedUnidade').value = produtoEscolhido.unidade;
  $('pedSugestoes').style.display = 'none';
  $('pedQtd').focus();
}

function adicionarItem() {
  mensagem('msgAdicionar', '');
  if (!produtoEscolhido) return mensagem('msgAdicionar', 'Escolha um produto da lista (digite e clique nele).', 'erro');
  const q = numeroDigitado($('pedQtd').value);
  if (!(q > 0)) return mensagem('msgAdicionar', 'Informe a quantidade.', 'erro');
  const obs = $('pedObsItem').value.trim();
  const existente = itensPedido.find(i => i.produto_id === produtoEscolhido.id && (i.obs || '') === obs);
  if (existente) existente.qtd += q;
  else itensPedido.push({ produto_id: produtoEscolhido.id, codigo: produtoEscolhido.codigo, nome: produtoEscolhido.nome, unidade: produtoEscolhido.unidade, qtd: q, obs });
  produtoEscolhido = null;
  ['pedBusca', 'pedQtd', 'pedUnidade', 'pedObsItem'].forEach(id => { $(id).value = ''; });
  salvarRascunho();
  renderizarItens();
  $('pedBusca').focus();
}

function alterarQtdItem(i, valor) {
  const q = numeroDigitado(valor);
  if (q > 0) { itensPedido[i].qtd = q; salvarRascunho(); }
  renderizarItens();
}

function removerItem(i) {
  itensPedido.splice(i, 1);
  salvarRascunho();
  renderizarItens();
}

function renderizarItens() {
  $('pedResumo').textContent = itensPedido.length ? `${itensPedido.length} item(ns) · rascunho guardado neste navegador` : '';
  $('pedItens').innerHTML = itensPedido.length ? itensPedido.map((it, i) => `
    <tr>
      <td><b>${escHTML(it.codigo)}</b></td>
      <td>${escHTML(it.nome)}</td>
      <td style="text-align:right"><input class="cp-qtd-inline" value="${qtd(it.qtd)}" inputmode="decimal" aria-label="Quantidade de ${escHTML(it.nome)}" onchange="alterarQtdItem(${i}, this.value)"></td>
      <td>${escHTML(it.unidade)}</td>
      <td>${escHTML(it.obs || '—')}</td>
      <td class="acoes"><button type="button" onclick="removerItem(${i})" aria-label="Remover ${escHTML(it.nome)}">Remover</button></td>
    </tr>`).join('') : '<tr><td colspan="6" style="color:#6b7280">Nenhum item ainda. Busque um produto acima e clique em Adicionar.</td></tr>';
  $('btnEnviarPedido').disabled = !itensPedido.length;
}

async function enviarPedido() {
  mensagem('msgEnviar', '');
  const loja = Number($('pedLoja').value);
  if (!loja) return mensagem('msgEnviar', 'Escolha a loja.', 'erro');
  if (!itensPedido.length) return mensagem('msgEnviar', 'Inclua pelo menos um item.', 'erro');
  $('btnEnviarPedido').disabled = true;
  mensagem('msgEnviar', 'Enviando...');
  const { data, error } = await supabaseBI.rpc('compras_enviar_pedido', {
    p_loja: loja,
    p_observacao: $('pedObs').value.trim(),
    p_itens: itensPedido.map(i => ({ produto_id: i.produto_id, qtd: i.qtd, obs: i.obs || '' }))
  });
  $('btnEnviarPedido').disabled = false;
  if (error) return mensagem('msgEnviar', 'Não foi possível enviar: ' + erroBanco(error), 'erro');
  const pedido = Array.isArray(data) ? data[0] : data;
  itensPedido = [];
  $('pedObs').value = '';
  salvarRascunho();
  renderizarItens();
  mensagem('msgEnviar', '');
  mensagem('msgSolicitar', `Pedido ${numeroPedido(pedido)} enviado para aprovação.`, 'ok');
  abertosMeus.add(pedido.id);
  mostrarAba('meus');
}

// ---------------------------------------------------------- minhas solicitações
async function carregarMeus() {
  const { data, error } = await supabaseBI.from('pedidos_compra').select('*').order('criado_em', { ascending: false }).limit(300);
  if (error) { $('listaMeus').innerHTML = ''; return mensagem('msgSolicitar', 'Erro ao carregar: ' + erroBanco(error), 'erro'); }
  pedidosMeus = data || [];
  renderizarMeus();
}

function renderizarMeus() {
  const filtros = [['todos', 'Todos'], ['aguardando', 'Aguardando'], ['aprovado', 'Aprovados'], ['comprado', 'Compra solicitada'], ['entregue', 'Entregues'], ['reprovado', 'Reprovados']];
  $('filtrosMeus').innerHTML = filtros.map(([v, t]) => {
    const n = v === 'todos' ? pedidosMeus.length : pedidosMeus.filter(p => p.status === v).length;
    return `<button type="button" class="cp-chip ${filtroMeus === v ? 'ativo' : ''}" onclick="filtroMeus='${v}'; renderizarMeus()">${t} <small>${n}</small></button>`;
  }).join('');
  const lista = pedidosMeus.filter(p => filtroMeus === 'todos' || p.status === filtroMeus);
  $('listaMeus').innerHTML = lista.length ? lista.map(p => `
    <div class="cp-pedido ${abertosMeus.has(p.id) ? 'aberto' : ''}" id="ped${p.id}">
      <button type="button" class="cp-pedido-topo" onclick="alternarMeu(${p.id})">
        <span class="la-seta ${abertosMeus.has(p.id) ? 'aberta' : ''}">▸</span>
        <b class="cp-num-pedido">${numeroPedido(p)}</b>
        <span>${escHTML(nomeLojaCompras(lojasUsuario, p.loja_codigo))}</span>
        <span class="cp-suave">${dataHora(p.criado_em)} · ${escHTML(p.solicitante_nome)}</span>
        <span style="flex:1"></span>
        ${etiquetaStatus(p.status)}
      </button>
      <div class="cp-pedido-corpo" id="corpoPed${p.id}"></div>
    </div>`).join('') : '<p class="acesso-ajuda">Nenhuma solicitação aqui.</p>';
  lista.filter(p => abertosMeus.has(p.id)).forEach(p => preencherMeu(p));
}

async function alternarMeu(id) {
  if (abertosMeus.has(id)) abertosMeus.delete(id); else abertosMeus.add(id);
  renderizarMeus();
}

async function preencherMeu(p) {
  const corpo = $('corpoPed' + p.id);
  if (!corpo) return;
  corpo.innerHTML = '<p class="acesso-ajuda">Carregando...</p>';
  try {
    const det = await detalhePedido(p.id);
    const souEu = perfilAtual && p.solicitante_id === perfilAtual.id;
    corpo.innerHTML = htmlDetalhe(p, det) + `<div class="acesso-botoes">
      ${p.status === 'aguardando' && souEu ? `<button type="button" class="acesso-btn-sec" onclick="mudarStatusMeu(${p.id}, 'cancelado')">Cancelar pedido</button>` : ''}
      ${p.status === 'comprado' ? `<button type="button" class="acesso-btn" onclick="mudarStatusMeu(${p.id}, 'entregue')">Confirmar entrega</button>` : ''}
    </div>`;
  } catch (err) {
    corpo.innerHTML = `<p class="acesso-msg erro">${escHTML(err.message)}</p>`;
  }
}

async function mudarStatusMeu(id, status) {
  const p = pedidosMeus.find(x => x.id === id);
  const txt = status === 'cancelado' ? `Cancelar o pedido ${numeroPedido(p)}?` : `Confirmar que o pedido ${numeroPedido(p)} chegou na loja?`;
  if (!confirm(txt)) return;
  const { error } = await supabaseBI.rpc('compras_marcar', { p_pedido: id, p_status: status, p_detalhe: '' });
  if (error) return mensagem('msgSolicitar', 'Não foi possível: ' + erroBanco(error), 'erro');
  mensagem('msgSolicitar', status === 'cancelado' ? 'Pedido cancelado.' : 'Entrega confirmada.', 'ok');
  await carregarMeus();
}

// ---------------------------------------------------------- início
(async () => {
  await iniciarPaginaCompras('solicitar', () => temPermissao('solicitar_compras'));
  $('pedSolicitante').value = perfilAtual.nome;
  $('pedData').value = new Date().toLocaleDateString('pt-BR');
  try {
    lojasUsuario = await lojasCompras();
  } catch (err) { mensagem('msgSolicitar', err.message, 'erro'); }
  $('pedLoja').innerHTML = (lojasUsuario.length === 1 ? '' : '<option value="">Selecione a loja...</option>') +
    lojasUsuario.map(l => `<option value="${l.codigo}">${escHTML(nomeLojaCompras(lojasUsuario, l.codigo))}</option>`).join('');
  if (!lojasUsuario.length) mensagem('msgSolicitar', 'Nenhuma loja liberada para o seu usuário. Fale com o administrador.', 'erro');

  const { data, error } = await supabaseBI.from('produtos_compra').select('*').eq('ativo', true).order('nome');
  if (error) mensagem('msgSolicitar', 'Erro ao carregar o catálogo: ' + erroBanco(error), 'erro');
  catalogoAtivo = data || [];
  if (!error && !catalogoAtivo.length) mensagem('msgAdicionar', 'O catálogo de compras ainda está vazio. O gestor precisa cadastrar os produtos.', 'erro');

  lerRascunho();
  renderizarItens();
  $('pedBusca').addEventListener('input', sugerirProdutos);
  $('pedBusca').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const b = document.querySelector('#pedSugestoes .cp-sug'); if (b && $('pedSugestoes').style.display !== 'none') b.click(); }
  });
  $('pedQtd').addEventListener('keydown', e => { if (e.key === 'Enter') adicionarItem(); });
  $('pedObsItem').addEventListener('keydown', e => { if (e.key === 'Enter') adicionarItem(); });
  $('pedLoja').addEventListener('change', salvarRascunho);
  $('pedObs').addEventListener('input', salvarRascunho);
  document.addEventListener('click', e => { if (!e.target.closest('.cp-busca')) $('pedSugestoes').style.display = 'none'; });
  if (new URLSearchParams(location.search).get('aba') === 'meus') mostrarAba('meus');
})();
