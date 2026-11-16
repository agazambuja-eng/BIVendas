/**
 * Aprovação e acompanhamento (gestor): pedidos de todas as lojas.
 * Aguardando -> aprovar (com quantidades ajustadas) ou reprovar com parecer.
 * Aprovado -> compra solicitada. Compra solicitada -> entregue.
 */

let pedidos = [];
let lojasTodas = [];
let pedidoAberto = null;      // id
let detalheAberto = null;     // { itens, historico }

async function carregarPedidos() {
  const { data, error } = await supabaseBI.from('pedidos_compra').select('*').order('criado_em', { ascending: false }).limit(1000);
  if (error) return mensagem('msgAprovacao', 'Erro ao carregar pedidos: ' + erroBanco(error), 'erro');
  pedidos = data || [];
  renderizarContadores();
  renderizarLista();
  if (pedidoAberto && pedidos.some(p => p.id === pedidoAberto)) abrirPedido(pedidoAberto);
}

function renderizarContadores() {
  const mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0);
  const cards = [
    ['aguardando', pedidos.filter(p => p.status === 'aguardando').length],
    ['aprovado', pedidos.filter(p => p.status === 'aprovado').length],
    ['comprado', pedidos.filter(p => p.status === 'comprado').length],
    ['reprovado', pedidos.filter(p => p.status === 'reprovado' && new Date(p.decidido_em) >= mes).length]
  ];
  $('contadores').innerHTML = cards.map(([s, n]) => `
    <button type="button" class="cp-contador ${$('fStatus').value === s ? 'ativo' : ''}" onclick="$('fStatus').value='${s}'; renderizarLista(); renderizarContadores();">
      <span>${s === 'reprovado' ? 'Reprovados no mês' : STATUS_COMPRA[s].texto}</span><b class="${STATUS_COMPRA[s].classe}">${n}</b>
    </button>`).join('');
}

function renderizarLista() {
  const st = $('fStatus').value, loja = $('fLoja').value, busca = $('fBusca').value.trim().toUpperCase();
  const lista = pedidos.filter(p => (!st || p.status === st) && (!loja || String(p.loja_codigo) === loja) &&
    (!busca || numeroPedido(p).includes(busca) || String(p.solicitante_nome || '').toUpperCase().includes(busca)));
  $('listaPedidos').innerHTML = lista.length ? lista.map(p => `
    <button type="button" class="cp-item-aprov ${p.id === pedidoAberto ? 'ativo' : ''}" onclick="abrirPedido(${p.id})">
      <span class="cp-item-txt"><b class="cp-num-pedido">${numeroPedido(p)}</b> · ${escHTML(nomeLojaCompras(lojasTodas, p.loja_codigo))}
        <small>${escHTML(p.solicitante_nome)} · ${dataHora(p.criado_em)}</small></span>
      ${etiquetaStatus(p.status)}
    </button>`).join('') : '<p class="acesso-ajuda">Nenhum pedido nesta situação.</p>';
}

async function abrirPedido(id) {
  pedidoAberto = id;
  renderizarLista();
  const p = pedidos.find(x => x.id === id);
  const painel = $('painelDetalhe');
  painel.innerHTML = '<p class="acesso-ajuda">Carregando...</p>';
  try {
    detalheAberto = await detalhePedido(id);
  } catch (err) {
    painel.innerHTML = `<p class="acesso-msg erro">${escHTML(err.message)}</p>`;
    return;
  }
  const cab = `<div class="cp-linha-titulo">
      <div><h2 class="cp-h2">Pedido ${numeroPedido(p)}</h2>
        <p class="acesso-ajuda" style="margin:2px 0 0">${escHTML(nomeLojaCompras(lojasTodas, p.loja_codigo))} · ${escHTML(p.solicitante_nome)} · ${dataHora(p.criado_em)}</p></div>
      ${etiquetaStatus(p.status)}
    </div>`;

  if (p.status === 'aguardando') {
    painel.innerHTML = cab + `
      ${p.observacao ? `<p class="cp-obs"><b>Observação da loja:</b> ${escHTML(p.observacao)}</p>` : ''}
      <table class="cp-tabela">
        <thead><tr><th>Produto</th><th class="num">Pedido</th><th class="num">Aprovar</th><th>Unidade</th></tr></thead>
        <tbody>${detalheAberto.itens.map(i => `<tr>
          <td><b>${escHTML(i.produto_codigo)}</b> · ${escHTML(i.produto_nome)}${i.observacao ? `<br><small>${escHTML(i.observacao)}</small>` : ''}</td>
          <td class="num">${qtd(i.qtd_solicitada)}</td>
          <td class="num"><input class="cp-qtd-inline" data-item="${i.id}" data-pedido="${i.qtd_solicitada}" value="${qtd(i.qtd_solicitada)}" inputmode="decimal" aria-label="Quantidade aprovada de ${escHTML(i.produto_nome)}" oninput="marcarAjuste(this)"></td>
          <td>${escHTML(i.unidade)}</td></tr>`).join('')}</tbody>
      </table>
      <label style="display:block; margin-top: 12px;">Parecer do gestor (a loja vê)
        <textarea id="parecer" rows="2" maxlength="500" placeholder="Obrigatório para reprovar. Ex.: estojo reduzido para 40, temos 20 no estoque central."></textarea></label>
      <div id="msgDecisao" class="acesso-msg"></div>
      <div class="acesso-botoes">
        <button type="button" class="acesso-btn-sec cp-btn-reprovar" onclick="decidir(false)">Reprovar</button>
        <button type="button" class="acesso-btn cp-btn-aprovar" onclick="decidir(true)">Aprovar</button>
      </div>
      <details class="cp-hist-dobra"><summary>Histórico</summary>${htmlDetalhe(p, detalheAberto).match(/<ol>[\s\S]*<\/ol>/)[0]}</details>`;
    return;
  }

  const acoes = p.status === 'aprovado'
    ? `<label style="display:block; margin-top: 8px;">Observação da compra (opcional)
         <input type="text" id="detalheMarcar" maxlength="200" placeholder="Ex.: pedido ao fornecedor, chega em 7 dias"></label>
       <div class="acesso-botoes"><button type="button" class="acesso-btn" onclick="marcar('comprado')">Marcar compra solicitada</button></div>`
    : p.status === 'comprado'
      ? `<div class="acesso-botoes"><button type="button" class="acesso-btn" onclick="marcar('entregue')">Marcar entregue</button></div>`
      : '';
  painel.innerHTML = cab + htmlDetalhe(p, detalheAberto) + `<div id="msgDecisao" class="acesso-msg"></div>` + acoes;
}

function marcarAjuste(input) {
  const v = Number(String(input.value).replace(/\./g, '').replace(',', '.'));
  input.classList.toggle('ajustado', isFinite(v) && v !== Number(input.dataset.pedido));
}

async function decidir(aprovar) {
  const p = pedidos.find(x => x.id === pedidoAberto);
  const parecer = $('parecer').value.trim();
  if (!aprovar && !parecer) return mensagem('msgDecisao', 'Escreva o motivo da reprovação no parecer.', 'erro');
  const itens = [];
  let invalido = false;
  document.querySelectorAll('#painelDetalhe input[data-item]').forEach(inp => {
    const v = Number(String(inp.value).trim().replace(/\./g, '').replace(',', '.'));
    if (!isFinite(v) || v < 0) invalido = true;
    itens.push({ id: Number(inp.dataset.item), qtd_aprovada: v });
  });
  if (aprovar && invalido) return mensagem('msgDecisao', 'Confira as quantidades aprovadas.', 'erro');
  if (aprovar && itens.every(i => i.qtd_aprovada === 0)) return mensagem('msgDecisao', 'Tudo zerado: use Reprovar.', 'erro');
  if (!confirm(`${aprovar ? 'Aprovar' : 'Reprovar'} o pedido ${numeroPedido(p)}?`)) return;
  const { error } = await supabaseBI.rpc('compras_decidir', { p_pedido: p.id, p_aprovar: aprovar, p_parecer: parecer, p_itens: aprovar ? itens : [] });
  if (error) return mensagem('msgDecisao', erroBanco(error), 'erro');
  mensagem('msgAprovacao', `Pedido ${numeroPedido(p)} ${aprovar ? 'aprovado' : 'reprovado'}.`, 'ok');
  await carregarPedidos();
}

async function marcar(status) {
  const p = pedidos.find(x => x.id === pedidoAberto);
  const detalhe = $('detalheMarcar') ? $('detalheMarcar').value.trim() : '';
  const { error } = await supabaseBI.rpc('compras_marcar', { p_pedido: p.id, p_status: status, p_detalhe: detalhe });
  if (error) return mensagem('msgDecisao', erroBanco(error), 'erro');
  mensagem('msgAprovacao', `Pedido ${numeroPedido(p)}: ${STATUS_COMPRA[status].texto.toLowerCase()}.`, 'ok');
  await carregarPedidos();
}

(async () => {
  await iniciarPaginaCompras('aprovacao', () => temPermissao('aprovar_compras'));
  try { lojasTodas = await lojasCompras(); } catch (err) { mensagem('msgAprovacao', err.message, 'erro'); }
  $('fLoja').innerHTML = '<option value="">Todas as lojas</option>' + lojasTodas.map(l => `<option value="${l.codigo}">${escHTML(nomeLojaCompras(lojasTodas, l.codigo))}</option>`).join('');
  await carregarPedidos();
})();
