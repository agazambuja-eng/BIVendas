/**
 * Controle de Solicitações de Compras: funções usadas pelas três telas
 * (catálogo, solicitação e aprovação). Depende de supabase-config.js e auth.js.
 *
 * Os pedidos só mudam pelas funções do banco (database/10_controle_compras.sql):
 *   compras_enviar_pedido, compras_decidir, compras_marcar.
 */

const $ = id => document.getElementById(id);

const STATUS_COMPRA = {
  aguardando: { texto: 'Aguardando aprovação', classe: 'st-aguardando' },
  aprovado:   { texto: 'Aprovado · compra a fazer', classe: 'st-aprovado' },
  comprado:   { texto: 'Compra solicitada', classe: 'st-comprado' },
  entregue:   { texto: 'Entregue', classe: 'st-entregue' },
  reprovado:  { texto: 'Reprovado', classe: 'st-reprovado' },
  cancelado:  { texto: 'Cancelado', classe: 'st-cancelado' }
};
const ACOES_HISTORICO = {
  enviado: 'Enviado', aprovado: 'Aprovado', reprovado: 'Reprovado',
  comprado: 'Compra solicitada', entregue: 'Entregue', cancelado: 'Cancelado'
};

function mensagem(elId, texto, tipo = '') {
  const el = $(elId);
  if (!el) return;
  el.textContent = texto || '';
  el.className = 'acesso-msg ' + tipo;
}

/** 520 + 12 -> "520-0012" */
function numeroPedido(p) {
  return `${p.loja_codigo}-${String(p.numero).padStart(4, '0')}`;
}

function etiquetaStatus(status) {
  const s = STATUS_COMPRA[status] || { texto: status, classe: '' };
  return `<span class="st ${s.classe}">${escHTML(s.texto)}</span>`;
}

/** "2026-11-16T19:40:00Z" -> "16/11/2026 16:40" */
function dataHora(ts, comHora = true) {
  if (!ts) return '';
  const d = new Date(ts);
  const dia = d.toLocaleDateString('pt-BR');
  return comHora ? `${dia} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : dia;
}

function qtd(n) {
  return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** Mensagem do banco (raise exception) em texto simples. */
function erroBanco(error) {
  const t = String((error && error.message) || error || 'erro desconhecido');
  if (/does not exist|schema cache|Could not find the function/i.test(t)) {
    return 'O banco ainda não tem o controle de compras: rode database/10_controle_compras.sql no Supabase.';
  }
  return t;
}

/** Abas do topo: Catálogo · Solicitação · Aprovação (cada uma só para quem pode). */
function montarSubmenuCompras(ativo) {
  const el = $('submenuCompras');
  if (!el) return;
  const itens = [
    { id: 'catalogo', href: '/compras-catalogo.html', texto: '📦 Catálogo de compras', pode: podeCompras() },
    { id: 'solicitar', href: '/compras-solicitar.html', texto: '📝 Solicitação', pode: temPermissao('solicitar_compras') },
    { id: 'aprovacao', href: '/compras-aprovacao.html', texto: '✅ Aprovação e acompanhamento', pode: temPermissao('aprovar_compras') }
  ].filter(i => i.pode);
  el.innerHTML = `<a href="/compras.html" class="submenu-raiz">🛒 Compras</a><span class="submenu-sep">›</span>` +
    itens.map(i => `<a href="${i.href}" class="submenu-item ${i.id === ativo ? 'ativo' : ''}">${i.texto}</a>`).join('');
}

/** Garante login e permissão; monta topo e abas. */
async function iniciarPaginaCompras(ativo, permitido) {
  await exigirLogin();
  montarBarraUsuario($('barraUsuario'));
  if (!permitido()) {
    location.replace('/inicio.html?semAcesso=' + (ativo === 'aprovacao' ? 'aprovar_compras' : 'solicitar_compras'));
    return new Promise(() => {});
  }
  montarSubmenuCompras(ativo);
}

/** Lojas que o usuário pode usar: [{codigo, nome}] */
async function lojasCompras() {
  const { data, error } = await supabaseBI.rpc('compras_minhas_lojas');
  if (error) throw new Error(erroBanco(error));
  return (data || []).map(l => ({ codigo: Number(l.codigo), nome: String(l.nome || '').replace(/^0*\d+\s*[-–]?\s*/, '').trim() }));
}

function nomeLojaCompras(lojas, codigo) {
  const l = (lojas || []).find(x => x.codigo === Number(codigo));
  return `${codigo}${l && l.nome ? ' – ' + l.nome : ''}`;
}

/** Itens e histórico de um pedido. */
async function detalhePedido(id) {
  const [itens, hist] = await Promise.all([
    supabaseBI.from('pedidos_compra_itens').select('*').eq('pedido_id', id).order('id'),
    supabaseBI.from('pedidos_compra_historico').select('*').eq('pedido_id', id).order('id')
  ]);
  if (itens.error) throw new Error(erroBanco(itens.error));
  return { itens: itens.data || [], historico: hist.data || [] };
}

/** Bloco com itens (pedido x aprovado), parecer e histórico. */
function htmlDetalhe(p, { itens, historico }) {
  const decidido = !['aguardando', 'cancelado'].includes(p.status);
  return `
    <div class="cp-detalhe">
      <div class="cp-detalhe-col">
        <div class="cp-rotulo">Itens</div>
        <table class="cp-tabela">
          <thead><tr><th>Produto</th><th class="num">Pedido</th>${decidido && p.status !== 'reprovado' ? '<th class="num">Aprovado</th>' : ''}<th>Unidade</th></tr></thead>
          <tbody>${itens.map(i => {
            const ajustado = i.qtd_aprovada !== null && Number(i.qtd_aprovada) !== Number(i.qtd_solicitada);
            return `<tr>
              <td><b>${escHTML(i.produto_codigo)}</b> · ${escHTML(i.produto_nome)}${i.observacao ? `<br><small>${escHTML(i.observacao)}</small>` : ''}</td>
              <td class="num">${qtd(i.qtd_solicitada)}</td>
              ${decidido && p.status !== 'reprovado' ? `<td class="num ${ajustado ? 'ajustado' : ''}">${i.qtd_aprovada === null ? '—' : qtd(i.qtd_aprovada)}${ajustado ? ' <small>(ajustado)</small>' : ''}</td>` : ''}
              <td>${escHTML(i.unidade)}</td></tr>`;
          }).join('')}</tbody>
        </table>
        ${p.observacao ? `<p class="cp-obs"><b>Observação da loja:</b> ${escHTML(p.observacao)}</p>` : ''}
        ${p.parecer ? `<p class="cp-obs cp-parecer"><b>Parecer do gestor:</b> ${escHTML(p.parecer)}</p>` : ''}
      </div>
      <div class="cp-detalhe-col cp-hist">
        <div class="cp-rotulo">Histórico</div>
        <ol>${historico.map(h => `<li><span>${dataHora(h.quando)}</span> <b>${escHTML(ACOES_HISTORICO[h.acao] || h.acao)}</b> por ${escHTML(h.usuario_nome || '')}${h.detalhe ? ` · “${escHTML(h.detalhe)}”` : ''}</li>`).join('')}</ol>
      </div>
    </div>`;
}
