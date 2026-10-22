/**
 * Módulo Principal de Execução e Regras de Negócio do BI
 * Atualizado: Adicionado Ticket Médio ordenado do maior para o menor no card de resumo do modal de zoom.
 */

const SUPABASE_URL = 'https://cwmofpwuihrnifsvqhik.supabase.co';
const SUPABASE_KEY = 'sb_publishable_biWjIRo9x6maeZXcoKX6Lw_l-fjV0wP';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let lojasDisponiveis = [];
let meuGraficoLojas = null;             
let meuGraficoPagamentos = null;  
let meuGraficoLojaVendedor = null;      
let dadosPagamentosPorLojaGlobal = {}; 
let dadosBrutosGlobaisParaGrafico = []; 
let meuGraficoZoomPagamento = null;    
let meuGraficoZoomQuantidade = null;   

const CORES_PALETA = [
  '#0078d7', '#5cb85c', '#f0ad4e', '#d9534f', '#6f42c1', 
  '#17a2b8', '#e83e8c', '#fd7e14', '#20c997', '#6610f2'
];

window.onload = async () => {
  await carregarLojasSupabase();
};

// --- FUNÇÃO GLOBAL DA SANFONA (ACORDEON) ---
function toggleAcordeon(idUnico) {
  const elemento = document.getElementById(idUnico);
  const seta = document.getElementById('seta_' + idUnico);
  
  if (elemento) {
    if (elemento.style.display === "none" || elemento.style.display === "") {
      elemento.style.display = "block";
      if (seta) seta.style.transform = "rotate(90deg)";
    } else {
      elemento.style.display = "none";
      if (seta) seta.style.transform = "rotate(0deg)";
    }
  }
}

// --- FUNÇÃO DE CONTROLE DE ABAS ---
function mudarAba(aba) {
  const btnCards = document.getElementById("btnAbaCards");
  const btnDashboard = document.getElementById("btnAbaDashboard");
  const btnDetalhes = document.getElementById("btnAbaDetalhes");
  
  const conteudoCards = document.getElementById("conteudoAbaCards");
  const conteudoDashboard = document.getElementById("conteudoAbaDashboard");
  const conteudoDetalhes = document.getElementById("conteudoAbaDetalhes");

  conteudoCards.style.display = "none";
  conteudoDashboard.style.display = "none";
  if (conteudoDetalhes) conteudoDetalhes.style.display = "none";

  btnCards.style.background = "#e0e0e0"; btnCards.style.color = "#333";
  btnDashboard.style.background = "#e0e0e0"; btnDashboard.style.color = "#333";
  if (btnDetalhes) { btnDetalhes.style.background = "#e0e0e0"; btnDetalhes.style.color = "#333"; }

  if (aba === 'cards') {
    conteudoCards.style.display = "flex";
    btnCards.style.background = "#0078d7";
    btnCards.style.color = "#fff";
  } else if (aba === 'dashboard') {
    conteudoDashboard.style.display = "flex";
    btnDashboard.style.background = "#0078d7";
    btnDashboard.style.color = "#fff";
  } else if (aba === 'detalhes') {
    if (conteudoDetalhes) conteudoDetalhes.style.display = "flex";
    if (btnDetalhes) {
      btnDetalhes.style.background = "#0078d7";
      btnDetalhes.style.color = "#fff";
    }
  }
}

// --- FUNÇÕES DO MODAL DE LOJAS ---
async function carregarLojasSupabase() {
  try {
    const { data, error } = await supabaseClient
      .from('lojas')
      .select('id, nome, gerente')
      .order('id', { ascending: true });
    
    if (error) throw error;
    lojasDisponiveis = data || [];
  } catch (err) {
    console.error("Erro ao carregar lojas do Supabase:", err.message);
  }
}

function abrirModalLojas() {
  const inputFiltro = document.getElementById("inputFiltroGerenteModal");
  if (inputFiltro) inputFiltro.value = "";
  renderizarListaLojasModal(lojasDisponiveis);
  const modal = document.getElementById("modalLojas");
  if (modal) modal.style.display = "flex";
}

function renderizarListaLojasModal(lista) {
  const container = document.getElementById("listaLojasModal");
  if (!container) return;
  container.innerHTML = "";
  
  const inputLojas = document.getElementById("lojas");
  const idsAtuais = inputLojas ? inputLojas.value.split(",").map(s => s.trim()) : [];
  const listaOrdenada = [...lista].sort((a, b) => Number(a.id) - Number(b.id));

  listaOrdenada.forEach(loja => {
    const checked = idsAtuais.includes(String(loja.id)) ? "checked" : "";
    container.innerHTML += `
      <label class="item-loja-modal" data-texto="[${loja.id}] ${loja.nome} ${loja.gerente || ''}" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #eee; cursor: pointer;">
        <div>
          <input type="checkbox" value="${loja.id}" ${checked} style="width: auto; margin-right: 8px;"> 
          <strong>[${loja.id}]</strong> ${loja.nome}
        </div>
        <span style="color: #666; font-size: 11px;">Gerente: ${loja.gerente || '-'}</span>
      </label>
    `;
  });
}

function filtrarLojasNoModal() {
  const termo = document.getElementById("inputFiltroGerenteModal").value.trim().toUpperCase();
  const labels = document.querySelectorAll("#listaLojasModal .item-loja-modal");
  labels.forEach(label => {
    const texto = label.getAttribute("data-texto").toUpperCase();
    label.style.display = (texto.includes(termo) || termo === "") ? "flex" : "none";
  });
}

function fecharModalLojas() { 
  const modal = document.getElementById("modalLojas");
  if (modal) modal.style.display = "none"; 
}

function toggleSelecionarTodasLojas(master) {
  document.querySelectorAll("#listaLojasModal .item-loja-modal").forEach(label => {
    if (label.style.display !== "none") {
      const cb = label.querySelector("input[type='checkbox']");
      if (cb) cb.checked = master.checked;
    }
  });
}

function confirmarSelecaoLojas() {
  const ids = [];
  document.querySelectorAll("#listaLojasModal input[type='checkbox']").forEach(cb => { 
    if (cb.checked) ids.push(cb.value); 
  });
  const inputLojas = document.getElementById("lojas");
  if (inputLojas) inputLojas.value = ids.join(",");
  fecharModalLojas();
}
// ---------------------------------

// --- FUNÇÕES DO MODAL DE ZOOM ---
function abrirModalZoom(rotuloChave) {
  const dadosDoGrupo = dadosPagamentosPorLojaGlobal[rotuloChave];
  if (!dadosDoGrupo) return;

  const tituloEl = document.getElementById("tituloModalZoom");
  if (tituloEl) {
    tituloEl.innerText = `Detalhes por Loja — ${rotuloChave}`;
  }

  let melhorLojaValor = { id: '', valor: -1 };
  let melhorLojaQtd = { id: '', qtd: -1 };

  Object.keys(dadosDoGrupo.lojas).forEach(idLoja => {
    const d = dadosDoGrupo.lojas[idLoja];
    if (d.vendasValor > melhorLojaValor.valor) {
      melhorLojaValor = { id: idLoja, valor: d.vendasValor };
    }
    if (d.quantidadeVendas > melhorLojaQtd.qtd) {
      melhorLojaQtd = { id: idLoja, qtd: d.quantidadeVendas };
    }
  });

  const destaqueEl = document.getElementById("destaqueCampeaoModal");
  if (destaqueEl) {
    destaqueEl.innerHTML = `
      🏆 <strong>Destaque na Forma de Pagamento:</strong><br>
      • Maior Faturamento: <strong style="color: #0056b3;">Loja ${melhorLojaValor.id}</strong> com <strong>${formatarMoedaBR(melhorLojaValor.valor)}</strong><br>
      • Maior Volume de Vendas: <strong style="color: #0056b3;">Loja ${melhorLojaQtd.id}</strong> com <strong>${melhorLojaQtd.qtd} vendas</strong>
    `;
  }

  const modal = document.getElementById("modalZoomPagamento");
  if (modal) modal.style.display = "flex";

  const lojasIds = Object.keys(dadosDoGrupo.lojas);
  const labelsLojas = lojasIds.map(id => `Loja ${id}`);
  const valoresLojas = lojasIds.map(id => dadosDoGrupo.lojas[id].vendasValor);
  const qtdLojas = lojasIds.map(id => dadosDoGrupo.lojas[id].quantidadeVendas);

  if (meuGraficoZoomPagamento) meuGraficoZoomPagamento.destroy();
  if (meuGraficoZoomQuantidade) meuGraficoZoomQuantidade.destroy();

  const ctxZoomValores = document.getElementById("graficoZoomPagamentoLoja");
  if (ctxZoomValores) {
    meuGraficoZoomPagamento = new Chart(ctxZoomValores, {
      type: 'bar',
      data: {
        labels: labelsLojas,
        datasets: [{ 
          label: 'Valor (R$)', 
          data: valoresLojas, 
          backgroundColor: CORES_PALETA.slice(0, labelsLojas.length), 
          borderWidth: 1 
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: function(context) { return ` Valor: ${formatarMoedaBR(context.raw)}`; } }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: function(value) { return 'R$ ' + value.toLocaleString('pt-BR'); } }
          }
        }
      }
    });
  }

  const ctxZoomQtd = document.getElementById("graficoZoomQuantidadeLoja");
  if (ctxZoomQtd) {
    meuGraficoZoomQuantidade = new Chart(ctxZoomQtd, {
      type: 'bar',
      data: {
        labels: labelsLojas,
        datasets: [{ 
          label: 'Quantidade de Vendas', 
          data: qtdLojas, 
          backgroundColor: CORES_PALETA.slice(0, labelsLojas.length), 
          borderWidth: 1 
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: function(context) { return ` Qtd Vendas: ${context.raw}`; } }
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }
}

// Função para abrir modal detalhado de uma loja específica clicada no gráfico de VENDEDORES (inferior)
function abrirModalZoomLojaUnica(idLoja) {
  const dadosLojaObj = dadosBrutosGlobaisParaGrafico.filter(item => {
    let textoLoja = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? "").trim();
    let matchLoja = textoLoja.match(/^0*(\d+)/);
    let idL = matchLoja ? matchLoja[1] : textoLoja;
    return idL === String(idLoja);
  });

  if (!dadosLojaObj.length) return;

  const tituloEl = document.getElementById("tituloModalZoom");
  if (tituloEl) {
    tituloEl.innerText = `Detalhes dos Vendedores — Loja ${idLoja}`;
  }

  const vendasVendedores = {};
  let totalLiquidoLoja = 0;
  let osUnicasLoja = new Set();

  dadosLojaObj.forEach(item => {
    const vendedor = item.VENDEDOR ? item.VENDEDOR.trim() : "NÃO INFORMADO";
    const liquido = parseNumeroBR(item.LIQUIDOPRODUTO);
    const os = String(item.OS || "").trim();

    if (!vendasVendedores[vendedor]) {
      vendasVendedores[vendedor] = { valor: 0, qtd: 0, osMap: {} };
    }
    vendasVendedores[vendedor].valor += liquido;
    if (os) {
      vendasVendedores[vendedor].osMap[os] = true;
      osUnicasLoja.add(os);
    }
  });

  Object.keys(vendasVendedores).forEach(v => {
    vendasVendedores[v].qtd = Object.keys(vendasVendedores[v].osMap).length;
    totalLiquidoLoja += vendasVendedores[v].valor;
  });

  // Calculando o Ticket Médio Geral da Loja
  const totalQtdLoja = osUnicasLoja.size;
  const ticketMedioGeralLoja = totalQtdLoja > 0 ? (totalLiquidoLoja / totalQtdLoja) : 0;

  // Criando a lista de vendedores com seus respectivos tickets médios para ordená-los do maior para o menor
  let listaVendedoresArray = Object.keys(vendasVendedores).map(vendedor => {
    const dadosV = vendasVendedores[vendedor];
    const tmVendedor = dadosV.qtd > 0 ? (dadosV.valor / dadosV.qtd) : 0;
    return {
      nome: vendedor,
      valor: dadosV.valor,
      qtd: dadosV.qtd,
      ticketMedio: tmVendedor
    };
  });

  // Ordenando do maior Ticket Médio para o menor
  listaVendedoresArray.sort((a, b) => b.ticketMedio - a.ticketMedio);

  const destaqueEl = document.getElementById("destaqueCampeaoModal");
  if (destaqueEl) {
    destaqueEl.innerHTML = `
      🏪 <strong>Resumo da Loja ${idLoja}:</strong><br>
      • Faturamento Líquido Total: <strong style="color: #0056b3;">${formatarMoedaBR(totalLiquidoLoja)}</strong><br>
      • Total de Vendas (OS): <strong style="color: #0056b3;">${totalQtdLoja}</strong><br>
      • Ticket Médio da Loja: <strong style="color: #28a745;">${formatarMoedaBR(ticketMedioGeralLoja)}</strong>
    `;
  }

  const modal = document.getElementById("modalZoomPagamento");
  if (modal) modal.style.display = "flex";

  const labelsVendedores = listaVendedoresArray.map(v => v.nome);
  const valoresVendedores = listaVendedoresArray.map(v => v.valor);
  const qtdVendedores = listaVendedoresArray.map(v => v.qtd);

  if (meuGraficoZoomPagamento) meuGraficoZoomPagamento.destroy();
  if (meuGraficoZoomQuantidade) meuGraficoZoomQuantidade.destroy();

  const ctxZoomValores = document.getElementById("graficoZoomPagamentoLoja");
  if (ctxZoomValores) {
    meuGraficoZoomPagamento = new Chart(ctxZoomValores, {
      type: 'bar',
      data: {
        labels: labelsVendedores,
        datasets: [{ 
          label: 'Valor Líquido (R$)', 
          data: valoresVendedores, 
          backgroundColor: CORES_PALETA.slice(0, labelsVendedores.length), 
          borderWidth: 1 
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: function(context) { return ` Líquido: ${formatarMoedaBR(context.raw)}`; } }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: function(value) { return 'R$ ' + value.toLocaleString('pt-BR'); } }
          }
        }
      }
    });
  }

  const ctxZoomQtd = document.getElementById("graficoZoomQuantidadeLoja");
  if (ctxZoomQtd) {
    meuGraficoZoomQuantidade = new Chart(ctxZoomQtd, {
      type: 'bar',
      data: {
        labels: labelsVendedores,
        datasets: [{ 
          label: 'Quantidade de Vendas', 
          data: qtdVendedores, 
          backgroundColor: CORES_PALETA.slice(0, labelsVendedores.length), 
          borderWidth: 1 
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: function(context) { return ` Qtd Vendas: ${context.raw}`; } }
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }
}

function fecharModalZoom() {
  const modal = document.getElementById("modalZoomPagamento");
  if (modal) modal.style.display = "none";
}
// ---------------------------------------------

function formatarDataISOparaBR(dataISO) {
  if (!dataISO) return "";
  const partes = dataISO.split("-");
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function parseNumeroBR(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;
  if (typeof valor === 'number') return valor;
  const n = parseFloat(String(valor).replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function formatarMoedaBR(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function consultar() {
  document.getElementById("loadingOverlay").style.display = "flex";
  
  const containerResultado = document.getElementById("resultado");
  if (containerResultado) containerResultado.innerHTML = "";

  const dataInicial = formatarDataISOparaBR(document.getElementById("dataInicial").value);
  const dataFinal = formatarDataISOparaBR(document.getElementById("dataFinal").value);
  const lojas = document.getElementById("lojas").value;
  const tipodata = document.getElementById("tipodata").value || "VENDA";

  const bodyReq = {
    DATAINICIAL: dataInicial,
    DATAFINAL: dataFinal,
    LOJAS: lojas,
    TIPODATA: tipodata,
    TIPOVENDA: ""
  };

  try {
    const [resGrid, resPagamentos] = await Promise.all([
      fetch("/consulta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyReq)
      }),
      fetch("/consultapagamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyReq)
      })
    ]);

    if (!resGrid.ok) throw new Error("Erro na requisição dos dados de produtos: " + resGrid.status);
    
    const dadosBrutos = await resGrid.json();
    let dadosPagamentos = [];

    if (resPagamentos.ok) {
      dadosPagamentos = await resPagamentos.json();
    }

    processarDadosBI(dadosBrutos, dadosPagamentos);

  } catch (error) {
    if (containerResultado) {
      containerResultado.innerHTML = "<p class='erro'>" + error.message + "</p>";
    }
    document.getElementById("biTabsHeader").style.display = "none";
    document.getElementById("biCardsContainer").style.display = "none";
  } finally {
    document.getElementById("loadingOverlay").style.display = "none";
  }
}

function processarDadosBI(dados, dadosPagamentos) {
  if (!dados || dados.length === 0) {
    document.getElementById("biTabsHeader").style.display = "none";
    document.getElementById("biCardsContainer").style.display = "none";
    return;
  }

  const lojasDigitadas = document.getElementById("lojas").value.trim();
  let dadosFiltrados = dados;

  if (lojasDigitadas) {
    const idsFiltro = lojasDigitadas.split(",").map(id => id.trim());
    dadosFiltrados = dados.filter(item => {
      const textoLojaCompleto = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? "").trim();
      const matchCodigo = textoLojaCompleto.match(/^0*(\d+)/);
      const codigoExtraido = matchCodigo ? matchCodigo[1] : textoLojaCompleto;
      const codigoSemZeroEsquerda = matchCodigo ? String(parseInt(matchCodigo[1], 10)) : codigoExtraido;

      return idsFiltro.includes(codigoExtraido) || 
             idsFiltro.includes(codigoSemZeroEsquerda) || 
             idsFiltro.some(id => textoLojaCompleto.toLowerCase().includes(id.toLowerCase()));
    });
  }

  dadosBrutosGlobaisParaGrafico = dadosFiltrados;

  let totalBrutoGeral = 0;
  let totalDescontoGeral = 0;
  let totalLiquidoGeral = 0;

  const totaisPorLoja = {};
  const osPorLojaEId = {}; 

  dadosFiltrados.forEach((item) => {
    const bruto = parseNumeroBR(item.VALORBRUTOPRODUTO);
    const desconto = parseNumeroBR(item.DESCPRODUTO);
    const liquido = parseNumeroBR(item.LIQUIDOPRODUTO);

    totalBrutoGeral += bruto;
    totalDescontoGeral += desconto;
    totalLiquidoGeral += liquido;

    const textoLoja = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? "").trim();
    const matchLoja = textoLoja.match(/^0*(\d+)/);
    const idLoja = matchLoja ? matchLoja[1] : textoLoja;

    if (!totaisPorLoja[idLoja]) {
      totaisPorLoja[idLoja] = { bruto: 0, desconto: 0, liquido: 0 };
    }
    totaisPorLoja[idLoja].bruto += bruto;
    totaisPorLoja[idLoja].desconto += desconto;
    totaisPorLoja[idLoja].liquido += liquido;

    const numeroOS = String(item.OS || "").trim();
    if (numeroOS) {
      if (!osPorLojaEId[idLoja]) {
        osPorLojaEId[idLoja] = {};
      }
      if (!osPorLojaEId[idLoja][numeroOS]) {
        osPorLojaEId[idLoja][numeroOS] = 0; 
      }
      osPorLojaEId[idLoja][numeroOS] += bruto;
    }
  });

  const osUnicasValidasPorLoja = {};
  Object.keys(osPorLojaEId).forEach(idLoja => {
    osUnicasValidasPorLoja[idLoja] = new Set();
    const listaOSsDaLoja = osPorLojaEId[idLoja];
    
    Object.keys(listaOSsDaLoja).forEach(numeroOS => {
      const valorTotalDaOS = listaOSsDaLoja[numeroOS];
      if (valorTotalDaOS > 0) {
        osUnicasValidasPorLoja[idLoja].add(numeroOS);
      }
    });
  });

  let htmlBrutoPorLoja = "";
  let htmlDescontoPorLoja = "";
  let htmlLiquidoPorLoja = "";
  let htmlQtdeVendasPorLoja = "";
  let htmlTicketMedioPorLoja = "";
  let totalGeralVendasOS = 0;

  Object.keys(totaisPorLoja).forEach(id => {
    const t = totaisPorLoja[id];
    const qtdVendasLoja = osUnicasValidasPorLoja[id] ? osUnicasValidasPorLoja[id].size : 0;
    totalGeralVendasOS += qtdVendasLoja;

    const ticketMedioLoja = qtdVendasLoja > 0 ? (t.liquido / qtdVendasLoja) : 0;

    htmlBrutoPorLoja += `<div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px;"><span><strong>${id}</strong></span> <span>${formatarMoedaBR(t.bruto)}</span></div>`;
    htmlDescontoPorLoja += `<div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px;"><span><strong>${id}</strong></span> <span>${formatarMoedaBR(t.desconto)}</span></div>`;
    htmlLiquidoPorLoja += `<div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px;"><span><strong>${id}</strong></span> <span>${formatarMoedaBR(t.liquido)}</span></div>`;
    htmlQtdeVendasPorLoja += `<div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px;"><span><strong>${id}</strong></span> <span>${qtdVendasLoja}</span></div>`;
    htmlTicketMedioPorLoja += `<div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px;"><span><strong>${id}</strong></span> <span>${formatarMoedaBR(ticketMedioLoja)}</span></div>`;
  });

  const ticketMedioGeral = totalGeralVendasOS > 0 ? (totalLiquidoGeral / totalGeralVendasOS) : 0;

  // --- PROCESSAMENTO DA API DE PAGAMENTOS ---
  let pagamentosFiltrados = [];
  dadosPagamentosPorLojaGlobal = {};

  if (Array.isArray(dadosPagamentos) && dadosPagamentos.length > 0) {
    pagamentosFiltrados = dadosPagamentos;
    if (lojasDigitadas) {
      const idsFiltro = lojasDigitadas.split(",").map(id => id.trim());
      pagamentosFiltrados = dadosPagamentos.filter(pgto => {
        const textoLojaPgto = String(pgto.LOJA || pgto.CODIGOLOJA || "").trim();
        const matchPgto = textoLojaPgto.match(/^0*(\d+)/);
        const codPgto = matchPgto ? matchPgto[1] : textoLojaPgto;
        const codPgtoSemZero = matchPgto ? String(parseInt(matchPgto[1], 10)) : codPgto;

        return idsFiltro.includes(codPgto) || 
               idsFiltro.includes(codPgtoSemZero) || 
               idsFiltro.some(id => textoLojaPgto.toLowerCase().includes(id.toLowerCase()));
      });
    }
  }

  let htmlPagamentos = "";
  if (pagamentosFiltrados.length > 0) {
    const agrupadoPagamentos = {};

    pagamentosFiltrados.forEach(pgto => {
      const meio = (pgto.MEIO_PAGAMENTO || pgto.MEIOPAGAMENTO || "NÃO ESPECIFICADO").trim();
      const parcelas = (pgto.N_PARCELAS || "1").trim();

      const textoLojaPgto = String(pgto.LOJA || pgto.CODIGOLOJA || "Geral").trim();
      const matchLojaPgto = textoLojaPgto.match(/^0*(\d+)/);
      const idLoja = matchLojaPgto ? matchLojaPgto[1] : textoLojaPgto;

      const qtdUso = parseNumeroBR(pgto.QTDE_USO || 1);
      const valorTotalPgto = parseNumeroBR(pgto.VENDAS_VALOR || 0);

      const chaveReal = `${meio}|${parcelas}`;

      if (!agrupadoPagamentos[chaveReal]) {
        agrupadoPagamentos[chaveReal] = {
          meioPagamento: meio,
          nParcelas: parcelas,
          lojas: {}
        };
      }

      if (!agrupadoPagamentos[chaveReal].lojas[idLoja]) {
        agrupadoPagamentos[chaveReal].lojas[idLoja] = { quantidadeVendas: 0, vendasValor: 0 };
      }

      agrupadoPagamentos[chaveReal].lojas[idLoja].quantidadeVendas += qtdUso;
      agrupadoPagamentos[chaveReal].lojas[idLoja].vendasValor += valorTotalPgto;
    });

    dadosPagamentosPorLojaGlobal = agrupadoPagamentos;

    htmlPagamentos = Object.keys(agrupadoPagamentos).map(chaveReal => {
      const item = agrupadoPagamentos[chaveReal];
      let totalGeralValorGrupo = 0;
      let totalGeralQtdGrupo = 0;

      Object.keys(item.lojas).forEach(idLoja => {
        const dadosLoja = item.lojas[idLoja];
        totalGeralValorGrupo += dadosLoja.vendasValor;
        totalGeralQtdGrupo += dadosLoja.quantidadeVendas;
      });

      let linhasLojasHTML = Object.keys(item.lojas).map(idLoja => {
        const dadosLoja = item.lojas[idLoja];
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; border-bottom: 1px dashed #eee; font-size: 12px; background: #fff;">
            <span style="font-weight: bold; color: #555;">Loja ${idLoja}</span>
            <span style="color: #333;">${formatarMoedaBR(dadosLoja.vendasValor)}</span>
            <span style="color: #666; font-size: 11px;">Qtd: <strong>${dadosLoja.quantidadeVendas}</strong></span>
          </div>
        `;
      }).join("");

      const idUnico = 'acordeon_' + chaveReal.replace(/[^a-zA-Z0-9]/g, '_');

      return `
        <div style="margin-bottom: 8px; background: #fafafa; border-radius: 6px; border: 1px solid #e0e0e0; overflow: hidden;">
          
          <div onclick="toggleAcordeon('${idUnico}')" style="padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: #fdfdfd; user-select: none;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="seta_${idUnico}" style="font-size: 12px; font-weight: bold; transition: transform 0.2s; display: inline-block;">▶</span>
              <span style="font-size: 12px; font-weight: bold; color: #333;">${item.meioPagamento} <span style="color: #666; font-weight: normal; font-size: 11px;">(${item.nParcelas})</span></span>
            </div>
            
            <div style="display: flex; gap: 12px; align-items: center; font-size: 12px;">
              <span style="color: #555; font-size: 11px;">Qtd: <strong>${totalGeralQtdGrupo}</strong></span>
              <span style="color: #0078d7; font-weight: bold;">${formatarMoedaBR(totalGeralValorGrupo)}</span>
              <button type="button" onclick="event.stopPropagation(); abrirModalZoom('${chaveReal}')" style="background: #0078d7; color: #fff; border: none; padding: 3px 6px; border-radius: 4px; font-size: 10px; cursor: pointer;" title="Ver Detalhes por Loja">🔍</button>
            </div>
          </div>

          <div id="${idUnico}" style="display: none; border-top: 1px solid #eee; background: #fff;">
            <div>
              ${linhasLojasHTML}
            </div>
          </div>

        </div>
      `;
    }).join("");
  } else {
    htmlPagamentos = "Nenhum registro de pagamento para a(s) loja(s) selecionada(s).";
  }
  
  document.getElementById("cardValorBruto").innerHTML = `${htmlBrutoPorLoja}<hr style="border:0; border-top:1px solid #ddd; margin: 8px 0;"><div style="font-size: 15px; font-weight: bold;">${formatarMoedaBR(totalBrutoGeral)}</div>`;
  document.getElementById("cardDesconto").innerHTML = `${htmlDescontoPorLoja}<hr style="border:0; border-top:1px solid #ddd; margin: 8px 0;"><div style="font-size: 15px; font-weight: bold; color: #d9534f;;">${formatarMoedaBR(totalDescontoGeral)}</div>`;
  document.getElementById("cardValorLiquido").innerHTML = `${htmlLiquidoPorLoja}<hr style="border:0; border-top:1px solid #ddd; margin: 8px 0;"><div style="font-size: 15px; font-weight: bold;">${formatarMoedaBR(totalLiquidoGeral)}</div>`;
  
  const cardQtdeVendasEl = document.getElementById("cardQtdeVendas");
  if (cardQtdeVendasEl) {
    cardQtdeVendasEl.innerHTML = `${htmlQtdeVendasPorLoja}<hr style="border:0; border-top:1px solid #ddd; margin: 8px 0;"><div style="font-size: 15px; font-weight: bold;">Total vendas: ${totalGeralVendasOS}</div>`;
  }

  const cardTicketMedioEl = document.getElementById("cardTicketMedio");
  if (cardTicketMedioEl) {
    cardTicketMedioEl.innerHTML = `${htmlTicketMedioPorLoja}<hr style="border:0; border-top:1px solid #ddd; margin: 8px 0;"><div style="font-size: 15px; font-weight: bold;">Ticket Médio: ${formatarMoedaBR(ticketMedioGeral)}</div>`;
  }

  document.getElementById("cardResumoPagamento").innerHTML = htmlPagamentos;
  
  document.getElementById("biTabsHeader").style.display = "flex";
  document.getElementById("biCardsContainer").style.display = "flex";
  mudarAba('dashboard');
  
  // --- PROCESSAMENTO DO RESUMO POR LOJAS E VENDEDORES ---
  let agrupadoPorLoja = {};

  dadosFiltrados.forEach(item => {
    let textoLoja = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? "Geral").trim();
    let matchLoja = textoLoja.match(/^0*(\d+)/);
    let idLoja = matchLoja ? matchLoja[1] : textoLoja;
    let nomeLojaCompleta = item.LOJANOME || `Loja ${idLoja}`;

    let nomeVendedor = item.VENDEDOR ? item.VENDEDOR.trim() : "NÃO INFORMADO";
    let numeroOS = String(item.OS || "").trim();

    if (!agrupadoPorLoja[idLoja]) {
      agrupadoPorLoja[idLoja] = {
        id: idLoja,
        nome: nomeLojaCompleta,
        totalValorLiquido: 0,
        totalQtd: 0,
        vendedores: {},
        osUnicasLoja: new Set()
      };
    }

    if (!agrupadoPorLoja[idLoja].vendedores[nomeVendedor]) {
      agrupadoPorLoja[idLoja].vendedores[nomeVendedor] = {
        nome: nomeVendedor,
        bruto: 0,
        desconto: 0,
        liquido: 0,
        osPorVendedor: {}
      };
    }

    let bruto = parseNumeroBR(item.VALORBRUTOPRODUTO);
    let desconto = parseNumeroBR(item.DESCPRODUTO);
    let liquido = parseNumeroBR(item.LIQUIDOPRODUTO);

    agrupadoPorLoja[idLoja].vendedores[nomeVendedor].bruto += bruto;
    agrupadoPorLoja[idLoja].vendedores[nomeVendedor].desconto += desconto;
    agrupadoPorLoja[idLoja].vendedores[nomeVendedor].liquido += liquido;

    if (numeroOS) {
      if (!agrupadoPorLoja[idLoja].vendedores[nomeVendedor].osPorVendedor[numeroOS]) {
        agrupadoPorLoja[idLoja].vendedores[nomeVendedor].osPorVendedor[numeroOS] = 0;
      }
      agrupadoPorLoja[idLoja].vendedores[nomeVendedor].osPorVendedor[numeroOS] += bruto;

      agrupadoPorLoja[idLoja].osUnicasLoja.add(numeroOS);
    }

    agrupadoPorLoja[idLoja].totalValorLiquido += liquido;
  });

  let lojasOrdenadasResumo = Object.values(agrupadoPorLoja).sort((a, b) => b.totalValorLiquido - a.totalValorLiquido);

  let htmlLojasResumo = lojasOrdenadasResumo.map(loja => {
    let idUnicoLoja = 'acordeon_loja_' + loja.id;
    
    let vendedoresProcessados = Object.values(loja.vendedores).map(v => {
      let qtdVendasVendedor = 0;
      Object.keys(v.osPorVendedor).forEach(osNum => {
        if (v.osPorVendedor[osNum] > 0) qtdVendasVendedor++;
      });
      let ticketMedioVendedor = qtdVendasVendedor > 0 ? (v.liquido / qtdVendasVendedor) : 0;
      
      return {
        ...v,
        qtdVendas: qtdVendasVendedor,
        ticketMedio: ticketMedioVendedor
      };
    });

    // Ordenando os vendedores pelo Ticket Médio do maior para o menor
    vendedoresProcessados.sort((a, b) => b.ticketMedio - a.ticketMedio);

    let totalQtdVendasLoja = loja.osUnicasLoja.size;

    let linhasVendedoresHTML = vendedoresProcessados.map(v => {
      return `
        <div style="padding: 6px 10px; border-bottom: 1px dashed #eee; font-size: 11px; background: #fff; display: grid; grid-template-columns: 2fr 0.8fr 1fr 1fr 1fr; align-items: center; text-align: right;">
          <span style="font-weight: bold; color: #555; text-align: left;">👤 ${v.nome}</span>
          <span style="color: #444; text-align: center;" title="Quantidade de Vendas">Qtd: <strong>${v.qtdVendas}</strong></span>
          <span style="color: #666;" title="Líquido">Lq: ${formatarMoedaBR(v.liquido)}</span>
          <span style="color: #d9534f;" title="Desconto">Desc: ${formatarMoedaBR(v.desconto)}</span>
          <span style="color: #0078d7; font-weight: bold;" title="Ticket Médio">TM: ${formatarMoedaBR(v.ticketMedio)}</span>
        </div>
      `;
    }).join("");

    return `
      <div style="margin-bottom: 8px; background: #fafafa; border-radius: 6px; border: 1px solid #e0e0e0; overflow: hidden;">
        
        <div onclick="toggleAcordeon('${idUnicoLoja}')" style="padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: #fdfdfd; user-select: none;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span id="seta_${idUnicoLoja}" style="font-size: 12px; font-weight: bold; transition: transform 0.2s; display: inline-block;">▶</span>
            <span style="font-size: 12px; font-weight: bold; color: #333;">🏪 ${loja.nome}</span>
          </div>
          
          <div style="display: flex; gap: 12px; align-items: center; font-size: 12px;">
            <span style="color: #555; font-size: 11px;">Qtd: <strong>${totalQtdVendasLoja}</strong></span>
            <span style="color: #0078d7; font-weight: bold;">${formatarMoedaBR(loja.totalValorLiquido)}</span>
          </div>
        </div>

        <div id="${idUnicoLoja}" style="display: none; border-top: 1px solid #eee; background: #fff;">
          <div style="padding: 4px 6px; background: #f1f3f5; font-size: 10px; font-weight: bold; color: #555; display: grid; grid-template-columns: 2fr 0.8fr 1fr 1fr 1fr; text-align: right;">
            <span style="text-align: left;">Vendedor</span>
            <span style="text-align: center;">Qtd Vendas</span>
            <span>Líquido</span>
            <span>Desconto</span>
            <span>Ticket Médio</span>
          </div>
          ${linhasVendedoresHTML}
        </div>

      </div>
    `;
  }).join("");

  const cardResumoVendedoresEl = document.getElementById("cardResumoVendedores");
  if (cardResumoVendedoresEl) {
    cardResumoVendedoresEl.innerHTML = htmlLojasResumo || '<div style="padding: 10px; text-align: center; color: #666; font-size: 12px;">Nenhum registro encontrado.</div>';
  }

  // --- POPULAR TABELA DA ABA 3 (DETALHES / AUDITORIA) ---
  const tabelaDetalhesCorpo = document.getElementById("tabelaDetalhesCorpo");
  const contadorRegistrosDetalhe = document.getElementById("contadorRegistrosDetalhe");

  if (tabelaDetalhesCorpo) {
    let htmlTabelaDetalhes = "";
    dadosFiltrados.forEach(item => {
      const lojaNome = item.LOJA || "-";
      const os = item.OS || item.CODIGODAVENDA || "-";
      const data = item.DATA || "-";
      const cliente = item.CLIENTE || "-";
      const vendedor = item.VENDEDOR || "-";
      const produtoDesc = `${item.CODIGO || ''} - ${item.DESCRICAO || item.PRODUTO || '-'}`;
      const qtd = item.QUANTIDADE || "0";
      const bruto = parseNumeroBR(item.VALORBRUTOPRODUTO);
      const desconto = parseNumeroBR(item.DESCPRODUTO);
      const liquido = parseNumeroBR(item.LIQUIDOPRODUTO);
      const tipoVenda = item.TIPOVENDA || "-";

      htmlTabelaDetalhes += `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 6px 8px; white-space: nowrap;">${lojaNome}</td>
          <td style="padding: 6px 8px; font-weight: bold; color: #0078d7;">${os}</td>
          <td style="padding: 6px 8px; white-space: nowrap;">${data}</td>
          <td style="padding: 6px 8px;">${cliente}</td>
          <td style="padding: 6px 8px;">${vendedor}</td>
          <td style="padding: 6px 8px;">${produtoDesc}</td>
          <td style="padding: 6px 8px; text-align: center;">${qtd}</td>
          <td style="padding: 6px 8px; text-align: right;">${formatarMoedaBR(bruto)}</td>
          <td style="padding: 6px 8px; text-align: right; color: #d9534f;">${formatarMoedaBR(desconto)}</td>
          <td style="padding: 6px 8px; text-align: right; font-weight: bold; color: #28a745;">${formatarMoedaBR(liquido)}</td>
          <td style="padding: 6px 8px; font-size: 11px; color: #666;">${tipoVenda}</td>
        </tr>
      `;
    });

    tabelaDetalhesCorpo.innerHTML = htmlTabelaDetalhes || "<tr><td colspan='11' style='text-align:center; padding: 20px;'>Nenhum registro encontrado.</td></tr>";
    if (contadorRegistrosDetalhe) {
      contadorRegistrosDetalhe.innerText = `Exibindo ${dadosFiltrados.length} registros`;
    }
  }

  renderizarDashboard(totaisPorLoja, totalLiquidoGeral, pagamentosFiltrados);
}

// --- FUNÇÃO PARA RENDERIZAR O DASHBOARD ---
function renderizarDashboard(totaisPorLoja, totalLiquidoGeral, pagamentosFiltrados) {
  
  const listaLojasOrdenadas = Object.keys(totaisPorLoja).map(idLoja => {
    const t = totaisPorLoja[idLoja];
    const taxaDesconto = t.bruto > 0 ? (t.desconto / t.bruto) * 100 : 0;
    const participacao = totalLiquidoGeral > 0 ? (t.liquido / totalLiquidoGeral) * 100 : 0;
    return {
      idLoja,
      bruto: t.bruto,
      desconto: t.desconto,
      liquido: t.liquido,
      taxaDesconto,
      participacao
    };
  });

  listaLojasOrdenadas.sort((a, b) => b.liquido - a.liquido);

  const canvasGrafico = document.getElementById('graficoParticipacaoLojas');
  if (canvasGrafico) {
    const cardPai = canvasGrafico.closest('.card, div');
    if (cardPai) {
      const headerEl = cardPai.querySelector('h3, h4, .titulo-secao') || cardPai.previousElementSibling;
      if (headerEl) {
        headerEl.innerHTML = `Participação do Valor Líquido por Loja (%) — <span style="color: #0078d7; font-weight: bold;">${formatarMoedaBR(totalLiquidoGeral)}</span>`;
      }
    }
  }

  const ctx = document.getElementById('graficoParticipacaoLojas');
  if (ctx) {
    const labels = listaLojasOrdenadas.map(item => `Loja ${item.idLoja}`);
    const dadosPorcentagem = listaLojasOrdenadas.map(item => item.participacao.toFixed(2));

    if (meuGraficoLojas) meuGraficoLojas.destroy();

    meuGraficoLojas = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          label: '% do Valor Líquido',
          data: dadosPorcentagem,
          backgroundColor: CORES_PALETA.slice(0, labels.length),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: {
            callbacks: {
              label: function(context) {
                const item = listaLojasOrdenadas[context.dataIndex];
                return ` ${context.label}: ${formatarMoedaBR(item.liquido)} (${context.raw}% do total)`;
              }
            }
          }
        }
      }
    });
  }

  renderizarGraficoVendaLojasGeral(totalLiquidoGeral);

  const containerPagamentosGrafico = document.getElementById('graficoParticipacaoPagamentos');
  if (containerPagamentosGrafico && Array.isArray(pagamentosFiltrados) && pagamentosFiltrados.length > 0) {
    
    const totaisPorPagamentoParcelas = {};
    let valorTotalGeralPgto = 0;

    pagamentosFiltrados.forEach(pgto => {
      const meio = (pgto.MEIO_PAGAMENTO || pgto.MEIOPAGAMENTO || "NÃO ESPECIFICADO").trim();
      const parcelas = (pgto.N_PARCELAS || "A VISTA").trim();
      const rotuloCompleto = `${meio} (${parcelas})`;
      const valor = parseNumeroBR(pgto.VENDAS_VALOR || 0);

      totaisPorPagamentoParcelas[rotuloCompleto] = (totaisPorPagamentoParcelas[rotuloCompleto] || 0) + valor;
      valorTotalGeralPgto += valor;
    });

    const listaPagamentosOrdenada = Object.keys(totaisPorPagamentoParcelas).map(rotulo => {
      const valor = totaisPorPagamentoParcelas[rotulo];
      const participacao = valorTotalGeralPgto > 0 ? (valor / valorTotalGeralPgto) * 100 : 0;
      return { rotulo, valor, participacao };
    });

    listaPagamentosOrdenada.sort((a, b) => b.valor - a.valor);

    const headerPgtoEl = document.getElementById('tituloGraficoPagamentos');
    if (headerPgtoEl) {
      headerPgtoEl.innerHTML = `Participação por Meio de Pagamento (%) — <span style="color: #0078d7; font-weight: bold;">${formatarMoedaBR(valorTotalGeralPgto)}</span>`;
    }

    const labelsPgto = listaPagamentosOrdenada.map(item => item.rotulo);
    const dadosPgtoPorcentagem = listaPagamentosOrdenada.map(item => item.participacao.toFixed(2));

    if (meuGraficoPagamentos) meuGraficoPagamentos.destroy();

    meuGraficoPagamentos = new Chart(containerPagamentosGrafico, {
      type: 'doughnut',
      data: {
        labels: labelsPgto,
        datasets: [{
          label: '% por Pagamento',
          data: dadosPgtoPorcentagem,
          backgroundColor: CORES_PALETA.slice(0, labelsPgto.length),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: {
            callbacks: {
              label: function(context) {
                const item = listaPagamentosOrdenada[context.dataIndex];
                return ` ${item.rotulo}: ${formatarMoedaBR(item.valor)} (${context.raw}% do total)`;
              }
            }
          }
        },
        onClick: (event, elements) => {
          if (elements && elements.length > 0) {
            const index = elements[0].index;
            const rotuloCompleto = labelsPgto[index];
            const partes = rotuloCompleto.match(/^(.*?)\s*\((.*?)\)$/);
            if (partes) {
              const chaveReal = `${partes[1].trim()}|${partes[2].trim()}`;
              abrirModalZoom(chaveReal);
            }
          }
        }
      }
    });
  }

  const containerRankingDescontos = document.getElementById('rankingDescontosContainer');
  if (containerRankingDescontos) {
    const listaRankingDesconto = [...listaLojasOrdenadas].sort((a, b) => a.taxaDesconto - b.taxaDesconto);

    let htmlRankingDesc = "";
    listaRankingDesconto.forEach((item, index) => {
      let iconePosicao = "";
      let corBadge = "#666";
      
      if (index === 0) { iconePosicao = "🏆 "; corBadge = "#d4af37"; } 
      else if (index === 1) { iconePosicao = "🥈 "; corBadge = "#aaa"; }
      else if (index === 2) { iconePosicao = "🥉 "; corBadge = "#cd7f32"; }

      let posicaoNumero = `#${index + 1}`;

      htmlRankingDesc += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; margin-bottom: 6px; background: #fff; border: 1px solid #e0e0e0; border-radius: 6px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-weight: bold; color: ${index < 3 ? corBadge : '#333'}; font-size: 13px; min-width: 35px;">${posicaoNumero}</span>
            <div>
              <strong style="color: ${corBadge};">${iconePosicao}Loja ${item.idLoja}</strong>
              <div style="font-size: 11px; color: #666;">Desc: ${formatarMoedaBR(item.desconto)} / Bruto: ${formatarMoedaBR(item.bruto)}</div>
            </div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 14px; font-weight: bold; color: #28a745;">${item.taxaDesconto.toFixed(2)}%</span>
            <div style="font-size: 10px; color: #888;">Taxa Média</div>
          </div>
        </div>
      `;
    });

    containerRankingDescontos.innerHTML = htmlRankingDesc || "Nenhum dado para o ranking.";
  }
}

function renderizarGraficoVendaLojasGeral(totalLiquidoGeral = 0) {
  const ctx = document.getElementById('graficoVendaLojaVendedor');
  const tituloEl = document.getElementById('tituloGraficoLojaVendedor');
  const btnVoltar = document.getElementById('btnVoltarGraficoLoja');
  
  if (!ctx) return;

  if (tituloEl) {
    tituloEl.innerHTML = `Vendas Loja por Vendedor (Valor Líquido) — <span style="color: #0078d7; font-weight: bold;">${formatarMoedaBR(totalLiquidoGeral)}</span>`;
  }
  
  if (btnVoltar) btnVoltar.style.display = "none";

  const totaisLojas = {};
  dadosBrutosGlobaisParaGrafico.forEach(item => {
    let textoLoja = String(item.LOJANOME ?? item.CODIGOLOJA ?? item.LOJA ?? "Geral").trim();
    let matchLoja = textoLoja.match(/^0*(\d+)/);
    let idLoja = matchLoja ? matchLoja[1] : textoLoja;
    let liquido = parseNumeroBR(item.LIQUIDOPRODUTO);

    totaisLojas[idLoja] = (totaisLojas[idLoja] || 0) + liquido;
  });

  const lojasOrdenadas = Object.keys(totaisLojas).map(id => ({ id, valor: totaisLojas[id] }));
  lojasOrdenadas.sort((a, b) => b.valor - a.valor);

  const labels = lojasOrdenadas.map(l => `Loja ${l.id}`);
  const valores = lojasOrdenadas.map(l => l.valor);
  const idsOriginais = lojasOrdenadas.map(l => l.id);

  if (meuGraficoLojaVendedor) meuGraficoLojaVendedor.destroy();

  meuGraficoLojaVendedor = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        label: 'Valor Líquido (R$)',
        data: valores,
        backgroundColor: CORES_PALETA.slice(0, labels.length),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: function(context) { return ` Líquido: ${formatarMoedaBR(context.raw)}`; }
          }
        }
      },
      onClick: (event, elements) => {
        if (elements && elements.length > 0) {
          const index = elements[0].index;
          const idLojaSelecionada = idsOriginais[index];
          abrirModalZoomLojaUnica(idLojaSelecionada);
        }
      }
    }
  });
}
