/**
 * Aba "💰 Comissão": espelho do Relatório de Comissão do SavWin
 * (POR FAIXA · ANALÍTICO · FATURAMENTO), com as lojas e o período da consulta do BI.
 *
 * Como o SavWin calcula:
 *  - base de comissão = o que o cliente pagou da OS (OS com saldo em aberto entra só com o pago);
 *  - OS de períodos anteriores aparecem quando o cliente paga o saldo agora;
 *  - percentual pela FAIXA do vendedor (total da base dele no período, na tabela de comissão dele).
 * Roda sozinho ao clicar em "Consultar" no BI e tem o botão "Executar pesquisa".
 */

const OPCOES_CM = [
  ['incluiSaldoReceber', 'Incluir Saldo a Receber', false, 'Liga: a base passa a ser o valor líquido inteiro da OS, mesmo sem o cliente ter pago tudo'],
  ['consideraOSSaldoReceber', 'Considera OS Pendente (saldo a receber)', true, 'OS com saldo em aberto entram com o valor já pago'],
  ['consideraOSSemEntrega', 'Considera OS Pendente (sem entrega)', true, 'Desligado: só entram OS entregues'],
  ['subtraiTaxaAdm', 'Subtraí Taxa de Administração', false, 'Desconta a taxa do cartão da base']
];

const cm = {
  opcoes: Object.fromEntries(OPCOES_CM.map(([k, , p]) => [k, p])),
  dados: null, carregando: false, erro: '', precisaConfigurar: false, filtros: {},
  aberto: new Set(), busca: '', ordem: 'comissao', ultimaChave: ''
};
try { Object.assign(cm.opcoes, JSON.parse(localStorage.getItem('bi_comissao_opcoes') || '{}')); } catch { /* sem armazenamento */ }

const cmR = v => (typeof formatarMoedaBR === 'function' ? formatarMoedaBR(Number(v) || 0) : 'R$ ' + (Number(v) || 0).toFixed(2));
const cmN = (v, d = 2) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });
const cmDataBR = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ''); };
const cmData = br => { const [d, m, a] = String(br || '').split('/').map(Number); return a ? new Date(a, m - 1, d) : null; };

/** Lojas e período da última consulta do BI (ou dos campos da tela, se ainda não consultou). */
function cmFiltroBI() {
  const c = typeof ultimaConsultaBI !== 'undefined' && ultimaConsultaBI ? ultimaConsultaBI : null;
  const inicio = c ? c.inicioISO : (document.getElementById('dataInicial') || {}).value;
  const fim = c ? c.fimISO : (document.getElementById('dataFinal') || {}).value;
  let lojas = c ? c.lojas : (document.getElementById('lojas') || {}).value;
  if (!lojas && typeof epLojasDoUsuario === 'function') lojas = epLojasDoUsuario().join(',');
  return { inicio: inicio || '', fim: fim || '', lojas: String(lojas || '').split(/[,;\s]+/).map(x => x.replace(/\D/g, '')).filter(Boolean) };
}

function cmStatus(html) {
  const el = document.getElementById('cmStatus');
  if (!el) return;
  el.innerHTML = html || '';
  el.style.display = html ? '' : 'none';
}

function cmMudarOpcao(k, v) {
  cm.opcoes[k] = !!v;
  try { localStorage.setItem('bi_comissao_opcoes', JSON.stringify(cm.opcoes)); } catch { /* sem armazenamento */ }
  cmDesenharFiltros();
  if (cm.dados) cmExecutar();
}

function cmDesenharFiltros() {
  const el = document.getElementById('cmFiltros');
  if (!el) return;
  const f = cmFiltroBI();
  const nomeLoja = id => (typeof epNomeLoja === 'function' ? epNomeLoja(id) : id);
  const lojasTxt = f.lojas.length ? f.lojas.map(nomeLoja).join(' · ') : 'todas as suas lojas';
  el.innerHTML = `
    <div class="cm-linha">
      <div class="cm-campo"><span>Tipo</span><b>POR FAIXA</b></div>
      <div class="cm-campo"><span>Relatório</span><b>ANALÍTICO</b></div>
      <div class="cm-campo"><span>Base</span><b>FATURAMENTO</b></div>
      <div class="cm-campo"><span>Período (do BI)</span><b>${f.inicio ? `${cmDataBR(f.inicio)} a ${cmDataBR(f.fim)}` : 'consulte no BI'}</b></div>
      <div class="cm-campo"><span>Vendedor</span><b>Vendedor 1 · todos ativos</b></div>
    </div>
    <div class="cm-campo cm-lojas"><span>Lojas (do BI)</span><b title="${escHTML(lojasTxt)}">${escHTML(lojasTxt)}</b></div>
    <div class="cm-checks">${OPCOES_CM.map(([k, rot, , dica]) => `<label title="${escHTML(dica)}"><input type="checkbox" ${cm.opcoes[k] ? 'checked' : ''} onchange="cmMudarOpcao('${k}', this.checked)"> ${escHTML(rot)}</label>`).join('')}</div>
    <small class="cm-nota">As vendas de vendedores inativos não entram nas comissões. Para mudar lojas ou período, altere no topo do BI e clique em Consultar.</small>`;
}

/** Chamado pelo "Consultar" do BI. */
function cmAutoCarregar() {
  cmDesenharFiltros();
  cmExecutar(false, true);
}
/** Ao abrir a aba: mostra os filtros e, se ainda não tiver dados, consulta. */
function cmAoAbrir() {
  cmDesenharFiltros();
  if (!cm.dados && !cm.carregando && cmFiltroBI().inicio) cmExecutar();
  else cmRenderizar();
}

async function cmExecutar(atualizar = false, silencioso = false) {
  const f = cmFiltroBI();
  if (!f.inicio || !f.fim) { if (!silencioso) cmStatus('Escolha o período no topo do BI e clique em Consultar.'); return; }
  cmDesenharFiltros();
  const chave = JSON.stringify([f, cm.opcoes]);
  if (cm.carregando && cm.ultimaChave === chave) return;
  cm.carregando = true; cm.ultimaChave = chave; cm.erro = ''; cm.precisaConfigurar = false;
  const bt = document.getElementById('cmBtnExecutar');
  if (bt) { bt.disabled = true; bt.textContent = '⏳ Consultando…'; }
  const inicio = Date.now();
  const timer = setInterval(() => cmStatus(`⏳ Consultando o relatório de comissão no SavWin… ${Math.round((Date.now() - inicio) / 1000)} s`), 500);
  cmStatus('⏳ Consultando o relatório de comissão no SavWin…');
  try {
    const resp = await fetchAutenticado('/savwin/comissao', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ LOJAS: f.lojas.join(','), DATAINICIAL: f.inicio, DATAFINAL: f.fim, OPCOES: cm.opcoes, ATUALIZAR: atualizar === true })
    });
    const j = await resp.json().catch(() => ({}));
    if (cm.ultimaChave !== chave) return;                 // outra consulta começou depois
    if (resp.status === 409) { cm.precisaConfigurar = !!j.precisaConfigurar; throw new Error(j.error || 'Conecte o SavWin.'); }
    if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
    cm.dados = j;
    cm.aberto.clear();
  } catch (e) {
    cm.erro = e.message;
  } finally {
    clearInterval(timer);
    if (cm.ultimaChave === chave) {
      cm.carregando = false;
      if (bt) { bt.disabled = false; bt.textContent = '🔄 Executar pesquisa'; }
      cmStatus('');
      cmRenderizar();
    }
  }
}

/** Agrupa as OS por loja e, dentro de cada loja, por vendedor. */
function cmPorVendedor(linhas) {
  const m = new Map();
  linhas.forEach(l => {
    const k = `${l.loja}|${l.vendedorId || l.vendedor}`;
    let v = m.get(k);
    if (!v) { v = { chave: k, id: l.vendedorId, nome: l.vendedor, tabela: l.tabela, loja: l.loja, os: [], bruto: 0, liquido: 0, base: 0, comissao: 0, pct: new Set() }; m.set(k, v); }
    v.os.push(l); v.pct.add(l.percentual);
    v.bruto += l.bruto; v.liquido += l.liquido; v.base += l.base; v.comissao += l.comissao;
  });
  return [...m.values()];
}

/* ---------- filtros de coluna (igual ao filtro tipo Excel da aba Detalhes) ----------
 * Cada coluna guarda os valores DESMARCADOS. Vale por vendedor (linha da tabela). */
const COLUNAS_CM = [
  { k: 'loja', t: 'Loja', tipo: 'texto', txt: v => typeof epLojaCurta === 'function' ? epLojaCurta(v.loja) : v.loja },
  { k: 'nome', t: 'Vendedor', tipo: 'texto', txt: v => v.nome },
  { k: 'qtdOs', t: 'OS', tipo: 'num', num: v => v.os.length },
  { k: 'bruto', t: 'Total vendas', tipo: 'moeda', num: v => v.bruto },
  { k: 'liquido', t: 'Valor líquido', tipo: 'moeda', num: v => v.liquido },
  { k: 'base', t: 'Base comissão', tipo: 'moeda', num: v => v.base },
  { k: 'faixa', t: 'Faixa', tipo: 'num', num: v => Math.max(...v.pct), txt: v => [...v.pct].map(p => cmN(p) + '%').join(' / ') },
  { k: 'comissao', t: 'Comissão (R$)', tipo: 'moeda', num: v => v.comissao }
];
cm.filtros = {};
cm.lojasFechadas = new Set();
let cmPopup = null;
const cmColuna = k => COLUNAS_CM.find(c => c.k === k);
const cmTextoCol = (c, v) => c.txt ? c.txt(v) : c.tipo === 'moeda' ? cmR(c.num(v)) : cmN(c.num(v), 2);
const cmPassa = (v, ignorar = '') => COLUNAS_CM.every(c => c.k === ignorar || !cm.filtros[c.k] || !cm.filtros[c.k].has(cmTextoCol(c, v)));
const cmBuscaOk = v => { const b = cm.busca.trim().toUpperCase(); return !b || `${v.nome} ${v.loja}`.toUpperCase().includes(b); };

function cmLimparFiltros() { cm.filtros = {}; cm.busca = ''; cmFecharFiltro(); cmRenderizar(); }
function cmBuscar(valor) {
  cm.busca = valor;
  clearTimeout(window._cmF);
  window._cmF = setTimeout(() => {
    const el0 = document.getElementById('cmBusca'), pos = el0 ? el0.selectionStart : null;
    cmRenderizar();
    const el = document.getElementById('cmBusca');
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* sem cursor */ } }
  }, 250);
}

function cmAbrirFiltro(event, k) {
  event.stopPropagation();
  const col = cmColuna(k);
  if (!col || !cm.dados) return;
  if (cmPopup && cmPopup.k === k) return cmFecharFiltro();
  const base = cmPorVendedor(cm.dados.linhas || []).filter(v => cmBuscaOk(v) && cmPassa(v, k));
  const contagem = new Map(), numero = new Map();
  base.forEach(v => { const t = cmTextoCol(col, v); contagem.set(t, (contagem.get(t) || 0) + 1); if (col.num) numero.set(t, col.num(v)); });
  const desmarcados = cm.filtros[k] || new Set();
  desmarcados.forEach(t => { if (!contagem.has(t)) contagem.set(t, 0); });
  const valores = [...contagem.keys()].sort((a, b) => col.num ? (numero.get(a) ?? 0) - (numero.get(b) ?? 0) : a.localeCompare(b, 'pt-BR'));
  cmPopup = { k, col, valores, contagem, marcados: new Set(valores.filter(v => !desmarcados.has(v))) };

  let popup = document.getElementById('popupFiltroComissao');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'popupFiltroComissao';
    popup.className = 'popup-filtro';
    popup.addEventListener('click', e => e.stopPropagation());
    document.body.appendChild(popup);
  }
  const numerica = col.tipo !== 'texto';
  popup.innerHTML = `
    <div class="pf-titulo">${escHTML(col.t)}</div>
    <div class="pf-ordem">
      <button type="button" onclick="cmOrdenarFiltro(true)">↑ Classificar ${numerica ? 'do menor para o maior' : 'de A a Z'}</button>
      <button type="button" onclick="cmOrdenarFiltro(false)">↓ Classificar ${numerica ? 'do maior para o menor' : 'de Z a A'}</button>
    </div>
    <input type="search" id="cmPfBusca" placeholder="Pesquisar..." oninput="cmListaFiltro()">
    <div class="pf-lista" id="cmPfLista"></div>
    <div class="pf-rodape">
      <button type="button" class="pf-limpar" onclick="cmLimparFiltroColuna()">Limpar filtro</button>
      <span style="flex:1"></span>
      <button type="button" class="pf-cancelar" onclick="cmFecharFiltro()">Cancelar</button>
      <button type="button" class="pf-ok" onclick="cmConfirmarFiltro()">OK</button>
    </div>`;
  cmListaFiltro();
  const r = event.currentTarget.closest('th').getBoundingClientRect();
  popup.style.display = 'block';
  const largura = popup.offsetWidth;
  popup.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - largura - 8)) + 'px';
  popup.style.top = (window.scrollY + r.bottom + 4) + 'px';
  setTimeout(() => document.getElementById('cmPfBusca')?.focus(), 0);
}
function cmVisiveisFiltro() {
  const b = (document.getElementById('cmPfBusca')?.value || '').trim().toLowerCase();
  return cmPopup.valores.filter(v => !b || v.toLowerCase().includes(b));
}
function cmListaFiltro() {
  const lista = document.getElementById('cmPfLista');
  if (!lista || !cmPopup) return;
  const vis = cmVisiveisFiltro();
  const todos = vis.length && vis.every(v => cmPopup.marcados.has(v));
  lista.innerHTML = `
    <label class="pf-item pf-todos"><input type="checkbox" ${todos ? 'checked' : ''} onchange="cmMarcarTodos(this.checked)">
      <span>(Selecionar tudo${vis.length !== cmPopup.valores.length ? ' da pesquisa' : ''})</span></label>
    ${vis.map((v, i) => `<label class="pf-item"><input type="checkbox" data-i="${i}" ${cmPopup.marcados.has(v) ? 'checked' : ''} onchange="cmMarcarValor(this)">
      <span>${escHTML(v)}</span><small>${cmPopup.contagem.get(v) || 0}</small></label>`).join('')}
    ${!vis.length ? '<div class="pf-aviso">Nenhum valor encontrado.</div>' : ''}`;
  lista._visiveis = vis;
}
function cmMarcarValor(cb) {
  const v = document.getElementById('cmPfLista')._visiveis[Number(cb.dataset.i)];
  if (cb.checked) cmPopup.marcados.add(v); else cmPopup.marcados.delete(v);
  const todos = document.querySelector('#cmPfLista .pf-todos input');
  if (todos) todos.checked = cmVisiveisFiltro().every(x => cmPopup.marcados.has(x));
}
function cmMarcarTodos(marcar) {
  cmVisiveisFiltro().forEach(v => { if (marcar) cmPopup.marcados.add(v); else cmPopup.marcados.delete(v); });
  cmListaFiltro();
}
function cmConfirmarFiltro() {
  if (!cmPopup) return;
  const b = (document.getElementById('cmPfBusca')?.value || '').trim();
  // como no Excel: com pesquisa digitada, OK deixa só os marcados que aparecem na pesquisa
  const permitidos = b ? new Set(cmVisiveisFiltro().filter(v => cmPopup.marcados.has(v))) : cmPopup.marcados;
  const desmarcados = new Set(cmPopup.valores.filter(v => !permitidos.has(v)));
  if (desmarcados.size) cm.filtros[cmPopup.k] = desmarcados; else delete cm.filtros[cmPopup.k];
  cmFecharFiltro();
  cmRenderizar();
}
function cmLimparFiltroColuna() { if (!cmPopup) return; delete cm.filtros[cmPopup.k]; cmFecharFiltro(); cmRenderizar(); }
function cmOrdenarFiltro(crescente) {
  if (!cmPopup) return;
  cm.ordem = cmPopup.k + (crescente ? '_asc' : '');
  cmFecharFiltro();
  cmRenderizar();
}
function cmFecharFiltro() {
  cmPopup = null;
  const p = document.getElementById('popupFiltroComissao');
  if (p) p.style.display = 'none';
}
document.addEventListener('click', () => { if (cmPopup) cmFecharFiltro(); });
document.addEventListener('keydown', e => {
  if (!cmPopup) return;
  if (e.key === 'Escape') cmFecharFiltro();
  if (e.key === 'Enter' && e.target && e.target.id === 'cmPfBusca') cmConfirmarFiltro();
});

function cmOrdenar(c) { cm.ordem = cm.ordem === c ? c + '_asc' : c; cmRenderizar(); }
function cmAlternar(k) { if (cm.aberto.has(k)) cm.aberto.delete(k); else cm.aberto.add(k); cmRenderizar(); }
function cmAlternarLoja(k) { if (cm.lojasFechadas.has(k)) cm.lojasFechadas.delete(k); else cm.lojasFechadas.add(k); cmRenderizar(); }

function cmRenderizar() {
  const el = document.getElementById('cmConteudo');
  if (!el) return;
  if (cm.carregando && !cm.dados) { el.innerHTML = ''; return; }
  if (cm.erro) {
    el.innerHTML = `<div class="cm-erro">⚠️ ${escHTML(cm.erro)} ${cm.precisaConfigurar && typeof abrirConexaoSavwin === 'function' ? '<button type="button" class="tv-link" onclick="abrirConexaoSavwin()">🔌 Configurar conexão</button>' : ''}</div>`;
    return;
  }
  if (!cm.dados) { el.innerHTML = '<p class="cm-vazio">Clique em <b>Consultar</b> no topo do BI (ou em Executar pesquisa) para trazer a comissão do período.</p>'; return; }
  const linhas = cm.dados.linhas || [];
  if (!linhas.length) { el.innerHTML = '<p class="cm-vazio">Não foram encontrados dados de comissão para os filtros aplicados.</p>'; return; }

  const soma = (lista, f) => lista.reduce((t, x) => t + (f(x) || 0), 0);
  const ini = cmData(cm.dados.inicio);
  const todos = cmPorVendedor(linhas);
  let vend = todos.filter(v => cmBuscaOk(v) && cmPassa(v));
  const asc = cm.ordem.endsWith('_asc'), campo = cm.ordem.replace('_asc', '');
  const val = v => campo === 'nome' ? v.nome : campo === 'loja' ? v.loja : campo === 'qtdOs' ? v.os.length : campo === 'faixa' ? Math.max(...v.pct) : v[campo];
  const cmp = (a, b) => { const r = typeof a === 'string' ? a.localeCompare(b) : a - b; return asc ? r : -r; };
  vend.sort((a, b) => cmp(val(a), val(b)));

  // lojas: na ordem do mesmo campo (somado), vendedores dentro
  const lojas = new Map();
  vend.forEach(v => { if (!lojas.has(v.loja)) lojas.set(v.loja, []); lojas.get(v.loja).push(v); });
  const valLoja = vs => campo === 'qtdOs' ? soma(vs, v => v.os.length) : campo === 'faixa' ? Math.max(...vs.map(val)) : soma(vs, v => v[campo]);
  const grupos = [...lojas.entries()].sort((a, b) => ['nome', 'loja'].includes(campo) ? (campo === 'loja' ? cmp(a[0], b[0]) : a[0].localeCompare(b[0])) : cmp(valLoja(a[1]), valLoja(b[1])));

  const osVis = vend.flatMap(v => v.os);
  const anteriores = osVis.filter(l => ini && cmData(l.data) && cmData(l.data) < ini);
  const parciais = osVis.filter(l => l.base < l.liquido - 0.01);
  const filtrando = vend.length !== todos.length;
  const btnF = k => `<button type="button" class="btn-filtro-col" onclick="cmAbrirFiltro(event, '${k}')" title="Filtrar / ordenar">${cm.filtros[k] && cm.filtros[k].size ? '⏷' : '▾'}</button>`;
  const seta = c => campo === c ? (asc ? ' ↑' : ' ↓') : '';
  const th = (c, t, cls = 'num') => `<th class="${cls} th-filtro${cm.filtros[c] && cm.filtros[c].size ? ' filtrada' : ''}"><span class="cm-ord" onclick="cmOrdenar('${c}')">${t}${seta(c)}</span> ${btnF(c)}</th>`;
  const nFiltros = Object.values(cm.filtros).filter(x => x && x.size).length;
  const pctTxt = v => [...v.pct].map(p => cmN(p) + '%').join(' / ');
  const quando = new Date(cm.dados.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const curta = l => escHTML(typeof epLojaCurta === 'function' ? epLojaCurta(l) : l);

  el.innerHTML = `
    <div class="cm-cards">
      <div class="cm-card"><span>Base de comissão</span><b>${cmR(soma(osVis, l => l.base))}</b><small>líquido das OS: ${cmR(soma(osVis, l => l.liquido))}</small></div>
      <div class="cm-card destaque"><span>Comissão total</span><b>${cmR(soma(osVis, l => l.comissao))}</b><small>${cmN(soma(osVis, l => l.comissao) / (soma(osVis, l => l.base) || 1) * 100)}% da base</small></div>
      <div class="cm-card"><span>OS</span><b>${osVis.length}</b><small>${grupos.length} loja(s) · total de vendas ${cmR(soma(osVis, l => l.bruto))}</small></div>
      <div class="cm-card"><span>Vendedores</span><b>${new Set(vend.map(v => v.id || v.nome)).size}</b><small>${parciais.length} OS com pagamento parcial · ${anteriores.length} OS de períodos anteriores</small></div>
    </div>
    <div class="cm-barra">
      <input type="search" id="cmBusca" placeholder="buscar vendedor ou loja…" value="${escHTML(cm.busca)}" oninput="cmBuscar(this.value)">
      <small>SavWin de ${quando} · ${escHTML(cm.dados.inicio)} a ${escHTML(cm.dados.fim)} · clique na loja para recolher e no vendedor para ver as OS${filtrando ? ` · <b>exibindo ${vend.length} de ${todos.length} vendedores${nFiltros ? ` · ${nFiltros} filtro(s)` : ''}</b> <button type="button" class="tv-link" onclick="cmLimparFiltros()">✖ Limpar filtros</button>` : ''}</small>
      <span class="ep-exportar">⬇ Exportar <button type="button" class="tv-link" onclick="cmExportar('xlsx')">Excel</button> · <button type="button" class="tv-link" onclick="cmExportar('csv')">CSV</button></span>
    </div>
    <div class="cm-tabela-wrap">
      <table class="ee-tabela cm-tabela">
        <thead><tr><th class="th-filtro${['loja', 'nome'].some(k => cm.filtros[k] && cm.filtros[k].size) ? ' filtrada' : ''}"><span class="cm-ord" onclick="cmOrdenar('loja')">Loja${seta('loja')}</span> ${btnF('loja')} <span class="cm-barra-sep">/</span> <span class="cm-ord" onclick="cmOrdenar('nome')">Vendedor${seta('nome')}</span> ${btnF('nome')}</th>${th('qtdOs', 'OS')}${th('bruto', 'Total vendas')}${th('liquido', 'Valor líquido')}${th('base', 'Base comissão')}${th('faixa', 'Faixa')}${th('comissao', 'Comissão (R$)')}</tr></thead>
        <tbody>${grupos.length ? grupos.map(([loja, vs]) => {
          const fechada = cm.lojasFechadas.has(loja);
          return `<tr class="cm-loja" onclick="cmAlternarLoja('${escHTML(loja).replace(/'/g, '')}')">
              <td><span class="cm-seta">${fechada ? '▸' : '▾'}</span> 🏬 ${curta(loja)} <small>${vs.length} vendedor(es)</small></td>
              <td class="num">${soma(vs, v => v.os.length)}</td><td class="num">${cmR(soma(vs, v => v.bruto))}</td><td class="num">${cmR(soma(vs, v => v.liquido))}</td>
              <td class="num">${cmR(soma(vs, v => v.base))}</td><td></td><td class="num">${cmR(soma(vs, v => v.comissao))}</td></tr>
            ${fechada ? '' : vs.map(v => {
              const k = escHTML(v.chave).replace(/'/g, '');
              const aberto = cm.aberto.has(v.chave);
              return `<tr class="ee-prod cm-vend" onclick="cmAlternar('${k}')">
                  <td class="ee-nome cm-recuo"><span class="cm-seta">${aberto ? '▾' : '▸'}</span> ${escHTML(v.nome)}<small>tabela ${escHTML(v.tabela || '—')}</small></td>
                  <td class="num">${v.os.length}</td><td class="num">${cmR(v.bruto)}</td><td class="num">${cmR(v.liquido)}</td>
                  <td class="num"><b>${cmR(v.base)}</b></td><td class="num">${pctTxt(v)}</td><td class="num"><b class="cm-com">${cmR(v.comissao)}</b></td></tr>
                ${aberto ? `<tr class="cm-det"><td colspan="7">${cmTabelaOS(v.os, ini)}</td></tr>` : ''}`;
            }).join('')}`;
        }).join('') : '<tr><td colspan="7" class="cm-vazio">Nenhum vendedor com esses filtros.</td></tr>'}</tbody>
        <tfoot><tr><td>TOTAL ${filtrando ? 'FILTRADO' : 'GERAL'}</td><td class="num">${osVis.length}</td>
          <td class="num">${cmR(soma(vend, v => v.bruto))}</td><td class="num">${cmR(soma(vend, v => v.liquido))}</td><td class="num">${cmR(soma(vend, v => v.base))}</td><td></td><td class="num">${cmR(soma(vend, v => v.comissao))}</td></tr></tfoot>
      </table>
    </div>`;
}

function cmTabelaOS(lista, ini) {
  const ord = lista.slice().sort((a, b) => (cmData(a.data) || 0) - (cmData(b.data) || 0) || Number(a.os) - Number(b.os));
  return `<table class="cm-os">
    <thead><tr><th>OS</th><th>Data</th><th class="num">Total vendas</th><th class="num">Valor líquido</th><th class="num">Base comissão</th><th class="num">%</th><th class="num">Comissão</th></tr></thead>
    <tbody>${ord.map(l => {
      const ant = ini && cmData(l.data) && cmData(l.data) < ini;
      const parcial = l.base < l.liquido - 0.01;
      return `<tr><td>${escHTML(l.os)}</td>
        <td>${escHTML(l.data)}${ant ? ' <span class="cm-tag" title="OS de período anterior: entrou agora porque o cliente pagou o saldo">anterior</span>' : ''}</td>
        <td class="num">${cmR(l.bruto)}</td><td class="num">${cmR(l.liquido)}</td>
        <td class="num">${cmR(l.base)}${parcial ? ` <span class="cm-tag parcial" title="Cliente pagou ${cmN(l.base / (l.liquido || 1) * 100, 0)}% da OS">pago parcial</span>` : ''}</td>
        <td class="num">${cmN(l.percentual)}</td><td class="num">${cmR(l.comissao)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

function cmExportar(formato) {
  if (!cm.dados || !(cm.dados.linhas || []).length) return;
  const cab = ['Loja', 'Cód. vendedor', 'Vendedor', 'Tabela', 'OS', 'Data', 'Total vendas', 'Valor líquido', 'Base comissão', 'Comissão (%)', 'Comissão (R$)', 'Observação'];
  const ini = cmData(cm.dados.inicio);
  const linhas = cm.dados.linhas.slice().sort((a, b) => a.loja.localeCompare(b.loja) || a.vendedor.localeCompare(b.vendedor) || Number(a.os) - Number(b.os)).map(l => {
    const [cod, ...nome] = String(l.vendedor).split(' - ');
    const obs = [ini && cmData(l.data) && cmData(l.data) < ini ? 'OS de período anterior' : '', l.base < l.liquido - 0.01 ? 'pago parcial' : ''].filter(Boolean).join(' · ');
    return [l.loja, cod, nome.join(' - ') || l.vendedor, l.tabela, l.os, l.data, l.bruto, l.liquido, l.base, l.percentual, Math.round(l.comissao * 100) / 100, obs];
  });
  if (typeof epBaixarPlanilha === 'function') {
    epBaixarPlanilha(cab, linhas, `comissao_${String(cm.dados.inicio).replace(/\//g, '-')}_a_${String(cm.dados.fim).replace(/\//g, '-')}`, formato, ['Total vendas', 'Valor líquido', 'Base comissão', 'Comissão (R$)']);
  }
}
