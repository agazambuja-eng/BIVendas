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
  dados: null, carregando: false, erro: '', precisaConfigurar: false,
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

/** Agrupa as OS por vendedor. */
function cmPorVendedor(linhas) {
  const m = new Map();
  linhas.forEach(l => {
    let v = m.get(l.vendedorId || l.vendedor);
    if (!v) { v = { id: l.vendedorId, nome: l.vendedor, tabela: l.tabela, lojas: new Set(), os: [], pecas: 0, bruto: 0, liquido: 0, base: 0, comissao: 0, pct: new Set() }; m.set(l.vendedorId || l.vendedor, v); }
    v.lojas.add(l.loja); v.os.push(l); v.pct.add(l.percentual);
    v.pecas += l.pecas; v.bruto += l.bruto; v.liquido += l.liquido; v.base += l.base; v.comissao += l.comissao;
  });
  return [...m.values()];
}

function cmOrdenar(c) { cm.ordem = cm.ordem === c ? c + '_asc' : c; cmRenderizar(); }
function cmAlternar(id) { if (cm.aberto.has(id)) cm.aberto.delete(id); else cm.aberto.add(id); cmRenderizar(); }

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
  const anteriores = linhas.filter(l => ini && cmData(l.data) && cmData(l.data) < ini);
  const parciais = linhas.filter(l => l.base < l.liquido - 0.01);
  let vend = cmPorVendedor(linhas);
  const busca = cm.busca.trim().toUpperCase();
  if (busca) vend = vend.filter(v => `${v.nome} ${[...v.lojas].join(' ')}`.toUpperCase().includes(busca));
  const asc = cm.ordem.endsWith('_asc'), campo = cm.ordem.replace('_asc', '');
  vend.sort((a, b) => {
    const va = campo === 'nome' ? a.nome : campo === 'os' ? a.os.length : a[campo];
    const vb = campo === 'nome' ? b.nome : campo === 'os' ? b.os.length : b[campo];
    const r = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return asc ? r : -r;
  });
  const th = (c, t, cls = 'num') => `<th class="${cls} cm-ord" onclick="cmOrdenar('${c}')">${t}${campo === c ? (asc ? ' ▲' : ' ▼') : ''}</th>`;
  const pctTxt = v => [...v.pct].map(p => cmN(p) + '%').join(' / ');
  const quando = new Date(cm.dados.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  el.innerHTML = `
    <div class="cm-cards">
      <div class="cm-card"><span>Base de comissão</span><b>${cmR(soma(linhas, l => l.base))}</b><small>líquido das OS: ${cmR(soma(linhas, l => l.liquido))}</small></div>
      <div class="cm-card destaque"><span>Comissão total</span><b>${cmR(soma(linhas, l => l.comissao))}</b><small>${cmN(soma(linhas, l => l.comissao) / (soma(linhas, l => l.base) || 1) * 100)}% da base</small></div>
      <div class="cm-card"><span>OS</span><b>${linhas.length}</b><small>${cmN(soma(linhas, l => l.pecas), 0)} peças · bruto ${cmR(soma(linhas, l => l.bruto))}</small></div>
      <div class="cm-card"><span>Vendedores</span><b>${cmPorVendedor(linhas).length}</b><small>${parciais.length} OS com pagamento parcial · ${anteriores.length} OS de períodos anteriores</small></div>
    </div>
    <div class="cm-barra">
      <input type="search" placeholder="buscar vendedor ou loja…" value="${escHTML(cm.busca)}" oninput="cm.busca = this.value; clearTimeout(window._cmT); window._cmT = setTimeout(cmRenderizar, 250)">
      <small>SavWin de ${quando} · ${escHTML(cm.dados.inicio)} a ${escHTML(cm.dados.fim)} · clique no vendedor para ver as OS</small>
      <span class="ep-exportar">⬇ Exportar <button type="button" class="tv-link" onclick="cmExportar('xlsx')">Excel</button> · <button type="button" class="tv-link" onclick="cmExportar('csv')">CSV</button></span>
    </div>
    <div class="cm-tabela-wrap">
      <table class="ee-tabela cm-tabela">
        <thead><tr>${th('nome', 'Vendedor', '')}<th>Loja</th>${th('os', 'OS')}${th('pecas', 'Peças')}${th('bruto', 'Total vendas')}${th('liquido', 'Valor líquido')}${th('base', 'Base comissão')}<th class="num">Faixa</th>${th('comissao', 'Comissão (R$)')}</tr></thead>
        <tbody>${vend.map(v => {
          const id = escHTML(v.id || v.nome);
          const aberto = cm.aberto.has(v.id || v.nome);
          return `<tr class="ee-prod cm-vend" onclick="cmAlternar('${id.replace(/'/g, '')}')">
              <td class="ee-nome"><span class="cm-seta">${aberto ? '▾' : '▸'}</span> ${escHTML(v.nome)}<small>tabela ${escHTML(v.tabela || '—')}</small></td>
              <td>${[...v.lojas].map(l => escHTML(typeof epLojaCurta === 'function' ? epLojaCurta(l) : l)).join('<br>')}</td>
              <td class="num">${v.os.length}</td><td class="num">${cmN(v.pecas, 0)}</td>
              <td class="num">${cmR(v.bruto)}</td><td class="num">${cmR(v.liquido)}</td>
              <td class="num"><b>${cmR(v.base)}</b></td><td class="num">${pctTxt(v)}</td><td class="num"><b class="cm-com">${cmR(v.comissao)}</b></td></tr>
            ${aberto ? `<tr class="cm-det"><td colspan="9">${cmTabelaOS(v.os, ini)}</td></tr>` : ''}`;
        }).join('')}</tbody>
        <tfoot><tr><td>TOTAL GERAL</td><td></td><td class="num">${soma(vend, v => v.os.length)}</td><td class="num">${cmN(soma(vend, v => v.pecas), 0)}</td>
          <td class="num">${cmR(soma(vend, v => v.bruto))}</td><td class="num">${cmR(soma(vend, v => v.liquido))}</td><td class="num">${cmR(soma(vend, v => v.base))}</td><td></td><td class="num">${cmR(soma(vend, v => v.comissao))}</td></tr></tfoot>
      </table>
    </div>`;
}

function cmTabelaOS(lista, ini) {
  const ord = lista.slice().sort((a, b) => (cmData(a.data) || 0) - (cmData(b.data) || 0) || Number(a.os) - Number(b.os));
  return `<table class="cm-os">
    <thead><tr><th>Loja</th><th>OS</th><th>Data</th><th class="num">Peças</th><th class="num">Total vendas</th><th class="num">Serviço</th><th class="num">Valor líquido</th><th class="num">Base comissão</th><th class="num">%</th><th class="num">Comissão</th></tr></thead>
    <tbody>${ord.map(l => {
      const ant = ini && cmData(l.data) && cmData(l.data) < ini;
      const parcial = l.base < l.liquido - 0.01;
      return `<tr><td>${escHTML(typeof epLojaCurta === 'function' ? epLojaCurta(l.loja) : l.loja)}</td><td>${escHTML(l.os)}</td>
        <td>${escHTML(l.data)}${ant ? ' <span class="cm-tag" title="OS de período anterior: entrou agora porque o cliente pagou o saldo">anterior</span>' : ''}</td>
        <td class="num">${cmN(l.pecas, 0)}</td><td class="num">${cmR(l.bruto)}</td><td class="num">${cmR(l.servico)}</td><td class="num">${cmR(l.liquido)}</td>
        <td class="num">${cmR(l.base)}${parcial ? ` <span class="cm-tag parcial" title="Cliente pagou ${cmN(l.base / (l.liquido || 1) * 100, 0)}% da OS">pago parcial</span>` : ''}</td>
        <td class="num">${cmN(l.percentual)}</td><td class="num">${cmR(l.comissao)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

function cmExportar(formato) {
  if (!cm.dados || !(cm.dados.linhas || []).length) return;
  const cab = ['Loja', 'OS', 'Data', 'Cód. vendedor', 'Vendedor', 'Tabela', 'Peças', 'Total vendas', 'Serviço', 'Valor líquido', 'Base comissão', 'Comissão (R$)', 'Comissão (%)', 'Observação'];
  const ini = cmData(cm.dados.inicio);
  const linhas = cm.dados.linhas.map(l => {
    const [cod, ...nome] = String(l.vendedor).split(' - ');
    const obs = [ini && cmData(l.data) && cmData(l.data) < ini ? 'OS de período anterior' : '', l.base < l.liquido - 0.01 ? 'pago parcial' : ''].filter(Boolean).join(' · ');
    return [l.loja, l.os, l.data, cod, nome.join(' - ') || l.vendedor, l.tabela, l.pecas, l.bruto, l.servico, l.liquido, l.base, Math.round(l.comissao * 100) / 100, l.percentual, obs];
  });
  if (typeof epBaixarPlanilha === 'function') {
    epBaixarPlanilha(cab, linhas, `comissao_${String(cm.dados.inicio).replace(/\//g, '-')}_a_${String(cm.dados.fim).replace(/\//g, '-')}`, formato, ['Total vendas', 'Serviço', 'Valor líquido', 'Base comissão', 'Comissão (R$)']);
  }
}
