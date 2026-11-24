const express = require("express");
const cors = require("cors");
const path = require("path");
const { exigirUsuario, restringirLojas, exigirAba, registrarRotasUsuarios, chamarSupabaseAdmin, cachePerfis } = require("./acesso-servidor");
const { registrarRotaEstoque } = require("./estoque-servidor");
const { registrarRotasPainelSavwin } = require("./savwin-painel");
const { registrarRotaPrecos } = require("./precos-web");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());

// Servir arquivos estáticos da pasta public (sem abrir o BI direto em "/")
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Endereço principal abre a tela de login
app.get("/", (req, res) => {
  res.redirect("/login.html");
});

// Criar usuário / redefinir senha (precisa de SUPABASE_SECRET_KEY no Render)
registrarRotasUsuarios(app);

// 1. Rota Principal da Grid (ProdutosPorOSGRID)
// Com DEVOLUCOES: true, junta as devoluções do período (linhas negativas de tipo DEVOLUCAO, que a
// GRID não traz) no mesmo formato da GRID. Assim o líquido do BI bate com o "Líquido Produto" do
// relatório de vendas do SavWin. Trocas NÃO entram aqui: o crédito delas já vem como desconto na OS da troca.
const HEADERS_API_CR = {
  "Content-Type": "application/json",
  "Authorization": "Bearer 4AE83C98E8315579579F297C8F8BDE2C6ACF269E57D85DD37EF2647DCA77733",
  "Identificador": "09983-0000"
};
async function postarApiCR(rota, body, nome) {
  const response = await fetch(`https://api.savwinweb.com.br/api/APIRelatoriosCR/${rota}`, { method: "POST", headers: HEADERS_API_CR, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Erro na API externa (${nome}): Status ${response.status}`);
  return response.json();
}
const numeroApi = v => { const t = String(v ?? "").trim(); if (!t) return 0; const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); return isFinite(n) ? n : 0; };

/** Linha de devolução (ProdutosPorOS) -> mesmo formato das linhas da GRID. */
function devolucaoNoFormatoGrid(d, grifePorCodigo) {
  const cod = String(d.CODIGOPRODUTO ?? "").trim();
  const g = grifePorCodigo.get(cod) || {};
  return {
    LOJA: d.LOJANOME || "", OS: String(d.CODIGODAVENDA ?? ""), CODIGODAVENDA: String(d.CODIGODAVENDA ?? ""),
    DATA: String(d.DATAVENDA || "").slice(0, 10), HORA: d.HORAVENDA || "",
    CODCLIENTE: d.CLISEQUENCIAL || "", CODIGOCLIENTE: d.CLISEQUENCIAL || "", CLIENTE: d.CLIENTE || "", CPFCNPJ: d.CPFCLIENTE || "",
    PAGADOR: d.CLIENTEPAGADOR || "", VENDEDOR: d.VENDEDOR || "", VENDEDOR2: d.VENDEDOR2 || "", VENDEDOR3: d.VENDEDOR3 || "",
    CODIGO: cod, PRODUTO: d.FANTASIAPRODUTO || "", DESCRICAO: d.DESCRICAOPRODUTO || "",
    GRIFE: g.GRIFE ?? d.GRIFE ?? "", LINHA: g.LINHA ?? d.LINHADEPRODUTO ?? "", FABRICANTELENTES: g.FABRICANTELENTES ?? d.FABRICANTEPRODUTO ?? "",
    QUANTIDADE: d.QUANTIDADETOTAL ?? "0", VALORBRUTOPRODUTO: d.VALORBRUTO ?? "0", DESCPRODUTO: d.DESCONTOVALORPRODUTO ?? "0",
    LIQUIDOPRODUTO: d.PRECOTOTALPRODUTO ?? "0", CUSTO: d.CUSTOPRODUTOS ?? "0", VLRLIQUIDOVENDA: d.VALORLIQUIDOTOTALVENDA ?? "0",
    MEDICO: d.MEDICO || "", TIPOVENDA: "DEVOLUCAO", INDICACAO: d.TIPOINDICACAO || "",
    NCM: d.NCMCODIGO || "", NCMDESCRICAO: d.NCMDESCRICAO || "", UPC: d.UPCPRODUTO || "", USUARIO: d.USUARIO || "",
    STATUSCUPOM: d.STATUSCUPOMFISCAL || "", TAXAADM: d.TAXAADM ?? "0", EHDEVOLUCAO: "DEV", ORIGEMLINHA: "DEVOLUCAO"
  };
}

app.post("/consulta", exigirUsuario("acessar_bi"), restringirLojas, async (req, res) => {
  const body = {
    DATAINICIAL: req.body.DATAINICIAL || "",
    DATAFINAL: req.body.DATAFINAL || "",
    LOJAS: req.body.LOJAS || "",
    TIPODATA: req.body.TIPODATA || "VENDA",
    TIPOVENDA: req.body.TIPOVENDA || ""
  };
  const comDevolucoes = req.body.DEVOLUCOES === true;

  try {
    const [data, devol] = await Promise.all([
      postarApiCR("ProdutosPorOSGRID", body, "Grid"),
      comDevolucoes
        ? postarApiCR("ProdutosPorOS", { ...body, TIPOVENDA: "DEVOLUCAO" }, "Devoluções").catch(e => ({ erro: e.message }))
        : null
    ]);
    if (!comDevolucoes || !Array.isArray(data)) return res.json(data);

    if (devol && devol.erro) {
      console.error("Devoluções não carregadas (/consulta):", devol.erro);
      res.set("X-Devolucoes", "erro");
      return res.json(data);
    }
    // a API ignora o filtro de tipo: separa só as devoluções (valor ou quantidade negativos)
    const ehDev = d => String(d.TIPOVENDA || "").trim().toUpperCase() === "DEVOLUCAO";
    const jaTem = data.some(i => String(i.TIPOVENDA || "").trim().toUpperCase() === "DEVOLUCAO");
    const linhas = jaTem ? [] : (Array.isArray(devol) ? devol : []).filter(d => ehDev(d) && (numeroApi(d.PRECOTOTALPRODUTO) < 0 || numeroApi(d.QUANTIDADETOTAL) < 0));
    // grife/linha como na GRID (pelo código do produto vendido), para somar no mesmo grupo
    const grifePorCodigo = new Map();
    data.forEach(i => { const c = String(i.CODIGO ?? "").trim(); if (c && !grifePorCodigo.has(c)) grifePorCodigo.set(c, { GRIFE: i.GRIFE, LINHA: i.LINHA, FABRICANTELENTES: i.FABRICANTELENTES }); });
    res.set("X-Devolucoes", String(linhas.length));
    res.json(linhas.length ? data.concat(linhas.map(d => devolucaoNoFormatoGrid(d, grifePorCodigo))) : data);
  } catch (error) {
    console.error("Erro no servidor (/consulta):", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 2. Rota Dedicada para Devoluções (ProdutosPorOS com TIPOVENDA = DEVOLUCAO)
app.post("/consultadevolucoes", exigirUsuario("acessar_bi"), restringirLojas, async (req, res) => {
  const body = {
    DATAINICIAL: req.body.DATAINICIAL || "",
    DATAFINAL: req.body.DATAFINAL || "",
    LOJAS: req.body.LOJAS || "",
    TIPODATA: req.body.TIPODATA || "VENDA",
    TIPOVENDA: "DEVOLUCAO"
  };

  try {
    const response = await fetch("https://api.savwinweb.com.br/api/APIRelatoriosCR/ProdutosPorOS", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer 4AE83C98E8315579579F297C8F8BDE2C6ACF269E57D85DD37EF2647DCA77733",
        "Identificador": "09983-0000"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Erro na API externa (Devoluções): Status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Erro no servidor (/consultadevolucoes):", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3. Rota Dedicada para Resumo de Formas de Pagamento e Parcelas (APIVendaResumoTodasFormasPagamento)
app.post("/consultapagamentos", exigirUsuario("acessar_bi"), restringirLojas, async (req, res) => {
  // Mapeia os dados recebidos do front-end para o contrato exato que a API externa exige
  const body = {
    DATAVENDAINICIO: req.body.DATAINICIAL || "",
    DATAVENDAFIM: req.body.DATAFINAL || "",
    AGRUPAFORMAPAGAMENTO: "N",
    LOJA: req.body.LOJAS || ""
  };

  try {
    const response = await fetch("https://api.savwinweb.com.br/api/APIRelatoriosCR/APIVendaResumoTodasFormasPagamento", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer 4AE83C98E8315579579F297C8F8BDE2C6ACF269E57D85DD37EF2647DCA77733",
        "Identificador": "09983-0000"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro na API externa (Pagamentos): Status ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Erro no servidor (/consultapagamentos):", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Autenticação SavWin usada pela rota de estoque (mesma das rotas acima)
const HEADERS_SAVWIN = {
  "Authorization": "Bearer 4AE83C98E8315579579F297C8F8BDE2C6ACF269E57D85DD37EF2647DCA77733",
  "Identificador": "09983-0000"
};

// Planos de contas liberados por usuário (configuracoes_bi, chave cmv_planos_por_usuario); 60 s em memória
let cachePlanosUsuario = { quando: 0, valor: null };
async function planosDoUsuario(perfil) {
  if (!perfil || !perfil.id) return null;
  if (Date.now() - cachePlanosUsuario.quando > 60 * 1000) {
    try {
      const r = await chamarSupabaseAdmin('/rest/v1/configuracoes_bi?chave=eq.cmv_planos_por_usuario&select=valor', { method: 'GET' });
      cachePlanosUsuario = { quando: Date.now(), valor: (Array.isArray(r) && r[0] && r[0].valor) || {} };
    } catch (e) {
      cachePlanosUsuario = { quando: Date.now(), valor: {} };   // tabela ainda não criada: sem restrição
    }
  }
  const lista = cachePlanosUsuario.valor[perfil.id];
  return Array.isArray(lista) && lista.length ? lista : null;
}

// 3b. Contas a pagar (ContasPagarPagasGrid) · aba CMV
// FILID = lojas do usuário (códigos, como nas outras rotas); vencimento de/até (dd/mm/aaaa).
const dataParaBR = v => {
  const t = String(v || '').trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return /^\d{2}\/\d{2}\/\d{4}$/.test(t) ? t : null;
};
app.post("/consulta-contas-pagar", exigirUsuario("acessar_bi"), exigirAba("cmv"), restringirLojas, async (req, res) => {
  const venc1 = dataParaBR(req.body.VENCIMENTO1), venc2 = dataParaBR(req.body.VENCIMENTO2);
  if (!venc1 || !venc2) return res.status(400).json({ error: "Informe o período de vencimento." });
  const body = {
    FILID: String(req.body.LOJAS || "").split(/[,;\s]+/).map(c => c.replace(/\D/g, "").replace(/^0+/, "")).filter(Boolean).join(","),
    STATUSRECEBIDO: "TODOS",
    DUPEMISSAO1: null, DUPEMISSAO2: null,
    PARVENCIMENTO1: venc1, PARVENCIMENTO2: venc2,
    RECRECEBIMENTO1: null, RECRECEBIMENTO2: null,
    PAGAMENTOVENDA1: null, PAGAMENTOVENDA2: null,
    TIPOPERIODO: "1"
  };
  try {
    const response = await fetch("https://api.savwinweb.com.br/api/APIRelatoriosCR/ContasPagarPagasGrid", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...HEADERS_SAVWIN },
      body: JSON.stringify(body)
    });
    const texto = await response.text();
    if (!response.ok) throw new Error(`Erro na API externa (Contas a pagar): Status ${response.status} ${texto.slice(0, 200)}`);
    let dados;
    try { dados = JSON.parse(texto); } catch { throw new Error(`Resposta inesperada da API: ${texto.slice(0, 150)}`); }
    if (typeof dados === "string") { try { dados = JSON.parse(dados); } catch { dados = []; } }
    let linhas = Array.isArray(dados) ? dados : (dados && (dados.Resultado || dados.resultado || dados.Dados || dados.data)) || [];
    if (!Array.isArray(linhas)) linhas = [];
    // planos de contas liberados para o usuário (Configuração do BI › Planos por usuário); vazio = todos
    const liberados = await planosDoUsuario(req.usuario);
    let ocultas = 0;
    if (liberados && linhas.length) {
      const campo = Object.keys(linhas[0]).find(k => /^PLANOCONTAS$/i.test(k)) || Object.keys(linhas[0]).find(k => /PLANO/i.test(k));
      if (campo) {
        const ok = new Set(liberados.map(p => String(p).trim().toUpperCase()));
        const antes = linhas.length;
        linhas = linhas.filter(l => ok.has(String(l[campo] ?? '').trim().toUpperCase()));
        ocultas = antes - linhas.length;
      }
    }
    res.json({ filtro: { ...body }, linhas, planosRestritos: !!liberados, ocultas });
  } catch (error) {
    console.error("Erro no servidor (/consulta-contas-pagar):", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 4. Estoque (EstoqueAnaliticoGrid) · módulo Estoque encalhado
registrarRotaEstoque(app, { exigirUsuario, restringirLojas, headersSavwin: HEADERS_SAVWIN });

// 5. Estoque pelo painel do SavWin (acesso de cada usuário: identificadorsav/loginsav/senhasav)
registrarRotasPainelSavwin(app, { exigirUsuario, restringirLojas, exigirAba, chamarSupabaseAdmin, cachePerfis });

// 6. Preço da mesma peça na web com IA (Gemini + pesquisa Google; variável GEMINI_API_KEY)
registrarRotaPrecos(app, { exigirUsuario, exigirAba, chamarSupabaseAdmin });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
