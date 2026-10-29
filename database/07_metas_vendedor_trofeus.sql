-- =====================================================================
-- BIVendas - Metas do vendedor em 3 faixas (troféus) e fim da meta de ticket
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro.
--
--   🥉 valor_meta_bronze  (a antiga valor_meta_vendedor vira a Bronze)
--   🥈 valor_meta_prata
--   🥇 valor_meta_ouro
--   valor_meta_ticket     -> removida
-- =====================================================================

-- 1. A meta individual antiga passa a ser a meta Bronze (mantém os valores)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'metas_loja'
               and column_name = 'valor_meta_vendedor')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'metas_loja'
               and column_name = 'valor_meta_bronze') then
    alter table public.metas_loja rename column valor_meta_vendedor to valor_meta_bronze;
  end if;
end $$;

-- 2. Colunas das três faixas
alter table public.metas_loja add column if not exists valor_meta_bronze numeric(14,2);
alter table public.metas_loja add column if not exists valor_meta_prata  numeric(14,2);
alter table public.metas_loja add column if not exists valor_meta_ouro   numeric(14,2);

-- 3. Regras: sem valores negativos e faixas crescentes (Bronze < Prata < Ouro)
alter table public.metas_loja drop constraint if exists metas_loja_trofeus_validos;
alter table public.metas_loja add constraint metas_loja_trofeus_validos check (
  coalesce(valor_meta_bronze, 0) >= 0 and coalesce(valor_meta_prata, 0) >= 0 and coalesce(valor_meta_ouro, 0) >= 0
  and (valor_meta_bronze is null or valor_meta_prata is null or valor_meta_prata > valor_meta_bronze)
  and (valor_meta_prata  is null or valor_meta_ouro  is null or valor_meta_ouro  > valor_meta_prata)
  and (valor_meta_bronze is null or valor_meta_ouro  is null or valor_meta_ouro  > valor_meta_bronze)
);

-- 4. Meta de ticket médio não é mais usada
alter table public.metas_loja drop column if exists valor_meta_ticket;

-- Conferência
select codigo, descricao, competencia, valor_meta,
       valor_meta_bronze, valor_meta_prata, valor_meta_ouro
from public.metas_loja
order by competencia desc, codigo;
