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
    .order('codigo', { ascending: true });
  if (error) throw error;
  return data || [];
}
