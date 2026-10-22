-- =====================================================================
-- BIVendas - Meta por vendedor + permissão de edição pela tela ⚙
-- Como usar: Supabase > SQL Editor > New query > colar > Run
-- Pode rodar mais de uma vez sem erro.
-- =====================================================================

-- 1. Coluna da meta individual (já criada pelo Table Editor; garante que exista)
alter table public.metas_loja
  add column if not exists valor_meta_vendedor numeric;

-- 2. Leitura continua pública (o BI lê com a chave publishable)
alter table public.metas_loja enable row level security;

drop policy if exists "leitura publica" on public.metas_loja;
create policy "leitura publica" on public.metas_loja
  for select using (true);

-- 3. Incluir / alterar / excluir: somente usuário logado
drop policy if exists "incluir autenticado" on public.metas_loja;
create policy "incluir autenticado" on public.metas_loja
  for insert to authenticated with check (true);

drop policy if exists "alterar autenticado" on public.metas_loja;
create policy "alterar autenticado" on public.metas_loja
  for update to authenticated using (true) with check (true);

drop policy if exists "excluir autenticado" on public.metas_loja;
create policy "excluir autenticado" on public.metas_loja
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------
-- IMPORTANTE (fazer no painel, não é SQL):
--  a) Authentication > Users > Add user > Create new user
--     (e-mail + senha, marcar "Auto Confirm User")
--  b) Authentication > Sign In / Providers > desligar
--     "Allow new users to sign up"
--     -> sem isso, qualquer pessoa com a chave publishable poderia criar
--        uma conta e alterar as metas.
-- ---------------------------------------------------------------------
