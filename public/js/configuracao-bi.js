/**
 * Configurações › 📊 Configuração do BI
 *  1. Planos de contas (mercadoria) e linhas de produto (compra para estoque): configuracoes_bi.cmv_compras
 *     + catálogo de nomes (catalogo_planos_contas / catalogo_linhas_produto); importar CSV/Excel.
 *  2. Planos de contas por usuário: configuracoes_bi.cmv_planos_por_usuario = { usuarioId: [planos] } (vazio = todos).
 *  3. Conexão SavWin de cada usuário: /savwin/conexao-usuario (o servidor testa o login e grava cifrado).
 */
const $c = id => document.getElementById(id);
const CFG_PADRAO = { linhas: ['ARMACAO RX', 'ARMACAO SUN', 'ARMACAO CLIPON'], planos: [], cmvAlvo: 40, reserva: 10, cobertura: 3 };
const cfg = {
  compras: { ...CFG_PADRAO }, catalogo: { planos: [], linhas: [] }, porUsuario: {}, usuarios: [],
  marcados: { planos: new Set(), linhas: new Set() }, usuarioSel: null, erroTabela: ''
};

function cfgMsg(t, tipo = '') { const el = $c('cfgbiMsg'); el.className = 'acesso-msg ' + tipo; el.textContent = t || ''; }
const ehAdmin = () => temPermissao('gerenciar_usuarios');

function cfgAba(a) {
  document.querySelectorAll('#cfgbiAbas button').forEach(b => b.classList.toggle('ativo', b.dataset.a === a));
  $c('abaPlanos').style.display = a === 'planos' ? '' : 'none';
  $c('abaUsuarios').style.display = a === 'usuarios' ? '' : 'none';
  $c('abaSavwin').style.display = a === 'savwin' ? '' : 'none';
  $c('abaIa').style.display = a === 'ia' ? '' : 'none';
  cfgMsg('');
}

// ------------------------------------------------------------------ carregar
async function cfgCarregar() {
  try {
    const { data, error } = await supabaseBI.from('configuracoes_bi').select('chave, valor')
      .in('chave', ['cmv_compras', 'catalogo_planos_contas', 'catalogo_linhas_produto', 'cmv_planos_por_usuario', 'ia']);
    if (error) throw error;
    (data || []).forEach(r => {
      if (r.chave === 'cmv_compras') cfg.compras = { ...CFG_PADRAO, ...(r.valor || {}) };
      if (r.chave === 'catalogo_planos_contas') cfg.catalogo.planos = (r.valor && r.valor.nomes) || [];
      if (r.chave === 'catalogo_linhas_produto') cfg.catalogo.linhas = (r.valor && r.valor.nomes) || [];
      if (r.chave === 'cmv_planos_por_usuario') cfg.porUsuario = r.valor || {};
      if (r.chave === 'ia') cfg.ia = r.valor || {};
    });
  } catch (e) {
    cfg.erroTabela = /configuracoes_bi|relation|schema cache|does not exist/i.test(e.message || '')
      ? 'Rode no Supabase o arquivo database/13_configuracoes_bi.sql para gravar estas configurações.' : e.message;
    cfgMsg(cfg.erroTabela, 'erro');
  }
  cfg.marcados.planos = new Set(cfg.compras.planos || []);
  cfg.marcados.linhas = new Set(cfg.compras.linhas || []);
  if (ehAdmin()) {
    const { data } = await supabaseBI.from('usuarios').select('*').order('nome');
    cfg.usuarios = (data || []).filter(u => u.ativo !== false);
  }
}

// ------------------------------------------------------------------ 1. planos e linhas
const todosPlanos = () => [...new Set([...cfg.catalogo.planos, ...(cfg.compras.planos || []), ...cfg.marcados.planos])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
const todasLinhas = () => [...new Set([...cfg.catalogo.linhas, ...(cfg.compras.linhas || []), ...cfg.marcados.linhas])].sort();

function cfgDesenharListas() {
  const caixa = (tipo, lista) => lista.map(n => `<label class="check"><input type="checkbox" value="${escHTML(n)}" ${cfg.marcados[tipo].has(n) ? 'checked' : ''} onchange="cfgMarcar('${tipo}', this)"> ${escHTML(n)}</label>`).join('')
    || '<p class="acesso-ajuda">Nenhum nome ainda: consulte a aba CMV no BI ou importe um arquivo.</p>';
  $c('listaPlanos').innerHTML = caixa('planos', todosPlanos());
  $c('listaLinhas').innerHTML = caixa('linhas', todasLinhas());
  $c('contaPlanos').textContent = `${cfg.marcados.planos.size} de ${todosPlanos().length} marcados como mercadoria · nenhum marcado = a Análise CMV usa o próprio filtro`;
}
function cfgMarcar(tipo, cb) { if (cb.checked) cfg.marcados[tipo].add(cb.value); else cfg.marcados[tipo].delete(cb.value); if (tipo === 'planos') cfgDesenharContagem(); }
function cfgDesenharContagem() { $c('contaPlanos').textContent = `${cfg.marcados.planos.size} de ${todosPlanos().length} marcados como mercadoria · nenhum marcado = a Análise CMV usa o próprio filtro`; }
function cfgFiltrar(tipo, txt) {
  const id = { planos: 'listaPlanos', linhas: 'listaLinhas', planosUsuario: 'listaPlanosUsuario' }[tipo];
  const t = String(txt || '').trim().toUpperCase();
  document.querySelectorAll(`#${id} label`).forEach(l => { l.hidden = !!t && !l.textContent.toUpperCase().includes(t); });
}
function cfgMarcarVisiveis(tipo, marcar) {
  const id = { planos: 'listaPlanos', linhas: 'listaLinhas', planosUsuario: 'listaPlanosUsuario' }[tipo];
  document.querySelectorAll(`#${id} label:not([hidden]) input`).forEach(i => { i.checked = marcar; if (tipo !== 'planosUsuario') cfgMarcar(tipo, i); });
}
function cfgIncluir(tipo) {
  const campo = $c(tipo === 'planos' ? 'novoPlano' : 'novaLinha');
  let n = String(campo.value || '').trim().replace(/\s+/g, ' ');
  if (!n) return;
  if (tipo === 'linhas') n = n.toUpperCase();
  if (tipo === 'planos') cfg.catalogo.planos.push(n); else cfg.catalogo.linhas.push(n);
  cfg.marcados[tipo].add(n);
  cfgPendentes[tipo].add(n);
  campo.value = '';
  cfgDesenharListas();
  cfgMsg(`"${n}" incluído e marcado. Clique em Salvar.`, 'ok');
}
const cfgPendentes = { planos: new Set(), linhas: new Set() };   // nomes novos para gravar no catálogo

let sheetJS = null;
function carregarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (sheetJS) return sheetJS;
  sheetJS = new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => ok(window.XLSX); s.onerror = () => { sheetJS = null; falha(new Error('não foi possível carregar o leitor de Excel; salve como CSV')); };
    document.head.appendChild(s);
  });
  return sheetJS;
}
/** CSV (; , ou tab) ou Excel: 1ª coluna nome, 2ª coluna opcional S/N. */
async function cfgImportar(tipo, input) {
  const arq = input.files && input.files[0];
  input.value = '';
  if (!arq) return;
  let linhas = [];
  try {
    if (/\.xlsx?$/i.test(arq.name)) {
      const XLSX = await carregarSheetJS();
      const wb = XLSX.read(await arq.arrayBuffer(), { type: 'array' });
      linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
    } else {
      const txt = (await arq.text()).replace(/^﻿/, '');
      const sep = (txt.split(/\r?\n/)[0].match(/;|\t|,/) || [';'])[0];
      linhas = txt.split(/\r?\n/).map(l => l.split(sep).map(x => x.replace(/^"|"$/g, '').trim()));
    }
  } catch (e) { cfgMsg(`Não consegui ler o arquivo: ${e.message}`, 'erro'); return; }
  linhas = linhas.filter(l => l && String(l[0] || '').trim());
  if (linhas.length && /^(nome|plano|linha|descri|tipo)/i.test(String(linhas[0][0]))) linhas.shift();
  // aceita também o arquivo exportado daqui: Tipo; Nome; Marcado
  if (linhas.length && linhas[0].length >= 3 && /plano|linha/i.test(String(linhas[0][0]))) {
    linhas = linhas.filter(l => (tipo === 'planos' ? /plano/i : /linha/i).test(String(l[0]))).map(l => [l[1], l[2]]);
  }
  const norm = n => tipo === 'linhas' ? String(n).trim().toUpperCase() : String(n).trim().replace(/\s+/g, ' ');
  const temMarca = linhas.some(l => l[1] !== undefined && String(l[1]).trim() !== '');
  let marcados = 0;
  linhas.forEach(l => {
    const n = norm(l[0]);
    if (!n) return;
    if (tipo === 'planos') cfg.catalogo.planos.push(n); else cfg.catalogo.linhas.push(n);
    cfgPendentes[tipo].add(n);
    const marcar = !temMarca || /^(s|sim|x|1|true|y|yes)$/i.test(String(l[1] || '').trim());
    if (marcar) { cfg.marcados[tipo].add(n); marcados++; } else cfg.marcados[tipo].delete(n);
  });
  cfg.catalogo[tipo] = [...new Set(cfg.catalogo[tipo])];
  cfgDesenharListas();
  cfgMsg(`${linhas.length} nome(s) lido(s), ${marcados} marcado(s). Confira e clique em Salvar.`, 'ok');
}
function cfgExportarPlanos() {
  const linhas = [
    ...todasLinhas().map(n => ['linha de produto', n, cfg.marcados.linhas.has(n) ? 'S' : 'N']),
    ...todosPlanos().map(n => ['plano de contas', n, cfg.marcados.planos.has(n) ? 'S' : 'N'])
  ];
  const cel = v => `"${String(v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [['Tipo', 'Nome', 'Marcado (S/N)'], ...linhas].map(l => l.map(cel).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'configuracao_planos_linhas.csv';
  a.click();
}
async function cfgSalvarPlanos() {
  if (!cfg.marcados.linhas.size) { cfgMsg('Marque pelo menos uma linha de produto comprada para estoque.', 'erro'); return; }
  const bt = $c('btnSalvarPlanos'); bt.disabled = true;
  try {
    for (const tipo of ['planos', 'linhas']) {
      const nomes = [...cfgPendentes[tipo]];
      if (nomes.length) {
        const { error } = await supabaseBI.rpc('registrar_catalogo_bi', { p_chave: tipo === 'planos' ? 'catalogo_planos_contas' : 'catalogo_linhas_produto', p_nomes: nomes });
        if (error) throw error;
        cfgPendentes[tipo].clear();
      }
    }
    const valor = { ...cfg.compras, planos: [...cfg.marcados.planos].sort(), linhas: [...cfg.marcados.linhas].sort() };
    const { error } = await supabaseBI.from('configuracoes_bi').upsert({ chave: 'cmv_compras', valor }, { onConflict: 'chave' });
    if (error) throw error;
    cfg.compras = valor;
    cfgMsg('✅ Salvo. Vale para todos na próxima vez que abrirem o CMV.', 'ok');
  } catch (e) {
    cfgMsg(/configuracoes_bi|registrar_catalogo|relation|schema cache|does not exist/i.test(e.message || '') ? 'Rode no Supabase o arquivo database/13_configuracoes_bi.sql e tente de novo.' : `Não foi possível salvar: ${e.message}`, 'erro');
  } finally { bt.disabled = false; }
}

// ------------------------------------------------------------------ 2. planos por usuário
function cfgListaUsuarios(busca = '') {
  const b = String(busca).trim().toLowerCase();
  const lista = cfg.usuarios.filter(u => !b || `${u.nome} ${u.login}`.toLowerCase().includes(b));
  $c('listaUsuariosPlanos').innerHTML = lista.map(u => {
    const n = (cfg.porUsuario[u.id] || []).length;
    return `<button type="button" class="cfgbi-usuario ${cfg.usuarioSel === u.id ? 'ativo' : ''}" onclick="cfgEscolherUsuario('${u.id}')">
      <b>${escHTML(u.nome)}</b><small>${escHTML(u.login)} · ${n ? `🔒 ${n} plano(s)` : 'todos os planos'}</small></button>`;
  }).join('') || '<p class="acesso-ajuda">Nenhum usuário.</p>';
}
function cfgEscolherUsuario(id) {
  cfg.usuarioSel = id;
  const u = cfg.usuarios.find(x => x.id === id);
  const sel = new Set(cfg.porUsuario[id] || []);
  $c('tituloPlanosUsuario').textContent = `Planos que ${u ? u.nome.split(' ')[0] : 'o usuário'} vê`;
  const planos = [...new Set([...todosPlanos(), ...sel])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $c('listaPlanosUsuario').innerHTML = planos.map(p => `<label class="check"><input type="checkbox" value="${escHTML(p)}" ${sel.has(p) ? 'checked' : ''}> ${escHTML(p)}</label>`).join('')
    || '<p class="acesso-ajuda">Nenhum plano no catálogo ainda: consulte a aba CMV no BI ou importe na aba Planos de contas.</p>';
  $c('btnSalvarPlanosUsuario').disabled = false;
  cfgListaUsuarios();
}
async function cfgSalvarPlanosUsuario() {
  const id = cfg.usuarioSel;
  if (!id) return;
  const marcados = [...document.querySelectorAll('#listaPlanosUsuario input:checked')].map(i => i.value);
  const valor = { ...cfg.porUsuario };
  if (marcados.length) valor[id] = marcados.sort(); else delete valor[id];
  try {
    const { error } = await supabaseBI.from('configuracoes_bi').upsert({ chave: 'cmv_planos_por_usuario', valor }, { onConflict: 'chave' });
    if (error) throw error;
    cfg.porUsuario = valor;
    cfgListaUsuarios();
    cfgMsg(marcados.length ? `✅ Salvo: ${marcados.length} plano(s) liberado(s). Vale em até 1 minuto.` : '✅ Salvo: este usuário vê todos os planos.', 'ok');
  } catch (e) {
    cfgMsg(/configuracoes_bi|relation|schema cache|does not exist/i.test(e.message || '') ? 'Rode no Supabase o arquivo database/13_configuracoes_bi.sql e tente de novo.' : `Não foi possível salvar: ${e.message}`, 'erro');
  }
}

// ------------------------------------------------------------------ 3. conexão SavWin
let svAlvo = null;
function cfgDesenharSavwin() {
  $c('corpoSavwin').innerHTML = cfg.usuarios.map(u => {
    const ok = !!(u.identificadorsav && u.loginsav && u.senhasav);
    return `<tr><td><strong>${escHTML(u.nome)}</strong><br><small>${escHTML(u.login)}</small></td>
      <td>${escHTML(u.identificadorsav || '—')}</td><td>${escHTML(u.loginsav || '—')}</td>
      <td><span class="situacao ${ok ? 'ativo' : 'inativo'}">${ok ? 'Configurada' : 'Sem acesso'}</span></td>
      <td class="acoes"><button type="button" onclick="cfgAbrirSavwin('${u.id}')">${ok ? 'Alterar' : 'Cadastrar'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="5">Nenhum usuário.</td></tr>';
}
function cfgAbrirSavwin(id) {
  const u = cfg.usuarios.find(x => x.id === id);
  if (!u) return;
  svAlvo = u;
  const ok = !!(u.loginsav && u.senhasav);
  $c('tituloSavwin').textContent = `Conexão SavWin · ${u.nome}`;
  $c('svIdent').value = u.identificadorsav || ''; $c('svLogin').value = u.loginsav || ''; $c('svSenha').value = '';
  $c('svSenha').placeholder = ok ? 'em branco = manter a senha cadastrada' : 'senha do SavWin';
  $c('svSenha').required = !ok;
  $c('svRemover').style.display = ok ? '' : 'none';
  $c('svMsg').textContent = '';
  $c('modalSavwin').style.display = 'flex';
}
async function cfgPostSavwin(corpo) {
  const resp = await fetchAutenticado('/savwin/conexao-usuario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
  return j;
}
async function cfgSalvarSavwin(ev) {
  if (ev) ev.preventDefault();
  const bt = $c('svSalvar'); bt.disabled = true; bt.textContent = 'Testando no SavWin…';
  try {
    const j = await cfgPostSavwin({ usuarioId: svAlvo.id, identificador: $c('svIdent').value, login: $c('svLogin').value, senha: $c('svSenha').value });
    Object.assign(svAlvo, { identificadorsav: j.identificador, loginsav: j.usuarioSavwin, senhasav: svAlvo.senhasav || 'x' });
    $c('modalSavwin').style.display = 'none';
    cfgDesenharSavwin();
    cfgMsg(`✅ Conexão SavWin de ${svAlvo.nome} testada e salva.`, 'ok');
  } catch (e) { $c('svMsg').className = 'acesso-msg erro'; $c('svMsg').textContent = e.message; }
  finally { $c('svSenha').value = ''; bt.disabled = false; bt.textContent = 'Testar e salvar'; }
  return false;
}
async function cfgRemoverSavwin() {
  if (!svAlvo || !confirm(`Remover o acesso SavWin de ${svAlvo.nome}?`)) return;
  try {
    await cfgPostSavwin({ usuarioId: svAlvo.id, remover: true });
    Object.assign(svAlvo, { identificadorsav: null, loginsav: null, senhasav: null });
    $c('modalSavwin').style.display = 'none';
    cfgDesenharSavwin();
    cfgMsg(`Acesso SavWin de ${svAlvo.nome} removido.`, 'ok');
  } catch (e) { $c('svMsg').className = 'acesso-msg erro'; $c('svMsg').textContent = e.message; }
}

// ------------------------------------------------------------------ 4. parâmetros da IA
const RELATORIOS_IA = [
  ['precos', '🤖 Preço na web', 'Modal de preço de cada produto (lupa 🤖).', true],
  ['encalhados', '📦 Análise de encalhados', 'Botão "Analisar com IA" do Estoque encalhado (em lote).', true],
  ['compras', '🛒 Compras (CMV)', 'CMV › Compras com IA: comprar ou não, quanto e de quais grifes.', false]
];
function cfgDesenharIa() {
  const ia = cfg.ia || {}, rel = ia.relatorios || {};
  $c('iaContexto').value = ia.contexto || '';
  $c('iaModelo').value = ia.modelo || '';
  $c('iaLimite').value = ia.limiteMes || '';
  $c('iaRelatorios').innerHTML = RELATORIOS_IA.map(([k, t, d, temRegiao]) => {
    const r = rel[k] || {};
    return `<div class="tabela-card cfgbi-bloco">
      <div class="cfgbi-ferr"><h3>${t}</h3><label class="check"><input type="checkbox" id="iaAtivo_${k}" ${r.ativo === false ? '' : 'checked'}> ligado</label></div>
      <small class="acesso-ajuda" style="margin:0">${d}</small>
      ${temRegiao ? `<label>Região padrão <input type="text" id="iaRegiao_${k}" maxlength="80" value="${escHTML(r.regiao || '')}" placeholder="ex.: Maceió - AL (vazio = Brasil)"></label>` : ''}
      <label>Instruções extras <textarea id="iaInstr_${k}" rows="3" maxlength="1000" placeholder="${k === 'compras' ? 'ex.: priorizar grifes de giro rápido; não sugerir compra acima de R$ 50 mil/mês' : 'ex.: comparar só com óticas e marketplaces oficiais; ignorar usados'}">${escHTML(r.instrucoes || '')}</textarea></label>
    </div>`;
  }).join('');
  const bloqueados = new Set(ia.usuariosBloqueados || []);
  $c('iaUsuarios').innerHTML = cfg.usuarios.map(u => `<label class="check"><input type="checkbox" value="${u.id}" ${bloqueados.has(u.id) ? '' : 'checked'}> ${escHTML(u.nome)} <small>(${escHTML(u.login)})</small></label>`).join('')
    || '<p class="acesso-ajuda">Nenhum usuário.</p>';
  $c('iaUsoInfo').textContent = 'O contador do mês fica no servidor; ao atingir o limite, as análises param até o mês seguinte.';
}
function cfgIaMarcarUsuarios(m) { document.querySelectorAll('#iaUsuarios input').forEach(i => { i.checked = m; }); }
async function cfgSalvarIa() {
  const relatorios = {};
  RELATORIOS_IA.forEach(([k, , , temRegiao]) => {
    relatorios[k] = { ativo: $c('iaAtivo_' + k).checked, instrucoes: $c('iaInstr_' + k).value.trim() };
    if (temRegiao) relatorios[k].regiao = $c('iaRegiao_' + k).value.trim();
  });
  const valor = {
    contexto: $c('iaContexto').value.trim(),
    modelo: $c('iaModelo').value.trim(),
    limiteMes: Math.max(0, Number($c('iaLimite').value) || 0),
    usuariosBloqueados: ehAdmin() ? [...document.querySelectorAll('#iaUsuarios input')].filter(i => !i.checked).map(i => i.value) : ((cfg.ia || {}).usuariosBloqueados || []),
    relatorios
  };
  const bt = $c('btnSalvarIa'); bt.disabled = true;
  try {
    const { error } = await supabaseBI.from('configuracoes_bi').upsert({ chave: 'ia', valor }, { onConflict: 'chave' });
    if (error) throw error;
    cfg.ia = valor;
    cfgMsg('✅ Parâmetros da IA salvos. Valem em até 1 minuto.', 'ok');
  } catch (e) {
    cfgMsg(/configuracoes_bi|relation|schema cache|does not exist/i.test(e.message || '') ? 'Rode no Supabase o arquivo database/13_configuracoes_bi.sql e tente de novo.' : `Não foi possível salvar: ${e.message}`, 'erro');
  } finally { bt.disabled = false; }
}

// ------------------------------------------------------------------ início
(async () => {
  await exigirLogin();
  montarBarraUsuario(document.getElementById('barraUsuario'));
  if (typeof montarSubmenuConfig === 'function') montarSubmenuConfig(document.getElementById('submenuConfig'), 'bi');
  if (!podeConfigBI()) { location.replace('/inicio.html?semAcesso=gerenciar_usuarios'); return; }
  if (!ehAdmin()) {   // quem só aprova compras: só a aba de planos
    // quem tem só "Configuração do BI": planos de contas e parâmetros da IA (sem a lista de usuários)
    document.querySelectorAll('#cfgbiAbas button[data-a="usuarios"], #cfgbiAbas button[data-a="savwin"]').forEach(b => { b.style.display = 'none'; });
    const blocoUsuariosIa = $c('iaUsuarios') && $c('iaUsuarios').closest('.cfgbi-bloco');
    if (blocoUsuariosIa) blocoUsuariosIa.style.display = 'none';
  }
  await cfgCarregar();
  cfgDesenharListas();
  if (ehAdmin()) { cfgListaUsuarios(); cfgDesenharSavwin(); }
  cfgDesenharIa();
  $c('modalSavwin').addEventListener('click', e => { if (e.target.id === 'modalSavwin') e.target.style.display = 'none'; });
})();
