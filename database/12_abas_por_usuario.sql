-- =====================================================================
-- BIVendas - Abas do BI por usuário
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro.
--
-- abas_bloqueadas: lista das abas do BI que o usuário NÃO vê.
-- Vazio (padrão) = vê todas as abas, inclusive as que forem criadas no futuro.
-- Chaves: dashboard, metas, cards, produtos, comparativo, comissao, detalhes
-- =====================================================================

alter table public.usuarios
  add column if not exists abas_bloqueadas text[] not null default '{}';

comment on column public.usuarios.abas_bloqueadas is
  'Abas do BI que o usuário não pode acessar (vazio = todas liberadas).';
