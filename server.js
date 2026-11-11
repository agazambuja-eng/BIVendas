const express = require("express");
const cors = require("cors");
const path = require("path");
const { exigirUsuario, restringirLojas, registrarRotasUsuarios } = require("./acesso-servidor");

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

// A Savwin responde erro 500 quando a data final está no futuro (ex.: período
// comercial 26/10 a 25/11 consultado em 30/10). Limita a data final a hoje.
function hojeBR() {
  const [d, m, a] = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }).split("/");
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${a}`;
}
function chaveData(br) { const [d, m, a] = String(br).split("/"); return `${a}${m}${d}`; }
function limitarDataFinal(br) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(br || ""))) return br || "";
  const hoje = hojeBR();
  return chaveData(br) > chaveData(hoje) ? hoje : br;
}
function periodoNoFuturo(ini) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(ini || "")) && chaveData(ini) > chaveData(hojeBR());
}

// 1. Rota Principal da Grid (ProdutosPorOSGRID)
app.post("/consulta", exigirUsuario("acessar_bi"), restringirLojas, async (req, res) => {
  const body = {
    DATAINICIAL: req.body.DATAINICIAL || "",
    DATAFINAL: limitarDataFinal(req.body.DATAFINAL),
    LOJAS: req.body.LOJAS || "",
    TIPODATA: req.body.TIPODATA || "VENDA",
    TIPOVENDA: req.body.TIPOVENDA || ""
  };

  if (periodoNoFuturo(req.body.DATAINICIAL)) return res.json([]);

  try {
    const response = await fetch("https://api.savwinweb.com.br/api/APIRelatoriosCR/ProdutosPorOSGRID", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer 4AE83C98E8315579579F297C8F8BDE2C6ACF269E57D85DD37EF2647DCA77733",
        "Identificador": "09983-0000"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Erro na API externa (Grid): Status ${response.status}${errorText ? " - " + errorText.slice(0, 300) : ""}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Erro no servidor (/consulta):", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 2. Rota Dedicada para Devoluções (ProdutosPorOS com TIPOVENDA = DEVOLUCAO)
app.post("/consultadevolucoes", exigirUsuario("acessar_bi"), restringirLojas, async (req, res) => {
  const body = {
    DATAINICIAL: req.body.DATAINICIAL || "",
    DATAFINAL: limitarDataFinal(req.body.DATAFINAL),
    LOJAS: req.body.LOJAS || "",
    TIPODATA: req.body.TIPODATA || "VENDA",
    TIPOVENDA: "DEVOLUCAO"
  };

  if (periodoNoFuturo(req.body.DATAINICIAL)) return res.json([]);

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
      const errorText = await response.text().catch(() => "");
      throw new Error(`Erro na API externa (Devoluções): Status ${response.status}${errorText ? " - " + errorText.slice(0, 300) : ""}`);
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
    DATAVENDAFIM: limitarDataFinal(req.body.DATAFINAL),
    AGRUPAFORMAPAGAMENTO: "N",
    LOJA: req.body.LOJAS || ""
  };

  if (periodoNoFuturo(req.body.DATAINICIAL)) return res.json([]);

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
