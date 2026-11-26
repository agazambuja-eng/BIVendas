/**
 * Configurações › 🎯 Metas: página própria com o mesmo cadastro do ⚙ do BI (config-metas.js).
 * Aqui ficam só as funções que no BI vêm de main.js e metas.js.
 */
const metasClient = supabaseBI;
var lojasDisponiveis = [];
async function carregarLojasSupabase() {
  try { lojasDisponiveis = await buscarLojasSupabase(); } catch (e) { lojasDisponiveis = []; }
}
function escaparHTML(t) { return escHTML(t); }
function formatarMoedaBR(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatarDataISOparaBR(d) { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }
function fecharConfigMetas() { location.href = '/configuracoes.html'; }
