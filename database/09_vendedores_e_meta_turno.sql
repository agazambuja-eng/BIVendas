-- =====================================================================
-- BIVendas - Cadastro de VENDEDORES e meta de vendedor por TURNO
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro.
--
-- 1) Tabela public.vendedores
--      codigo       integer  -> código do vendedor no ERP (ex.: 1807)
--      nome         text     -> nome do vendedor
--      loja_codigo  integer  -> loja onde trabalha (ex.: 519)
--      turno        'M'/'T'  -> M = manhã, T = tarde (padrão T)
--      ativo        boolean
--
-- 2) metas_loja ganha a meta do vendedor da MANHÃ (Bronze, Prata, Ouro).
--    As colunas que já existem (valor_meta_bronze/prata/ouro) passam a ser
--    a meta da TARDE e continuam valendo para lojas sem turno.
--    Se a meta da manhã ficar vazia, o vendedor da manhã usa a da tarde.
--
-- 3) Quem pode mexer no cadastro de vendedores: as mesmas permissões das
--    metas (incluir / alterar / excluir), só nas lojas liberadas ao usuário.
-- =====================================================================

-- 1. Tabela de vendedores -----------------------------------------------
create table if not exists public.vendedores (
  id            bigint generated always as identity primary key,
  codigo        integer not null,
  nome          text    not null,
  loja_codigo   integer not null,
  turno         char(1) not null default 'T',
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.vendedores drop constraint if exists vendedores_codigo_unico;
alter table public.vendedores add constraint vendedores_codigo_unico unique (codigo);
alter table public.vendedores drop constraint if exists vendedores_turno_valido;
alter table public.vendedores add constraint vendedores_turno_valido check (turno in ('M', 'T'));
alter table public.vendedores drop constraint if exists vendedores_codigo_valido;
alter table public.vendedores add constraint vendedores_codigo_valido check (codigo > 0);

create index if not exists vendedores_loja_idx on public.vendedores (loja_codigo);

-- atualizado_em automático
create or replace function public.vendedores_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists vendedores_atualizado_em on public.vendedores;
create trigger vendedores_atualizado_em before update on public.vendedores
  for each row execute function public.vendedores_atualizado_em();

-- 2. Segurança (RLS) -------------------------------------------------------
alter table public.vendedores enable row level security;

drop policy if exists "ver vendedores"     on public.vendedores;
drop policy if exists "incluir vendedores" on public.vendedores;
drop policy if exists "alterar vendedores" on public.vendedores;
drop policy if exists "excluir vendedores" on public.vendedores;

create policy "ver vendedores" on public.vendedores
  for select to authenticated
  using (public.pode_ver_loja(loja_codigo));
create policy "incluir vendedores" on public.vendedores
  for insert to authenticated
  with check (public.tem_permissao('criar_metas') and public.pode_ver_loja(loja_codigo));
create policy "alterar vendedores" on public.vendedores
  for update to authenticated
  using (public.tem_permissao('alterar_metas') and public.pode_ver_loja(loja_codigo))
  with check (public.tem_permissao('alterar_metas') and public.pode_ver_loja(loja_codigo));
create policy "excluir vendedores" on public.vendedores
  for delete to authenticated
  using (public.tem_permissao('excluir_metas') and public.pode_ver_loja(loja_codigo));

grant select, insert, update, delete on public.vendedores to authenticated;

-- 3. Meta do vendedor da MANHÃ em metas_loja -----------------------------
alter table public.metas_loja add column if not exists valor_meta_manha_bronze numeric(14,2);
alter table public.metas_loja add column if not exists valor_meta_manha_prata  numeric(14,2);
alter table public.metas_loja add column if not exists valor_meta_manha_ouro   numeric(14,2);

comment on column public.metas_loja.valor_meta_bronze       is 'Meta vendedor TARDE (ou única) - Bronze';
comment on column public.metas_loja.valor_meta_prata        is 'Meta vendedor TARDE (ou única) - Prata';
comment on column public.metas_loja.valor_meta_ouro         is 'Meta vendedor TARDE (ou única) - Ouro';
comment on column public.metas_loja.valor_meta_manha_bronze is 'Meta vendedor MANHÃ - Bronze (vazio = usa a da tarde)';
comment on column public.metas_loja.valor_meta_manha_prata  is 'Meta vendedor MANHÃ - Prata (vazio = usa a da tarde)';
comment on column public.metas_loja.valor_meta_manha_ouro   is 'Meta vendedor MANHÃ - Ouro (vazio = usa a da tarde)';

-- 4. Conferência ---------------------------------------------------------------
select 'vendedores' as tabela, count(*) as registros from public.vendedores
union all
select 'metas_loja', count(*) from public.metas_loja;
