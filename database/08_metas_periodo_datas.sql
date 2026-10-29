-- =====================================================================
-- BIVendas - Meta por PERÍODO (data inicial e data final)
-- Mês comercial da rede: 26 do mês anterior a 25 do mês atual.
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro.
--
--   data_inicio  date  -> ex.: 2026-09-26
--   data_fim     date  -> ex.: 2026-10-25
--   competencia  int   -> calculada sozinha pela data_fim (AAAAMM, ex.: 202610)
--                         serve só como "nome do mês" da meta
-- =====================================================================

-- 1. Colunas novas
alter table public.metas_loja add column if not exists data_inicio date;
alter table public.metas_loja add column if not exists data_fim    date;

-- 2. Metas já cadastradas: competência 202610 -> 26/09/2026 a 25/10/2026
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'metas_loja'
               and column_name = 'competencia' and is_generated = 'NEVER') then
    update public.metas_loja
       set data_inicio = (make_date(competencia / 100, competencia % 100, 26) - interval '1 month')::date,
           data_fim    =  make_date(competencia / 100, competencia % 100, 25)
     where data_inicio is null or data_fim is null;
  end if;
end $$;

alter table public.metas_loja alter column data_inicio set not null;
alter table public.metas_loja alter column data_fim    set not null;

alter table public.metas_loja drop constraint if exists metas_loja_periodo_valido;
alter table public.metas_loja add constraint metas_loja_periodo_valido check (data_fim >= data_inicio);

-- 3. "competencia" passa a ser calculada pela data final (não se digita mais)
alter table public.metas_loja drop constraint if exists metas_loja_loja_mes_unico;
alter table public.metas_loja drop constraint if exists metas_loja_competencia_valida;
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'metas_loja'
                   and column_name = 'competencia' and is_generated = 'ALWAYS') then
    alter table public.metas_loja drop column if exists competencia;
    alter table public.metas_loja add column competencia integer
      generated always as ((extract(year from data_fim) * 100 + extract(month from data_fim))::integer) stored;
  end if;
end $$;

-- 4. A mesma loja não pode ter duas metas com períodos que se cruzam
create extension if not exists btree_gist;
alter table public.metas_loja drop constraint if exists metas_loja_sem_sobreposicao;
alter table public.metas_loja add constraint metas_loja_sem_sobreposicao
  exclude using gist (codigo with =, daterange(data_inicio, data_fim, '[]') with &&);

create index if not exists metas_loja_periodo_idx on public.metas_loja (data_inicio, data_fim);

-- 5. Conferência (confira também se Bronze < Prata < Ouro estão nas colunas certas)
select * from public.metas_loja order by data_inicio desc, codigo;
