const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1. Rota Principal da Grid (ProdutosPorOSGRID)
app.post("/consulta", async (req, res) => {
  const body = {
    DATAINICIAL: req.body.DATAINICIAL || "",
    DATAFINAL: req.body.DATAFINAL || "",
    LOJAS: req.body.LOJAS || "",
    TIPODATA: req.body.TIPODATA || "VENDA",
    TIPOVENDA: req.body.TIPOVENDA || ""
  };

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
      throw new Error(`Erro na API externa (Grid): Status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Erro no servidor (/consulta):", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 2. Rota Dedicada para Devoluções (ProdutosPorOS com TIPOVENDA = DEVOLUCAO)
app.post("/consultadevolucoes", async (req, res) => {
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
app.post("/consultapagamentos", async (req, res) => {
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
