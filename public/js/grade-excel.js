/**
 * Grade padrão tipo Excel (mesmo jeito da aba Detalhes): todas as colunas que a API devolve,
 * filtro por coluna (classificar, pesquisar, marcar valores), totais das colunas numéricas,
 * contador, "Limpar filtros" e exportação Excel/CSV.
 *
 *   const g = new GradeExcel('idDoContainer', { nomeArquivo: 'contas_pagar' });
 *   g.definir(linhas);          // linhas = array de objetos da API
 */
class GradeExcel {
  constructor(idContainer, opcoes = {}) {
    this.id = idContainer;
    this.op = { nomeArquivo: 'grade', porPagina: 300, ...opcoes };
    this.linhas = []; this.colunas = []; this.filtros = {}; this.ordem = null; this.mostrar = this.op.porPagina;
    this.popup = null;
    GradeExcel.todas[idContainer] = this;
  }

  // ------------------------------------------------------------ dados
  static numeroBR(v) {
    if (typeof v === 'number') return v;
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
    return isFinite(n) ? n : null;
  }
  static dataBR(v) {
    const m = String(v ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})/) || String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return m[1].length === 4 ? new Date(+m[1], m[2] - 1, +m[3]) : new Date(+m[3], m[2] - 1, +m[1]);
  }
  /** Descobre as colunas e o tipo de cada uma (número, data ou texto) pelos valores. */
  definir(linhas) {
    this.linhas = Array.isArray(linhas) ? linhas : [];
    const chaves = [];
    this.linhas.slice(0, 500).forEach(l => Object.keys(l || {}).forEach(k => { if (!chaves.includes(k)) chaves.push(k); }));
    this.colunas = chaves.map(k => {
      const vals = this.linhas.map(l => l[k]).filter(v => v !== null && v !== undefined && String(v).trim() !== '' && typeof v !== 'object');
      let tipo = 'texto';
      if (vals.length && vals.every(v => /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+([.,]\d+)?$/.test(String(v).trim()))) {
        // código (só dígitos, sem decimais, nome de id/código) fica como texto
        const pareceId = /(^ID|ID$|SEQ|CODIGO|NUMERO|CNPJ|CPF|^FIL|DOC|NF)/i.test(k) && vals.every(v => /^\d+$/.test(String(v).trim()));
        tipo = pareceId ? 'texto' : 'num';
      } else if (vals.length && vals.every(v => GradeExcel.dataBR(v))) tipo = 'data';
      return { chave: k, titulo: k, tipo };
    });
    Object.keys(this.filtros).forEach(k => { if (!chaves.includes(k)) delete this.filtros[k]; });
    this.mostrar = this.op.porPagina;
    this.renderizar();
  }
  texto(col, l) {
    const v = l[col.chave];
    if (v === null || v === undefined || typeof v === 'object') return '';
    if (col.tipo === 'num') { const n = GradeExcel.numeroBR(v); return n === null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    if (col.tipo === 'data') { const d = GradeExcel.dataBR(v); return d ? d.toLocaleDateString('pt-BR') : String(v); }
    return String(v).trim();
  }
  chaveOrdem(col, l) {
    if (col.tipo === 'num') return GradeExcel.numeroBR(l[col.chave]) ?? -Infinity;
    if (col.tipo === 'data') { const d = GradeExcel.dataBR(l[col.chave]); return d ? d.getTime() : -Infinity; }
    return this.texto(col, l).toUpperCase();
  }
  filtradas(ignorar = null) {
    return this.linhas.filter(l => this.colunas.every(c => c.chave === ignorar || !this.filtros[c.chave] || !this.filtros[c.chave].has(this.texto(c, l))));
  }
  visiveis() {
    const lista = this.filtradas();
    if (this.ordem) {
      const c = this.colunas.find(x => x.chave === this.ordem.chave);
      if (c) lista.sort((a, b) => { const x = this.chaveOrdem(c, a), y = this.chaveOrdem(c, b); return (x < y ? -1 : x > y ? 1 : 0) * this.ordem.dir; });
    }
    return lista;
  }

  // ------------------------------------------------------------ tela
  renderizar() {
    const el = document.getElementById(this.id);
    if (!el) return;
    if (!this.linhas.length) { el.innerHTML = `<p class="gx-vazio">${this.op.vazio || 'Nenhum registro.'}</p>`; return; }
    const vis = this.visiveis();
    const nFiltros = Object.values(this.filtros).filter(s => s && s.size).length;
    const mostrar = vis.slice(0, this.mostrar);
    const me = `GradeExcel.todas['${this.id}']`;
    const totais = {};
    this.colunas.filter(c => c.tipo === 'num').forEach(c => { totais[c.chave] = vis.reduce((t, l) => t + (GradeExcel.numeroBR(l[c.chave]) || 0), 0); });
    const cab = this.colunas.map(c => {
      const f = this.filtros[c.chave] && this.filtros[c.chave].size;
      const seta = this.ordem && this.ordem.chave === c.chave ? (this.ordem.dir > 0 ? ' ↑' : ' ↓') : '';
      return `<th class="th-filtro${f ? ' filtrada' : ''}${c.tipo === 'num' ? ' gx-num' : ''}"><span>${escHTML(c.titulo)}${seta}</span>
        <button type="button" class="btn-filtro-col" onclick="${me}.abrirFiltro(event, ${escHTML(JSON.stringify(c.chave))})" title="Filtrar / ordenar">${f ? '⏷' : '▾'}</button></th>`;
    }).join('');
    el.innerHTML = `
      <div class="gx-barra">
        <span class="gx-contador">Exibindo <b>${vis.length.toLocaleString('pt-BR')}</b> de ${this.linhas.length.toLocaleString('pt-BR')} registros${nFiltros ? ` · ${nFiltros} filtro(s)` : ''} · ${this.colunas.length} colunas</span>
        ${nFiltros || this.ordem ? `<button type="button" class="btn-secundario cfg-btn-pequeno" onclick="${me}.limparTudo()">✖ Limpar filtros</button>` : ''}
        <span class="ep-exportar">⬇ Exportar <button type="button" class="tv-link" onclick="${me}.exportar('xlsx')">Excel</button> · <button type="button" class="tv-link" onclick="${me}.exportar('csv')">CSV</button></span>
      </div>
      <div class="gx-rolagem">
        <table class="gx-tabela">
          <thead><tr>${cab}</tr></thead>
          <tbody>${mostrar.map(l => `<tr>${this.colunas.map(c => `<td class="${c.tipo === 'num' ? 'gx-num' : ''}">${escHTML(this.texto(c, l))}</td>`).join('')}</tr>`).join('')}</tbody>
          <tfoot><tr>${this.colunas.map((c, i) => `<td class="${c.tipo === 'num' ? 'gx-num' : ''}">${i === 0 ? `TOTAL · ${vis.length.toLocaleString('pt-BR')}` : c.tipo === 'num' ? totais[c.chave].toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>`).join('')}</tr></tfoot>
        </table>
      </div>
      ${vis.length > mostrar.length ? `<div class="gx-mais"><button type="button" class="btn-secundario cfg-btn-pequeno" onclick="${me}.mostrar += ${this.op.porPagina}; ${me}.renderizar()">Mostrar mais ${Math.min(this.op.porPagina, vis.length - mostrar.length)} (de ${(vis.length - mostrar.length).toLocaleString('pt-BR')} restantes)</button></div>` : ''}`;
  }

  // ------------------------------------------------------------ filtro (popup)
  abrirFiltro(event, chave) {
    event.stopPropagation();
    const col = this.colunas.find(c => c.chave === chave);
    if (!col) return;
    if (GradeExcel.aberta && GradeExcel.aberta.grade === this && GradeExcel.aberta.chave === chave) return GradeExcel.fechar();
    const contagem = new Map(), ord = new Map();
    this.filtradas(chave).forEach(l => { const t = this.texto(col, l); contagem.set(t, (contagem.get(t) || 0) + 1); ord.set(t, this.chaveOrdem(col, l)); });
    const desm = this.filtros[chave] || new Set();
    desm.forEach(t => { if (!contagem.has(t)) contagem.set(t, 0); });
    const valores = [...contagem.keys()].sort((a, b) => { const x = ord.has(a) ? ord.get(a) : a, y = ord.has(b) ? ord.get(b) : b; return x < y ? -1 : x > y ? 1 : 0; });
    GradeExcel.aberta = { grade: this, chave, col, valores, contagem, marcados: new Set(valores.filter(v => !desm.has(v))) };
    let p = document.getElementById('popupGradeExcel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'popupGradeExcel'; p.className = 'popup-filtro';
      p.addEventListener('click', e => e.stopPropagation());
      document.body.appendChild(p);
    }
    const n = col.tipo !== 'texto';
    p.innerHTML = `
      <div class="pf-titulo">${escHTML(col.titulo)}</div>
      <div class="pf-ordem">
        <button type="button" onclick="GradeExcel.ordenar(1)">↑ Classificar ${n ? (col.tipo === 'data' ? 'da mais antiga' : 'do menor para o maior') : 'de A a Z'}</button>
        <button type="button" onclick="GradeExcel.ordenar(-1)">↓ Classificar ${n ? (col.tipo === 'data' ? 'da mais nova' : 'do maior para o menor') : 'de Z a A'}</button>
      </div>
      <input type="search" id="gxBusca" placeholder="Pesquisar..." oninput="GradeExcel.lista()">
      <div class="pf-lista" id="gxLista"></div>
      <div class="pf-rodape">
        <button type="button" class="pf-limpar" onclick="GradeExcel.limparColuna()">Limpar filtro</button>
        <span style="flex:1"></span>
        <button type="button" class="pf-cancelar" onclick="GradeExcel.fechar()">Cancelar</button>
        <button type="button" class="pf-ok" onclick="GradeExcel.confirmar()">OK</button>
      </div>`;
    GradeExcel.lista();
    const r = (event.currentTarget.closest('th') || event.currentTarget).getBoundingClientRect();
    p.style.display = 'block';
    p.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - p.offsetWidth - 8)) + 'px';
    p.style.top = (window.scrollY + r.bottom + 4) + 'px';
    setTimeout(() => document.getElementById('gxBusca')?.focus(), 0);
  }
  static visiveisFiltro() {
    const b = (document.getElementById('gxBusca')?.value || '').trim().toLowerCase();
    return GradeExcel.aberta.valores.filter(v => !b || v.toLowerCase().includes(b));
  }
  static lista() {
    const a = GradeExcel.aberta, el = document.getElementById('gxLista');
    if (!a || !el) return;
    const vis = GradeExcel.visiveisFiltro(), mostrar = vis.slice(0, 1000);
    const todos = vis.length && vis.every(v => a.marcados.has(v));
    el.innerHTML = `<label class="pf-item pf-todos"><input type="checkbox" ${todos ? 'checked' : ''} onchange="GradeExcel.marcarTodos(this.checked)"><span>(Selecionar tudo${vis.length !== a.valores.length ? ' da pesquisa' : ''})</span></label>
      ${mostrar.map((v, i) => `<label class="pf-item"><input type="checkbox" data-i="${i}" ${a.marcados.has(v) ? 'checked' : ''} onchange="GradeExcel.marcar(this)"><span>${escHTML(v || '(vazio)')}</span><small>${a.contagem.get(v) || 0}</small></label>`).join('')}
      ${vis.length > 1000 ? `<div class="pf-aviso">Mostrando 1000 de ${vis.length} valores · use a pesquisa</div>` : ''}${!vis.length ? '<div class="pf-aviso">Nenhum valor encontrado.</div>' : ''}`;
    el._vis = mostrar;
  }
  static marcar(cb) {
    const a = GradeExcel.aberta, v = document.getElementById('gxLista')._vis[Number(cb.dataset.i)];
    if (cb.checked) a.marcados.add(v); else a.marcados.delete(v);
    const t = document.querySelector('#gxLista .pf-todos input');
    if (t) t.checked = GradeExcel.visiveisFiltro().every(x => a.marcados.has(x));
  }
  static marcarTodos(m) { const a = GradeExcel.aberta; GradeExcel.visiveisFiltro().forEach(v => { if (m) a.marcados.add(v); else a.marcados.delete(v); }); GradeExcel.lista(); }
  static confirmar() {
    const a = GradeExcel.aberta;
    if (!a) return;
    const b = (document.getElementById('gxBusca')?.value || '').trim();
    const ok = b ? new Set(GradeExcel.visiveisFiltro().filter(v => a.marcados.has(v))) : a.marcados;
    const desm = new Set(a.valores.filter(v => !ok.has(v)));
    if (desm.size) a.grade.filtros[a.chave] = desm; else delete a.grade.filtros[a.chave];
    GradeExcel.fechar(); a.grade.mostrar = a.grade.op.porPagina; a.grade.aoFiltrar(); a.grade.renderizar();
  }
  static limparColuna() { const a = GradeExcel.aberta; if (!a) return; delete a.grade.filtros[a.chave]; GradeExcel.fechar(); a.grade.aoFiltrar(); a.grade.renderizar(); }
  static ordenar(dir) { const a = GradeExcel.aberta; if (!a) return; a.grade.ordem = { chave: a.chave, dir }; GradeExcel.fechar(); a.grade.renderizar(); }
  static fechar() { GradeExcel.aberta = null; const p = document.getElementById('popupGradeExcel'); if (p) p.style.display = 'none'; }
  limparTudo() { this.filtros = {}; this.ordem = null; GradeExcel.fechar(); this.aoFiltrar(); this.renderizar(); }
  /** Gancho chamado quando os filtros mudam (para guardar ou reagir). */
  aoFiltrar() { if (typeof this.op.aoFiltrar === 'function') this.op.aoFiltrar(this); }

  // ------------------------------------------------------------ exportar
  exportar(formato) {
    const vis = this.visiveis();
    const cab = this.colunas.map(c => c.titulo);
    const linhas = vis.map(l => this.colunas.map(c => {
      if (c.tipo === 'num') return GradeExcel.numeroBR(l[c.chave]);
      if (c.tipo === 'data') return this.texto(c, l);
      const v = l[c.chave]; return v === null || v === undefined || typeof v === 'object' ? '' : String(v);
    }));
    if (typeof epBaixarPlanilha === 'function') epBaixarPlanilha(cab, linhas, this.op.nomeArquivo, formato, this.colunas.filter(c => c.tipo === 'num').map(c => c.titulo));
  }
}
GradeExcel.todas = {};
GradeExcel.aberta = null;
document.addEventListener('click', () => { if (GradeExcel.aberta) GradeExcel.fechar(); });
document.addEventListener('keydown', e => {
  if (!GradeExcel.aberta) return;
  if (e.key === 'Escape') GradeExcel.fechar();
  if (e.key === 'Enter' && e.target && e.target.id === 'gxBusca') GradeExcel.confirmar();
});
