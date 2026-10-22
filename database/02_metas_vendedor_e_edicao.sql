-- =====================================================================
-- BIVendas - Meta por vendedor + permissão de edição pela tela ⚙
-- Como usar: Supabase > SQL Editor > New query > colar > Run
-- Pode rodar mais de uma vez sem erro.
-- =====================================================================

-- 1. Coluna da meta individual (já criada pelo Table Editor; garante que exista)
alter table public.metas_loja
  add column if not exists valor_meta_vendedor numeric;

alter table public.metas_loja enable row level security;

-- Limpa políticas anteriores (para poder rodar de novo)
drop policy if exists "leitura publica"     on public.metas_loja;
drop policy if exists "incluir publico"     on public.metas_loja;
drop policy if exists "alterar publico"     on public.metas_loja;
drop policy if exists "excluir publico"     on public.metas_loja;
drop policy if exists "incluir autenticado" on public.metas_loja;
drop policy if exists "alterar autenticado" on public.metas_loja;
drop policy if exists "excluir autenticado" on public.metas_loja;

-- 2. Leitura pública (o BI lê com a chave publishable)
create policy "leitura publica" on public.metas_loja
  for select using (true);

-- 3. TEMPORÁRIO - SEM LOGIN: incluir / alterar / excluir liberados
--    Atenção: qualquer pessoa com a chave publishable (visível no site)
--    pode alterar as metas. Trocar pelo bloco "COM LOGIN" quando o
--    cadastro de usuários estiver pronto.
create policy "incluir publico" on public.metas_loja
  for insert with check (true);
create policy "alterar publico" on public.metas_loja
  for update using (true) with check (true);
create policy "excluir publico" on public.metas_loja
  for delete using (true);


-- ---------------------------------------------------------------------
-- COM LOGIN (usar depois; apagar as 3 políticas "publico" acima):
--
-- create policy "incluir autenticado" on public.metas_loja
--   for insert to authenticated with check (true);
-- create policy "alterar autenticado" on public.metas_loja
--   for update to authenticated using (true) with check (true);
-- create policy "excluir autenticado" on public.metas_loja
--   for delete to authenticated using (true);
--
-- E no painel: Authentication > Sign In / Providers > desligar
-- "Allow new users to sign up".
-- ---------------------------------------------------------------------
