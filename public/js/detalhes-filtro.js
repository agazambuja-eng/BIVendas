/**
 * Aba "Detalhes de Vendas (Auditoria)" com FILTRO TIPO EXCEL.
 *
 * Cada coluna tem um botão ▾ no cabeçalho que abre:
 *   - ordenar A→Z / Z→A (números e datas em ordem certa)
 *   - busca + lista de valores com caixinhas e a quantidade de cada um
 *   - "Selecionar tudo", OK, Cancelar e Limpar filtro
 * Os filtros se somam (como no Excel): a lista de valores de uma coluna
 * mostra só o que sobra depois dos filtros das outras colunas.
 * Contador, totais do rodapé e "Exportar CSV" seguem o que está filtrado.
 *
 * O filtro guarda os valores DESMARCADOS: se uma nova consulta trouxer um
 * valor novo, ele aparece (não some sem querer).
 */

let detalhesItens = [];          // itens que entraram no BI (após lojas e tipos de venda)
let detalhesColunas = [];        // definição das colunas atuais
let detalhesVisiveis = [];       // itens depois dos filtros (usado no CSV)
const detalhesFiltros = {};      // chave da coluna -> Set de valores desmarcados
let detalhesOrdem = null;        // { chave, dir: 1 | -1 }
let detalhesPopup = null;        // { chave, marcados: Set, valores: [...] }

const LIMITE_VALORES_FILTRO = 1000;

function colunasFixasDetalhes() {
  const moeda = v => formatarMoedaBR(v);
  return [
    { chave: 'LOJA', titulo: 'Loja', valor: i => String(i.LOJA || '-'), estilo: 'white-space: nowrap;' },
    { chave: 'OS', titulo: 'OS', valor: i => String(i.OS || i.CODIGODAVENDA || '-'), tipo: 'num', estilo: 'font-weight: bold; color: #0078d7;' },
    { chave: 'DATA', titulo: 'Data', valor: i => String(i.DATA || '-'), tipo: 'data', estilo: 'white-space: nowrap;' },
    { chave: 'CLIENTE', titulo: 'Cliente', valor: i => String(i.CLIENTE || '-') },
    { chave: 'VENDEDOR', titulo: 'Vendedor', valor: i => String(i.VENDEDOR || '-') },
    { chave: 'PRODUTO', titulo: 'Produto / Descrição', valor: i => `${i.CODIGO || ''} - ${i.DESCRICAO || i.PRODUTO || '-'}` },
    { chave: 'QUANTIDADE', titulo: 'Qtd', valor: i => String(i.QUANTIDADE || '0'), tipo: 'num', estilo: 'text-align: center;' },
    { chave: 'VALORBRUTOPRODUTO', titulo: 'Bruto', valor: i => parseNumeroBR(i.VALORBRUTOPRODUTO), tipo: 'moeda', fmt: moeda, estilo: 'text-align: right;' },
    { chave: 'DESCPRODUTO', titulo: 'Desconto', valor: i => parseNumeroBR(i.DESCPRODUTO), tipo: 'moeda', fmt: moeda, estilo: 'text-align: right; color: #d9534f;' },
    { chave: 'LIQUIDOPRODUTO', titulo: 'Líquido', valor: i => parseNumeroBR(i.LIQUIDOPRODUTO), tipo: 'moeda', fmt: moeda, estilo: 'text-align: right; font-weight: bold; color: #28a745;' },
    { chave: 'TIPOVENDA', titulo: 'Tipo Venda', valor: i => String(i.TIPOVENDA || '-'), estilo: 'font-size: 11px; color: #666;' }
  ];
}

/** Texto do valor como aparece na lista do filtro. */
function textoFiltro(col, item) {
  const v = col.valor(item);
  if (col.fmt) return col.fmt(v);
  const s = v === null || v === undefined || String(v).trim() === '' ? '(vazio)' : String(v);
  return s;
}

/** Chave de ordenação: números como número, datas dd/mm/aaaa como aaaammdd. */
function chaveOrdem(col, item) {
  const v = col.valor(item);
  if (col.tipo === 'moeda') return Number(v) || 0;
  if (col.tipo === 'num') { const n = parseNumeroBR(v); return isNaN(n) ? 0 : n; }
  if (col.tipo === 'data') { const m = String(v).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}${m[2]}${m[1]}` : String(v); }
  return String(v ?? '').toUpperCase();
}
function compararTextoFiltro(col, a, b) {
  if (col.tipo === 'moeda' || col.tipo === 'num') return parseNumeroBR(String(a).replace(/[R$\s]/g, '')) - parseNumeroBR(String(b).replace(/[R$\s]/g, ''));
  if (col.tipo === 'data') { const k = s => { const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}${m[2]}${m[1]}` : s; }; return k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0; }
  return String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
}

/** Chamado por processarDadosBI (main.js) a cada consulta / mudança de filtro do BI. */
function renderizarDetalhes(itens) {
  detalhesItens = itens || [];
  const extras = (typeof camposExtrasDetalhes === 'function') ? camposExtrasDetalhes(detalhesItens) : [];
  detalhesColunas = colunasFixasDetalhes().concat(extras.map(k => ({
    chave: k, titulo: k, extra: true, valor: i => (i[k] === null || i[k] === undefined ? '' : String(i[k])), estilo: 'white-space: nowrap;'
  })));
  // filtros de colunas que não existem mais são descartados
  Object.keys(detalhesFiltros).forEach(k => { if (!detalhesColunas.some(c => c.chave === k)) delete detalhesFiltros[k]; });
  desenharCabecalhoDetalhes();
  aplicarFiltrosDetalhes();
}

/** Itens que passam em todos os filtros, menos o da coluna informada (para montar a lista dela). */
function itensFiltradosExceto(chaveIgnorada) {
  const ativos = detalhesColunas.filter(c => c.chave !== chaveIgnorada && detalhesFiltros[c.chave] && detalhesFiltros[c.chave].size);
  if (!ativos.length) return detalhesItens;
  return detalhesItens.filter(item => ativos.every(c => !detalhesFiltros[c.chave].has(textoFiltro(c, item))));
}

function desenharCabecalhoDetalhes() {
  const linha = document.getElementById('cabecalhoDetalhesLinha');
  if (!linha) return;
  linha.innerHTML = detalhesColunas.map(c => {
    const filtrada = detalhesFiltros[c.chave] && detalhesFiltros[c.chave].size;
    const ordem = detalhesOrdem && detalhesOrdem.chave === c.chave ? (detalhesOrdem.dir > 0 ? ' ↑' : ' ↓') : '';
    return `<th class="${c.extra ? 'th-extra ' : ''}th-filtro${filtrada ? ' filtrada' : ''}" style="padding: 8px; border-bottom: 1px solid #ddd; white-space: nowrap;" title="${c.extra ? 'Campo da API: ' + escHTML(c.chave) : ''}">
      <span>${escHTML(c.titulo)}${ordem}</span>
      <button type="button" class="btn-filtro-col" onclick="abrirFiltroColuna(event, ${escHTML(JSON.stringify(c.chave))})" title="Filtrar / ordenar">${filtrada ? '⏷' : '▾'}</button>
    </th>`;
  }).join('');
}

function aplicarFiltrosDetalhes() {
  let lista = itensFiltradosExceto(null);
  if (detalhesOrdem) {
    const col = detalhesColunas.find(c => c.chave === detalhesOrdem.chave);
    if (col) {
      const dir = detalhesOrdem.dir;
      lista = lista.slice().sort((a, b) => {
        const ka = chaveOrdem(col, a), kb = chaveOrdem(col, b);
        return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
      });
    }
  }
  detalhesVisiveis = lista;
  desenharCorpoDetalhes(lista);
  desenharCabecalhoDetalhes();

  const nFiltros = Object.values(detalhesFiltros).filter(s => s && s.size).length;
  const contador = document.getElementById('contadorRegistrosDetalhe');
  if (contador) {
    contador.innerText = nFiltros
      ? `Exibindo ${lista.length} de ${detalhesItens.length} registros · ${nFiltros} filtro(s) · ${detalhesColunas.length} colunas`
      : `Exibindo ${detalhesItens.length} registros · ${detalhesColunas.length} colunas`;
  }
  const btnLimpar = document.getElementById('btnLimparFiltrosDetalhes');
  if (btnLimpar) btnLimpar.style.display = nFiltros ? '' : 'none';
}

function desenharCorpoDetalhes(lista) {
  const corpo = document.getElementById('tabelaDetalhesCorpo');
  if (!corpo) return;
  const tot = { qtd: 0, bruto: 0, desconto: 0, liquido: 0, os: new Set(), clientes: new Set(), vendedores: new Set(), lojas: new Set() };
  let html = '';
  lista.forEach(item => {
    tot.qtd += parseNumeroBR(item.QUANTIDADE || '0');
    tot.bruto += parseNumeroBR(item.VALORBRUTOPRODUTO);
    tot.desconto += parseNumeroBR(item.DESCPRODUTO);
    tot.liquido += parseNumeroBR(item.LIQUIDOPRODUTO);
    const os = item.OS || item.CODIGODAVENDA; if (os) tot.os.add(String(os));
    if (item.CLIENTE) tot.clientes.add(String(item.CLIENTE));
    if (item.VENDEDOR) tot.vendedores.add(String(item.VENDEDOR));
    if (item.LOJA) tot.lojas.add(String(item.LOJA));
    html += `<tr style="border-bottom: 1px solid #eee;">${detalhesColunas.map(c => {
      const v = c.valor(item);
      const txt = c.fmt ? c.fmt(v) : (c.extra ? formatarCampoApi(item[c.chave]) : escHTML(String(v)));
      return `<td style="padding: 6px 8px; ${c.estilo || ''}">${txt}</td>`;
    }).join('')}</tr>`;
  });
  corpo.innerHTML = html || `<tr><td colspan="${detalhesColunas.length}" style="text-align:center; padding: 20px;">${detalhesItens.length ? 'Nenhum registro com esses filtros.' : 'Nenhum registro encontrado.'}</td></tr>`;

  const rodape = document.getElementById('tabelaDetalhesTotais');
  if (rodape) {
    const pctDesc = tot.bruto > 0 ? (tot.desconto / tot.bruto) * 100 : 0;
    const cel = 'padding: 8px; border-top: 2px solid #b8daff; white-space: nowrap;';
    const extrasVazias = detalhesColunas.filter(c => c.extra).map(() => `<td style="${cel}"></td>`).join('');
    rodape.innerHTML = lista.length ? `<tr>
      <td style="${cel}">TOTAL · ${tot.lojas.size} loja(s)</td>
      <td style="${cel} color: #0078d7;">${tot.os.size} OS</td>
      <td style="${cel}"></td>
      <td style="${cel}">${tot.clientes.size} cliente(s)</td>
      <td style="${cel}">${tot.vendedores.size} vendedor(es)</td>
      <td style="${cel}">${lista.length} item(ns)</td>
      <td style="${cel} text-align: center;">${tot.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
      <td style="${cel} text-align: right;">${formatarMoedaBR(tot.bruto)}</td>
      <td style="${cel} text-align: right; color: #d9534f;">${formatarMoedaBR(tot.desconto)}</td>
      <td style="${cel} text-align: right; color: #28a745;">${formatarMoedaBR(tot.liquido)}</td>
      <td style="${cel} font-size: 11px; color: #d9534f;" title="Desconto sobre o valor bruto">${pctDesc.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% desc.</td>
      ${extrasVazias}</tr>` : '';
  }
}

// ---------------------------------------------------------------- popup do filtro
function abrirFiltroColuna(event, chave) {
  event.stopPropagation();
  const col = detalhesColunas.find(c => c.chave === chave);
  if (!col) return;
  if (detalhesPopup && detalhesPopup.chave === chave) return fecharFiltroColuna();

  const base = itensFiltradosExceto(chave);
  const contagem = new Map();
  base.forEach(item => { const t = textoFiltro(col, item); contagem.set(t, (contagem.get(t) || 0) + 1); });
  // valores desmarcados antes continuam na lista (para poder remarcar)
  (detalhesFiltros[chave] || new Set()).forEach(t => { if (!contagem.has(t)) contagem.set(t, 0); });
  const valores = [...contagem.keys()].sort((a, b) => compararTextoFiltro(col, a, b));
  const desmarcados = detalhesFiltros[chave] || new Set();
  detalhesPopup = { chave, col, valores, contagem, marcados: new Set(valores.filter(v => !desmarcados.has(v))) };

  let popup = document.getElementById('popupFiltroDetalhes');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'popupFiltroDetalhes';
    popup.className = 'popup-filtro';
    popup.addEventListener('click', e => e.stopPropagation());
    document.body.appendChild(popup);
  }
  popup.innerHTML = `
    <div class="pf-titulo">${escHTML(col.titulo)}</div>
    <div class="pf-ordem">
      <button type="button" onclick="ordenarDetalhes(1)">↑ Classificar ${col.tipo === 'moeda' || col.tipo === 'num' ? 'do menor para o maior' : col.tipo === 'data' ? 'da mais antiga' : 'de A a Z'}</button>
      <button type="button" onclick="ordenarDetalhes(-1)">↓ Classificar ${col.tipo === 'moeda' || col.tipo === 'num' ? 'do maior para o menor' : col.tipo === 'data' ? 'da mais nova' : 'de Z a A'}</button>
    </div>
    <input type="search" id="pfBusca" placeholder="Pesquisar..." oninput="renderizarListaFiltro()">
    <div class="pf-lista" id="pfLista"></div>
    <div class="pf-rodape">
      <button type="button" class="pf-limpar" onclick="limparFiltroColuna()">Limpar filtro</button>
      <span style="flex:1"></span>
      <button type="button" class="pf-cancelar" onclick="fecharFiltroColuna()">Cancelar</button>
      <button type="button" class="pf-ok" onclick="confirmarFiltroColuna()">OK</button>
    </div>`;
  renderizarListaFiltro();

  // posiciona embaixo do cabeçalho, sem sair da tela
  const r = event.currentTarget.closest('th').getBoundingClientRect();
  popup.style.display = 'block';
  const largura = popup.offsetWidth;
  popup.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - largura - 8)) + 'px';
  popup.style.top = (window.scrollY + r.bottom + 4) + 'px';
  setTimeout(() => document.getElementById('pfBusca')?.focus(), 0);
}

function valoresVisiveisFiltro() {
  const busca = (document.getElementById('pfBusca')?.value || '').trim().toLowerCase();
  return detalhesPopup.valores.filter(v => !busca || v.toLowerCase().includes(busca));
}

function renderizarListaFiltro() {
  const lista = document.getElementById('pfLista');
  if (!lista || !detalhesPopup) return;
  const vis = valoresVisiveisFiltro();
  const mostrar = vis.slice(0, LIMITE_VALORES_FILTRO);
  const todosMarcados = vis.length && vis.every(v => detalhesPopup.marcados.has(v));
  lista.innerHTML = `
    <label class="pf-item pf-todos"><input type="checkbox" ${todosMarcados ? 'checked' : ''} onchange="marcarTodosFiltro(this.checked)">
      <span>(Selecionar tudo${vis.length !== detalhesPopup.valores.length ? ' da pesquisa' : ''})</span></label>
    ${mostrar.map((v, i) => `<label class="pf-item"><input type="checkbox" data-i="${i}" ${detalhesPopup.marcados.has(v) ? 'checked' : ''} onchange="marcarValorFiltro(this)">
      <span>${escHTML(v)}</span><small>${detalhesPopup.contagem.get(v) || 0}</small></label>`).join('')}
    ${vis.length > LIMITE_VALORES_FILTRO ? `<div class="pf-aviso">Mostrando ${LIMITE_VALORES_FILTRO} de ${vis.length} valores · use a pesquisa</div>` : ''}
    ${!vis.length ? '<div class="pf-aviso">Nenhum valor encontrado.</div>' : ''}`;
  lista._visiveis = mostrar;
}

function marcarValorFiltro(cb) {
  const v = document.getElementById('pfLista')._visiveis[Number(cb.dataset.i)];
  if (cb.checked) detalhesPopup.marcados.add(v); else detalhesPopup.marcados.delete(v);
  const vis = valoresVisiveisFiltro();
  const todos = document.querySelector('#pfLista .pf-todos input');
  if (todos) todos.checked = vis.every(x => detalhesPopup.marcados.has(x));
}

function marcarTodosFiltro(marcar) {
  valoresVisiveisFiltro().forEach(v => { if (marcar) detalhesPopup.marcados.add(v); else detalhesPopup.marcados.delete(v); });
  renderizarListaFiltro();
}

function confirmarFiltroColuna() {
  if (!detalhesPopup) return;
  const busca = (document.getElementById('pfBusca')?.value || '').trim();
  // Como no Excel: com pesquisa digitada, OK deixa só os valores marcados que aparecem na pesquisa
  const permitidos = busca
    ? new Set(valoresVisiveisFiltro().filter(v => detalhesPopup.marcados.has(v)))
    : detalhesPopup.marcados;
  const desmarcados = new Set(detalhesPopup.valores.filter(v => !permitidos.has(v)));
  if (desmarcados.size) detalhesFiltros[detalhesPopup.chave] = desmarcados;
  else delete detalhesFiltros[detalhesPopup.chave];
  fecharFiltroColuna();
  aplicarFiltrosDetalhes();
}

function limparFiltroColuna() {
  if (!detalhesPopup) return;
  delete detalhesFiltros[detalhesPopup.chave];
  fecharFiltroColuna();
  aplicarFiltrosDetalhes();
}

function limparTodosFiltrosDetalhes() {
  Object.keys(detalhesFiltros).forEach(k => delete detalhesFiltros[k]);
  detalhesOrdem = null;
  fecharFiltroColuna();
  aplicarFiltrosDetalhes();
}

function ordenarDetalhes(dir) {
  if (!detalhesPopup) return;
  detalhesOrdem = { chave: detalhesPopup.chave, dir };
  fecharFiltroColuna();
  aplicarFiltrosDetalhes();
}

function fecharFiltroColuna() {
  detalhesPopup = null;
  const popup = document.getElementById('popupFiltroDetalhes');
  if (popup) popup.style.display = 'none';
}

document.addEventListener('click', () => { if (detalhesPopup) fecharFiltroColuna(); });
document.addEventListener('keydown', e => {
  if (!detalhesPopup) return;
  if (e.key === 'Escape') fecharFiltroColuna();
  if (e.key === 'Enter' && e.target && e.target.id === 'pfBusca') confirmarFiltroColuna();
});
