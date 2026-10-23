/**
 * Conexão única com o Supabase do BIVendas (projeto uumttubexjtgzeualqnz).
 * Usada por lojas-modal.js, main.js, metas.js e config-metas.js.
 * A chave publishable pode ficar no navegador; o que cada tabela permite
 * é controlado pelas políticas RLS no Supabase.
 */
const BI_SUPABASE_URL = 'https://uumttubexjtgzeualqnz.supabase.co';
const BI_SUPABASE_KEY = 'sb_publishable_o177jMO-LmlRF6sY-cx4tA_fv5KIEKa';

const supabaseBI = supabase.createClient(BI_SUPABASE_URL, BI_SUPABASE_KEY);

/**
 * Lojas para o modal "Selecionar Lojas".
 * Tabela public.lojas: id (interno), codigo (código da loja no ERP), nome, gerente.
 * Devolve { id: codigo, nome, gerente } — o modal usa "id" como o código
 * que vai para o filtro de lojas (ex.: 520,521).
 */
async function buscarLojasSupabase() {
  const { data, error } = await supabaseBI
    .from('lojas')
    .select('id:codigo, nome, gerente')
    .not('codigo', 'is', null)
    .order('codigo', { ascending: true });
  if (error) throw error;
  // Só lojas com código numérico; "id" passa a ser o número puro (ex.: 520)
  return (data || [])
    .map(l => ({ ...l, id: somenteNumerosLoja(l.id) }))
    .filter(l => l.id);
}

/** "0520" -> "520" ; "520 FAROL" -> "520" ; "abc" -> "" */
function somenteNumerosLoja(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos ? String(parseInt(digitos, 10)) : '';
}

/** "520, 521 ,abc,0538" -> "520,521,538" (formato que a API Savwin aceita) */
function normalizarListaLojas(texto) {
  const vistos = new Set();
  return String(texto ?? '')
    .split(/[,;\s]+/)
    .map(somenteNumerosLoja)
    .filter(n => n && !vistos.has(n) && vistos.add(n))
    .join(',');
}
