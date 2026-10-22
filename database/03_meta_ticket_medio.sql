-- =====================================================================
-- BIVendas - Meta de ticket médio por loja
-- Como usar: Supabase > SQL Editor > New query > colar > Run
-- =====================================================================

alter table public.metas_loja
  add column if not exists valor_meta_ticket numeric;

-- Exemplo: meta de ticket R$ 1.500,00 para todas as lojas de outubro/2026
-- update public.metas_loja set valor_meta_ticket = 1500 where competencia = 202610;
