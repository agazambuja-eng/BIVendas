/**
 * Módulo de Gerenciamento do Modal de Lojas
 * Responsável por conectar ao Supabase, gerenciar o estado das lojas
 * e manipular a interface do modal de seleção.
 */

(function () {
  // Conexão com o Supabase vem de supabase-config.js (buscarLojasSupabase)
  if (typeof buscarLojasSupabase !== 'function') {
    console.error("supabase-config.js não foi carregado no HTML.");
    return;
  }

  let lojasDisponiveis = [];

  /**
   * Busca as lojas cadastradas na base de dados do Supabase.
   */
  async function carregarLojasSupabase() {
    try {
      lojasDisponiveis = await buscarLojasSupabase();
    } catch (err) {
      console.error("Falha crítica ao carregar lojas do Supabase:", err.message);
      lojasDisponiveis = [];
    }
  }

  /**
   * Renderiza os elementos HTML dinamicamente dentro do modal.
   * @param {Array} lista - Lista de lojas a serem exibidas.
   */
  function renderizarListaLojasModal(lista) {
    const container = document.getElementById("listaLojasModal");
    if (!container) return;
    
    container.innerHTML = "";

    if (!lista || lista.length === 0) {
      container.innerHTML = `<div style="padding: 12px; text-align: center; color: #666; font-size: 13px;">Nenhuma loja encontrada.</div>`;
      return;
    }

    const inputLojas = document.getElementById("lojas");
    const idsAtuais = inputLojas ? inputLojas.value.split(",").map(s => s.trim()) : [];
    
    const fragmento = document.createDocumentFragment();
    const listaOrdenada = [...lista].sort((a, b) => Number(a.id) - Number(b.id));

    listaOrdenada.forEach(loja => {
      const isChecked = idsAtuais.includes(String(loja.id)) ? "checked" : "";
      
      const label = document.createElement("label");
      label.className = "item-loja-modal";
      label.setAttribute("data-texto", `[${loja.id}] ${loja.nome} ${loja.gerente || ''}`);
      label.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #eee; cursor: pointer;";
      
      label.innerHTML = `
        <div>
          <input type="checkbox" value="${loja.id}" ${isChecked} style="width: auto; margin-right: 8px;"> 
          <strong>[${loja.id}]</strong> ${loja.nome}
        </div>
        <span style="color: #666; font-size: 11px;">Gerente: ${loja.gerente || '-'}</span>
      `;
      fragmento.appendChild(label);
    });

    container.appendChild(fragmento);
  }

  /**
   * Abre o modal de seleção de lojas e garante os dados carregados.
   */
  window.abrirModalLojas = async function () {
    const inputFiltro = document.getElementById("inputFiltroGerenteModal");
    if (inputFiltro) inputFiltro.value = "";

    if (lojasDisponiveis.length === 0) {
      await carregarLojasSupabase();
    }

    renderizarListaLojasModal(lojasDisponiveis);

    const modal = document.getElementById("modalLojas");
    if (modal) modal.style.display = "flex";
  };

  /**
   * Filtra as lojas exibidas no modal com base no texto digitado.
   */
  window.filtrarLojasNoModal = function () {
    const inputFiltro = document.getElementById("inputFiltroGerenteModal");
    if (!inputFiltro) return;

    const termo = inputFiltro.value.trim().toUpperCase();
    const labels = document.querySelectorAll("#listaLojasModal .item-loja-modal");
    
    labels.forEach(label => {
      const texto = label.getAttribute("data-texto").toUpperCase();
      label.style.display = (texto.includes(termo) || termo === "") ? "flex" : "none";
    });
  };

  /**
   * Fecha o modal de lojas.
   */
  window.fecharModalLojas = function () {
    const modal = document.getElementById("modalLojas");
    if (modal) modal.style.display = "none";
  };

  /**
   * Marca ou desmarca todas as lojas visíveis na listagem atual do modal.
   */
  window.toggleSelecionarTodasLojas = function (master) {
    document.querySelectorAll("#listaLojasModal .item-loja-modal").forEach(label => {
      if (label.style.display !== "none") {
        const checkbox = label.querySelector("input[type='checkbox']");
        if (checkbox) checkbox.checked = master.checked;
      }
    });
  };

  /**
   * Confirma a seleção e popula o campo de texto principal com os IDs escolhidos.
   */
  window.confirmarSelecaoLojas = function () {
    const idsSelecionados = [];
    document.querySelectorAll("#listaLojasModal input[type='checkbox']").forEach(checkbox => {
      if (checkbox.checked) idsSelecionados.push(checkbox.value);
    });

    const inputLojas = document.getElementById("lojas");
    if (inputLojas) inputLojas.value = normalizarListaLojas(idsSelecionados.join(","));
    
    window.fecharModalLojas();
  };

  // Carregamento inicial assíncrono em background ao carregar o script
  carregarLojasSupabase();
})();
