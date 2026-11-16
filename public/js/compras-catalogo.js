/**
 * Catálogo de compras (tabela produtos_compra).
 * Gestor (aprovar_compras): inclui, altera, ativa/inativa e importa CSV.
 * Gerente (solicitar_compras): só consulta.
 */

let catalogo = [];
let produtoEmEdicao = null;   // id
let linhasImportacao = [];    // [{codigo, nome, categoria, unidade, novo}]

const ehGestor = () => temPermissao('aprovar_compras');

async function carregarCatalogo() {
  const { data, error } = await supabaseBI.from('produtos_compra').select('*').order('nome');
  if (error) {
    $('corpoCatalogo').innerHTML = '';
    return mensagem('msgCatalogo', 'Erro ao carregar o catálogo: ' + erroBanco(error), 'erro');
  }
  catalogo = data || [];
  const cats = [...new Set(catalogo.map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const atual = $('filtroCategoria').value;
  $('filtroCategoria').innerHTML = '<option value="">Todas as categorias</option>' + cats.map(c => `<option>${escHTML(c)}</option>`).join('');
  $('filtroCategoria').value = cats.includes(atual) ? atual : '';
  $('listaCategorias').innerHTML = cats.map(c => `<option value="${escHTML(c)}"></option>`).join('');
  renderizarCatalogo();
}

function renderizarCatalogo() {
  const busca = $('buscaCatalogo').value.trim().toUpperCase();
  const cat = $('filtroCategoria').value;
  const inativos = $('mostrarInativosCat').checked;
  const lista = catalogo.filter(p =>
    (inativos || p.ativo) && (!cat || p.categoria === cat) &&
    (!busca || p.codigo.toUpperCase().includes(busca) || p.nome.toUpperCase().includes(busca)));
  const gestor = ehGestor();
  if (!lista.length) {
    $('corpoCatalogo').innerHTML = `<tr><td colspan="6" style="color:#6b7280">${catalogo.length ? 'Nenhum produto com esse filtro.' : 'Catálogo vazio.' + (gestor ? ' Use "+ Novo produto" ou "Importar CSV".' : ' O gestor ainda não cadastrou produtos.')}</td></tr>`;
    return;
  }
  $('corpoCatalogo').innerHTML = lista.map(p => `
    <tr class="${p.ativo ? '' : 'inativo'}">
      <td><strong>${escHTML(p.codigo)}</strong></td>
      <td>${escHTML(p.nome)}</td>
      <td>${escHTML(p.categoria || '—')}</td>
      <td>${escHTML(p.unidade)}</td>
      <td><span class="situacao ${p.ativo ? 'ativo' : 'inativo'}">${p.ativo ? 'Ativo' : 'Inativo'}</span></td>
      ${gestor ? `<td class="acoes"><button type="button" onclick="abrirFormProduto(${p.id})">Editar</button>
        <button type="button" onclick="alternarAtivoProduto(${p.id})">${p.ativo ? 'Inativar' : 'Ativar'}</button></td>` : ''}
    </tr>`).join('') +
    `<tr><td colspan="6" style="color:#6b7280; font-size:12px;">${lista.length} produto(s)</td></tr>`;
}

// ---------------------------------------------------------- incluir / alterar
function abrirFormProduto(id = null) {
  produtoEmEdicao = id;
  const p = id ? catalogo.find(x => x.id === id) : null;
  $('tituloFormProduto').textContent = p ? `Alterar ${p.codigo}` : 'Novo produto';
  $('prodCodigo').value = p ? p.codigo : '';
  $('prodNome').value = p ? p.nome : '';
  $('prodCategoria').value = p ? (p.categoria || '') : ($('filtroCategoria').value || '');
  $('prodUnidade').value = p ? p.unidade : 'unidade';
  $('prodAtivo').checked = p ? p.ativo : true;
  mensagem('msgFormProduto', '');
  $('modalProduto').style.display = 'flex';
  (p ? $('prodNome') : $('prodCodigo')).focus();
}

async function salvarProduto(e) {
  e.preventDefault();
  const registro = {
    codigo: $('prodCodigo').value.trim().toUpperCase(),
    nome: $('prodNome').value.trim().replace(/\s+/g, ' ').toUpperCase(),
    categoria: $('prodCategoria').value.trim() || null,
    unidade: $('prodUnidade').value.trim() || 'unidade',
    ativo: $('prodAtivo').checked
  };
  if (!registro.codigo) return mensagem('msgFormProduto', 'Informe o código.', 'erro');
  if (!registro.nome) return mensagem('msgFormProduto', 'Informe o nome.', 'erro');
  $('btnSalvarProduto').disabled = true;
  const { error } = produtoEmEdicao
    ? await supabaseBI.from('produtos_compra').update(registro).eq('id', produtoEmEdicao)
    : await supabaseBI.from('produtos_compra').insert(registro);
  $('btnSalvarProduto').disabled = false;
  if (error) {
    const dup = /duplicate|unique/i.test(error.message || '');
    return mensagem('msgFormProduto', dup ? `O código ${registro.codigo} já existe.` : 'Erro ao salvar: ' + erroBanco(error), 'erro');
  }
  $('modalProduto').style.display = 'none';
  mensagem('msgCatalogo', produtoEmEdicao ? 'Produto alterado.' : 'Produto incluído.', 'ok');
  await carregarCatalogo();
}

async function alternarAtivoProduto(id) {
  const p = catalogo.find(x => x.id === id);
  if (!p) return;
  const { error } = await supabaseBI.from('produtos_compra').update({ ativo: !p.ativo }).eq('id', id);
  if (error) return mensagem('msgCatalogo', 'Erro: ' + erroBanco(error), 'erro');
  await carregarCatalogo();
}

// ---------------------------------------------------------- importar CSV
function abrirImportarCatalogo() {
  linhasImportacao = [];
  $('arquivoCatalogo').value = '';
  $('previaImportacao').innerHTML = '';
  $('btnConfirmarImportarCat').disabled = true;
  mensagem('msgImportarCat', '');
  $('modalImportarCat').style.display = 'flex';
}

function baixarModeloCatalogo() {
  const txt = 'codigo;nome;categoria;unidade\r\nEMB-001;SACOLA PAPEL MÉDIA;Embalagens;pacote c/ 50\r\nEST-010;ESTOJO RÍGIDO ÓCULOS GRAU;Estojos;unidade\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }));
  a.download = 'modelo_catalogo_compras.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

/** Separa uma linha de CSV respeitando aspas. */
function colunasCSV(linha, sep) {
  const out = []; let atual = ''; let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
    else if (c === sep && !aspas) { out.push(atual); atual = ''; }
    else atual += c;
  }
  out.push(atual);
  return out.map(s => s.trim());
}

function lerArquivoCatalogo(arquivo) {
  if (!arquivo) return;
  const leitor = new FileReader();
  leitor.onload = () => {
    let texto = String(leitor.result || '').replace(/^﻿/, '');
    // arquivo do Excel em ANSI: troca caracteres quebrados lendo de novo como latin1
    if (texto.includes('�')) {
      const l2 = new FileReader();
      l2.onload = () => processarCSVCatalogo(String(l2.result || ''));
      l2.readAsText(arquivo, 'windows-1252');
      return;
    }
    processarCSVCatalogo(texto);
  };
  leitor.readAsText(arquivo, 'utf-8');
}

function processarCSVCatalogo(texto) {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return mensagem('msgImportarCat', 'Arquivo vazio.', 'erro');
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
  let cab = colunasCSV(linhas[0], sep).map(c => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  let idx = { codigo: 0, nome: 1, categoria: 2, unidade: 3 };
  let inicio = 0;
  if (cab.some(c => /codigo|nome|descricao/.test(c))) {
    const achar = re => cab.findIndex(c => re.test(c));
    idx = { codigo: achar(/codigo|^cod/), nome: achar(/nome|descricao|produto/), categoria: achar(/categoria|grupo/), unidade: achar(/unidade|^un/) };
    inicio = 1;
  }
  if (idx.codigo < 0 || idx.nome < 0) return mensagem('msgImportarCat', 'Não achei as colunas código e nome no cabeçalho.', 'erro');

  const existentes = new Map(catalogo.map(p => [p.codigo.toUpperCase(), p]));
  const vistos = new Map();
  const erros = [];
  linhas.slice(inicio).forEach((l, n) => {
    const c = colunasCSV(l, sep);
    const codigo = String(c[idx.codigo] || '').trim().toUpperCase();
    const nome = String(c[idx.nome] || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!codigo || !nome) { erros.push(n + inicio + 1); return; }
    vistos.set(codigo, {
      codigo, nome,
      categoria: idx.categoria >= 0 ? (String(c[idx.categoria] || '').trim() || null) : null,
      unidade: idx.unidade >= 0 ? (String(c[idx.unidade] || '').trim() || 'unidade') : 'unidade',
      novo: !existentes.has(codigo)
    });
  });
  linhasImportacao = [...vistos.values()];
  const novos = linhasImportacao.filter(l => l.novo).length;
  $('previaImportacao').innerHTML = linhasImportacao.length ? `
    <p><b>${linhasImportacao.length}</b> produto(s) no arquivo: <b class="cp-novo">${novos} novo(s)</b> · <b>${linhasImportacao.length - novos}</b> já cadastrado(s) (serão atualizados).
      ${erros.length ? `<br><span style="color:#b07a00">Linhas ignoradas (sem código ou nome): ${erros.slice(0, 10).join(', ')}${erros.length > 10 ? '…' : ''}</span>` : ''}</p>
    <div class="tabela-card" style="max-height: 260px; overflow-y: auto;">
      <table class="tabela-usuarios"><thead><tr><th></th><th>Código</th><th>Nome</th><th>Categoria</th><th>Unidade</th></tr></thead>
      <tbody>${linhasImportacao.slice(0, 200).map(l => `<tr><td>${l.novo ? '<span class="chip">novo</span>' : '<span class="chip">atualiza</span>'}</td><td><b>${escHTML(l.codigo)}</b></td><td>${escHTML(l.nome)}</td><td>${escHTML(l.categoria || '—')}</td><td>${escHTML(l.unidade)}</td></tr>`).join('')}</tbody></table>
    </div>` : '';
  $('btnConfirmarImportarCat').disabled = !linhasImportacao.length;
  mensagem('msgImportarCat', linhasImportacao.length ? '' : 'Nenhuma linha válida no arquivo.', linhasImportacao.length ? '' : 'erro');
}

async function confirmarImportacaoCatalogo() {
  if (!linhasImportacao.length) return;
  $('btnConfirmarImportarCat').disabled = true;
  mensagem('msgImportarCat', 'Importando...');
  // novos: insert; existentes: update (mantém o ativo como está)
  const existentes = new Map(catalogo.map(p => [p.codigo.toUpperCase(), p]));
  const novos = linhasImportacao.filter(l => l.novo).map(({ novo, ...r }) => ({ ...r, ativo: true }));
  try {
    for (let i = 0; i < novos.length; i += 500) {
      const { error } = await supabaseBI.from('produtos_compra').insert(novos.slice(i, i + 500));
      if (error) throw error;
    }
    for (const l of linhasImportacao.filter(x => !x.novo)) {
      const atual = existentes.get(l.codigo);
      if (atual.nome === l.nome && (atual.categoria || null) === l.categoria && atual.unidade === l.unidade) continue;
      const { error } = await supabaseBI.from('produtos_compra').update({ nome: l.nome, categoria: l.categoria, unidade: l.unidade }).eq('id', atual.id);
      if (error) throw error;
    }
  } catch (err) {
    $('btnConfirmarImportarCat').disabled = false;
    return mensagem('msgImportarCat', 'Erro ao importar: ' + erroBanco(err), 'erro');
  }
  $('modalImportarCat').style.display = 'none';
  mensagem('msgCatalogo', `Importação concluída: ${novos.length} novo(s), ${linhasImportacao.length - novos.length} conferido(s)/atualizado(s).`, 'ok');
  await carregarCatalogo();
}

// ---------------------------------------------------------- início
(async () => {
  await iniciarPaginaCompras('catalogo', podeCompras);
  document.querySelectorAll('.so-gestor').forEach(el => { el.style.display = ehGestor() ? '' : 'none'; });
  $('formProduto').addEventListener('submit', salvarProduto);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('modalProduto').style.display = 'none'; $('modalImportarCat').style.display = 'none'; } });
  await carregarCatalogo();
})();
