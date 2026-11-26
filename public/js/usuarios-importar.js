/**
 * Configurações > Usuários > Importar Excel.
 * Lê o modelo (public/modelos/modelo-usuarios.xlsx), mostra a prévia linha a linha
 * e cria os usuários pelo mesmo caminho do "+ Novo usuário" (/api/usuarios).
 * Senha não vem da planilha: cada usuário novo recebe uma senha provisória gerada
 * aqui, e no fim dá para baixar um Excel com login e senha para entregar.
 * Depende de usuarios.js (usuarios, lojasCadastro, PERMS, salvarLojasUsuario...).
 */

const IMP_PERMS = {               // cabeçalho normalizado -> permissão
  'acessar bi': 'acessar_bi', 'incluir metas': 'criar_metas', 'criar metas': 'criar_metas',
  'alterar metas': 'alterar_metas', 'excluir metas': 'excluir_metas',
  'solicitar compras': 'solicitar_compras', 'aprovar compras': 'aprovar_compras',
  'configuracao do bi': 'configurar_bi', 'config bi': 'configurar_bi', 'conexao savwin': 'conexao_savwin', 'administrador': 'gerenciar_usuarios'
};
const IMP_ABAS = {                // nome digitado (normalizado) -> aba
  dashboard: 'dashboard', 'dashboard executivo': 'dashboard', metas: 'metas',
  'visao geral': 'cards', 'visao geral & pagamentos': 'cards', pagamentos: 'cards', cards: 'cards',
  produtos: 'produtos', 'avaliacao de produtos': 'produtos', comparativo: 'comparativo',
  comissao: 'comissao', cmv: 'cmv', detalhes: 'detalhes', 'detalhes de vendas': 'detalhes', 'detalhes de vendas (periodo)': 'detalhes'
};
const imp = { linhas: [], resultado: [], rodando: false };

const impNorm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** S/N da planilha: true, false ou null (em branco). Texto estranho = undefined. */
function impSimNao(v) {
  const t = impNorm(v);
  if (!t) return null;
  if (['s', 'sim', 'x', '1', 'true', 'verdadeiro', 'y', 'yes'].includes(t)) return true;
  if (['n', 'nao', '0', 'false', 'falso', 'no', '-'].includes(t)) return false;
  return undefined;
}

let impSheetJS = null;
function impCarregarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (impSheetJS) return impSheetJS;
  impSheetJS = new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => ok(window.XLSX);
    s.onerror = () => { impSheetJS = null; falha(new Error('Não foi possível carregar o leitor de Excel. Verifique a internet e tente de novo.')); };
    document.head.appendChild(s);
  });
  return impSheetJS;
}

function abrirImportarUsuarios() {
  imp.linhas = []; imp.resultado = [];
  $('impArquivo').value = '';
  $('impAtualizar').checked = false;
  $('impPrevia').innerHTML = '';
  $('btnImpExecutar').disabled = true;
  $('btnImpExecutar').style.display = '';
  $('btnImpResultado').style.display = 'none';
  mensagem('msgImportar', '');
  $('modalImportar').style.display = 'flex';
}

async function impLerArquivo(input) {
  const arq = input.files && input.files[0];
  if (!arq) return;
  mensagem('msgImportar', 'Lendo planilha...');
  try {
    const XLSX = await impCarregarSheetJS();
    const wb = XLSX.read(await arq.arrayBuffer(), { type: 'array' });
    const nomeAba = wb.SheetNames.find(n => impNorm(n) === 'usuarios') || wb.SheetNames[0];
    const matriz = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: false, defval: '' });
    imp.linhas = impInterpretar(matriz);
    impAvaliar();
    mensagem('msgImportar', '');
  } catch (e) {
    imp.linhas = [];
    impAvaliar();
    mensagem('msgImportar', e.message, 'erro');
  }
}

/** Matriz da planilha -> linhas { n, nome, login, email, ativo, lojas, abas, perms }. */
function impInterpretar(matriz) {
  const iCab = matriz.findIndex(l => l.some(c => impNorm(c) === 'nome'));
  if (iCab < 0) throw new Error('Não achei a coluna "Nome". Use o modelo (botão "Baixar modelo").');
  const cab = matriz[iCab].map(impNorm);
  const col = nome => cab.indexOf(nome);
  const ci = {
    nome: col('nome'), login: col('login'), email: cab.findIndex(c => c === 'e-mail' || c === 'email'),
    ativo: col('ativo'), lojas: col('lojas'), abas: col('abas')
  };
  const cPerms = {};
  cab.forEach((c, i) => { if (IMP_PERMS[c]) cPerms[IMP_PERMS[c]] = i; });
  const pega = (l, i) => (i >= 0 ? String(l[i] ?? '').trim() : '');

  return matriz.slice(iCab + 1).map((l, k) => {
    const brutoPerms = {};
    Object.entries(cPerms).forEach(([p, i]) => { brutoPerms[p] = pega(l, i); });
    return {
      n: iCab + k + 2, nome: pega(l, ci.nome), loginDigitado: pega(l, ci.login).toLowerCase(),
      email: pega(l, ci.email), ativoTxt: pega(l, ci.ativo), lojasTxt: pega(l, ci.lojas), abasTxt: pega(l, ci.abas), brutoPerms
    };
  }).filter(r => r.nome || r.loginDigitado || r.email)
    .filter(r => !/apague esta linha/i.test(r.nome));
}

/** Valida cada linha e decide: criar, atualizar, ignorar ou erro. */
function impAvaliar() {
  const atualizar = $('impAtualizar').checked;
  const porLogin = new Map(usuarios.map(u => [u.login, u]));
  const codigosLojas = new Set(lojasCadastro.map(l => Number(l.codigo)));
  const vistos = new Map();

  imp.linhas.forEach(r => {
    const erros = [];
    r.login = r.loginDigitado || sugerirLogin(r.nome);
    if (!r.nome) erros.push('sem nome');
    if (!/^[a-z0-9._-]{3,30}$/.test(r.login)) erros.push(`login "${r.login || '(vazio)'}" inválido`);
    if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) erros.push('e-mail inválido');

    const ativo = impSimNao(r.ativoTxt);
    if (ativo === undefined) erros.push(`Ativo "${r.ativoTxt}" (use S ou N)`);
    r.ativo = ativo !== false;

    r.perms = {};
    PERMS.forEach(p => {
      const v = impSimNao(r.brutoPerms[p]);
      if (v === undefined) erros.push(`"${r.brutoPerms[p]}" em ${CHIPS[p]} (use S ou N)`);
      r.perms['pode_' + p] = v === null || v === undefined ? p === 'acessar_bi' : v;
    });

    // lojas
    r.todasLojas = false; r.lojas = [];
    const tl = impNorm(r.lojasTxt);
    if (tl === 'todas' || tl === 'todas as lojas') r.todasLojas = true;
    else if (tl) {
      const cods = tl.split(/[;,\s/|]+/).filter(Boolean);
      cods.forEach(c => {
        const num = parseInt(c.replace(/\D/g, ''), 10);
        if (!num) erros.push(`loja "${c}" inválida`);
        else if (codigosLojas.size && !codigosLojas.has(num)) erros.push(`loja ${num} não cadastrada`);
        else if (!r.lojas.includes(num)) r.lojas.push(num);
      });
    }
    if (r.perms.pode_acessar_bi && !r.todasLojas && !r.lojas.length) erros.push('informe as lojas (ou TODAS)');

    // abas: em branco/TODAS = todas; senão, as listadas são as liberadas
    r.abasBloqueadas = [];
    const ta = impNorm(r.abasTxt);
    if (ta && ta !== 'todas') {
      const liberadas = new Set();
      ta.split(/[;,|\n]+/).map(s => s.trim()).filter(Boolean).forEach(nome => {
        const k = IMP_ABAS[nome] || (ABAS_BI.find(([key]) => key === nome) || [])[0];
        if (k) liberadas.add(k); else erros.push(`aba "${nome}" desconhecida`);
      });
      r.abasBloqueadas = ABAS_BI.map(([k]) => k).filter(k => !liberadas.has(k));
      if (r.perms.pode_acessar_bi && liberadas.size === 0) erros.push('nenhuma aba liberada');
    }

    // duplicado na própria planilha
    if (r.login && vistos.has(r.login)) erros.push(`login repetido (linha ${vistos.get(r.login)})`);
    else vistos.set(r.login, r.n);

    const existente = porLogin.get(r.login);
    r.existente = existente || null;
    if (erros.length) { r.acao = 'erro'; r.motivo = erros.join('; '); }
    else if (existente && !r.loginDigitado) { r.acao = 'erro'; r.motivo = `login sugerido "${r.login}" já existe (${existente.nome}): informe outro login`; }
    else if (existente && !atualizar) { r.acao = 'ignorar'; r.motivo = 'já existe (marque "Atualizar usuários que já existem")'; }
    else if (existente) { r.acao = 'atualizar'; r.motivo = perfilAtual && existente.id === perfilAtual.id ? 'é você: mantém administrador e ativo' : ''; }
    else { r.acao = 'criar'; r.motivo = ''; }
  });
  impRenderizarPrevia();
}

function impRenderizarPrevia() {
  const L = imp.linhas;
  const cont = a => L.filter(r => r.acao === a).length;
  const nCriar = cont('criar'), nAtu = cont('atualizar'), nIgn = cont('ignorar'), nErr = cont('erro');
  $('btnImpExecutar').disabled = !(nCriar + nAtu) || imp.rodando;
  $('btnImpExecutar').textContent = `Importar (${nCriar} novo${nCriar === 1 ? '' : 's'}${nAtu ? `, ${nAtu} atualização${nAtu === 1 ? '' : 'ões'}` : ''})`;
  if (!L.length) { $('impPrevia').innerHTML = ''; return; }

  const rotulo = { criar: '🆕 Criar', atualizar: '✏️ Atualizar', ignorar: '⏭️ Ignorar', erro: '⚠️ Erro', ok: '✅ Feito', falhou: '❌ Falhou' };
  const lojasTxt = r => r.todasLojas ? 'Todas' : r.lojas.join(', ');
  const abasTxt = r => r.abasBloqueadas && r.abasBloqueadas.length ? `${ABAS_BI.length - r.abasBloqueadas.length} de ${ABAS_BI.length}` : 'Todas';
  const acessos = r => PERMS.filter(p => r.perms && r.perms['pode_' + p]).map(p => `<span class="chip ${p === 'gerenciar_usuarios' ? 'admin' : ''}">${CHIPS[p]}</span>`).join('') || '—';
  $('impPrevia').innerHTML = `
    <p class="acesso-ajuda">${L.length} linha(s): <b>${nCriar}</b> para criar · <b>${nAtu}</b> para atualizar · ${nIgn} ignorada(s) · <span style="color:${nErr ? '#d9534f' : 'inherit'}">${nErr} com erro</span>${nErr ? ' (linhas com erro não são importadas; corrija na planilha e carregue de novo)' : ''}</p>
    <div class="tabela-card imp-previa"><table class="tabela-usuarios">
      <thead><tr><th>Linha</th><th>Situação</th><th>Nome</th><th>Login</th><th>Acessos</th><th>Lojas</th><th>Abas</th><th>Obs.</th></tr></thead>
      <tbody>${L.map(r => `<tr class="imp-${r.acao}">
        <td>${r.n}</td><td>${rotulo[r.acao] || r.acao}</td><td>${escHTML(r.nome)}${r.ativo ? '' : ' <small>(inativo)</small>'}</td>
        <td>${escHTML(r.login)}</td><td>${acessos(r)}</td><td>${escHTML(lojasTxt(r))}</td><td>${abasTxt(r)}</td>
        <td class="imp-obs">${escHTML(r.motivo || '')}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

async function impExecutar() {
  const fila = imp.linhas.filter(r => r.acao === 'criar' || r.acao === 'atualizar');
  if (!fila.length || imp.rodando) return;
  if (!confirm(`Importar ${fila.length} usuário(s)?`)) return;
  imp.rodando = true; imp.resultado = [];
  $('btnImpExecutar').disabled = true;
  const temAbas = temColunaAbas();
  let feitos = 0;
  for (const r of fila) {
    mensagem('msgImportar', `Importando ${++feitos} de ${fila.length}: ${r.nome}...`);
    try {
      if (r.acao === 'criar') {
        const senha = gerarSenhaProvisoria();
        const resp = await fetchAutenticado('/api/usuarios', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: r.nome, login: r.login, senha, email_contato: r.email, ativo: r.ativo, trocar_senha: true,
            todas_lojas: r.todasLojas, ...(temAbas ? { abas_bloqueadas: r.abasBloqueadas } : {}), ...r.perms })
        });
        const corpo = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(corpo.error || `Erro ${resp.status}`);
        if (corpo && corpo.id) await salvarLojasUsuario(corpo.id, r.todasLojas, r.lojas);
        r.senha = senha;
      } else {
        const alteracao = { nome: r.nome, ...r.perms, ativo: r.ativo, todas_lojas: r.todasLojas,
          ...(r.email ? { email_contato: r.email } : {}), ...(temAbas ? { abas_bloqueadas: r.abasBloqueadas } : {}) };
        if (perfilAtual && r.existente.id === perfilAtual.id) { alteracao.pode_gerenciar_usuarios = true; alteracao.ativo = true; }
        const { data, error } = await supabaseBI.from('usuarios').update(alteracao).eq('id', r.existente.id).select();
        if (error) throw error;
        if (!data || !data.length) throw new Error('nada foi alterado (sem permissão?)');
        await salvarLojasUsuario(r.existente.id, r.todasLojas, r.lojas);
      }
      imp.resultado.push({ r, ok: true });
      r.motivoOriginal = r.acao; r.acao = 'ok'; r.motivo = r.motivoOriginal === 'criar' ? 'criado' : 'atualizado';
    } catch (e) {
      imp.resultado.push({ r, ok: false, erro: e.message });
      r.acao = 'falhou'; r.motivo = e.message;
    }
    impRenderizarPrevia();
  }
  imp.rodando = false;
  const ok = imp.resultado.filter(x => x.ok).length, erro = imp.resultado.length - ok;
  const novos = imp.resultado.filter(x => x.ok && x.r.senha).length;
  mensagem('msgImportar', `Pronto: ${ok} importado(s)${erro ? `, ${erro} com falha (veja a coluna Obs.)` : ''}.` +
    (novos ? ' Baixe o Excel com as senhas provisórias para entregar a cada usuário.' : ''), erro ? 'erro' : 'ok');
  $('btnImpExecutar').style.display = 'none';
  $('btnImpResultado').style.display = novos ? '' : 'none';
  await carregarUsuarios();
}

/** Excel com login e senha provisória dos criados (para entregar aos usuários). */
async function impBaixarResultado() {
  const XLSX = await impCarregarSheetJS();
  const linhas = imp.resultado.filter(x => x.ok && x.r.senha).map(x => ({
    Nome: x.r.nome, Login: x.r.login, 'Senha provisória': x.r.senha, Endereço: location.origin + '/login.html'
  }));
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 18 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Acessos');
  const d = new Date();
  XLSX.writeFile(wb, `acessos-bi-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.xlsx`);
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && !imp.rodando) fecharModal('modalImportar'); });
