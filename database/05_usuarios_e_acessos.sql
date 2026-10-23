-- =====================================================================
-- BIVendas - Usuários e controle de acesso
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro.
--
-- Como funciona:
--  * O login e a senha ficam no Supabase Auth (senha criptografada pelo
--    próprio Supabase - nunca gravamos senha nesta tabela).
--  * O usuário digita só o LOGIN (ex.: darllan). Por dentro, o e-mail do
--    Supabase Auth é  <login>@bivendas.local  (não recebe e-mail).
--  * Esta tabela guarda nome, situação (ativo) e as permissões.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABELA DE USUÁRIOS
-- ---------------------------------------------------------------------
create table if not exists public.usuarios (
  id                      uuid primary key references auth.users (id) on delete cascade,
  login                   text not null unique
                          check (login ~ '^[a-z0-9._-]{3,30}$'),
  nome                    text not null,
  email_contato           text,
  ativo                   boolean not null default true,
  trocar_senha            boolean not null default true,   -- obriga trocar no próximo login
  pode_acessar_bi         boolean not null default true,
  pode_gerenciar_usuarios boolean not null default false,
  pode_criar_metas        boolean not null default false,
  pode_alterar_metas      boolean not null default false,
  pode_excluir_metas      boolean not null default false,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now()
);

create or replace function public.usuarios_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists usuarios_atualizado_em on public.usuarios;
create trigger usuarios_atualizado_em
  before update on public.usuarios
  for each row execute function public.usuarios_atualizado_em();


-- ---------------------------------------------------------------------
-- 2. FUNÇÕES DE APOIO
-- ---------------------------------------------------------------------

-- Usuário logado tem a permissão? (falso se inativo ou sem cadastro)
create or replace function public.tem_permissao(permissao text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select ativo and case permissao
      when 'acessar_bi'         then pode_acessar_bi
      when 'gerenciar_usuarios' then pode_gerenciar_usuarios
      when 'criar_metas'        then pode_criar_metas
      when 'alterar_metas'      then pode_alterar_metas
      when 'excluir_metas'      then pode_excluir_metas
      else false
    end
    from public.usuarios
    where id = auth.uid()
  ), false);
$$;

-- Dados do próprio usuário logado (usado pelas telas e pelo servidor)
create or replace function public.meu_usuario()
returns setof public.usuarios
language sql stable security definer set search_path = public
as $$
  select * from public.usuarios where id = auth.uid();
$$;

-- Depois de trocar a senha, o próprio usuário desmarca "trocar_senha"
create or replace function public.marcar_senha_trocada()
returns void
language sql security definer set search_path = public
as $$
  update public.usuarios set trocar_senha = false where id = auth.uid();
$$;

revoke all on function public.tem_permissao(text)    from public, anon;
revoke all on function public.meu_usuario()          from public, anon;
revoke all on function public.marcar_senha_trocada() from public, anon;
grant execute on function public.tem_permissao(text)    to authenticated;
grant execute on function public.meu_usuario()          to authenticated;
grant execute on function public.marcar_senha_trocada() to authenticated;


-- ---------------------------------------------------------------------
-- 3. SEGURANÇA - USUARIOS
--    Ver: o próprio cadastro, ou todos se puder gerenciar usuários.
--    Alterar (nome, permissões, ativo): só quem gerencia usuários.
--    Incluir: só pelo servidor (cria login + senha no Supabase Auth).
-- ---------------------------------------------------------------------
alter table public.usuarios enable row level security;

drop policy if exists "ver usuarios"     on public.usuarios;
drop policy if exists "alterar usuarios" on public.usuarios;

create policy "ver usuarios" on public.usuarios
  for select to authenticated
  using (id = auth.uid() or public.tem_permissao('gerenciar_usuarios'));

create policy "alterar usuarios" on public.usuarios
  for update to authenticated
  using (public.tem_permissao('gerenciar_usuarios'))
  with check (public.tem_permissao('gerenciar_usuarios'));


-- ---------------------------------------------------------------------
-- 4. SEGURANÇA - METAS (substitui as regras "sem login")
-- ---------------------------------------------------------------------
alter table public.metas_loja enable row level security;

drop policy if exists "leitura publica"     on public.metas_loja;
drop policy if exists "incluir publico"     on public.metas_loja;
drop policy if exists "alterar publico"     on public.metas_loja;
drop policy if exists "excluir publico"     on public.metas_loja;
drop policy if exists "incluir autenticado" on public.metas_loja;
drop policy if exists "alterar autenticado" on public.metas_loja;
drop policy if exists "excluir autenticado" on public.metas_loja;
drop policy if exists "ver metas"           on public.metas_loja;
drop policy if exists "incluir metas"       on public.metas_loja;
drop policy if exists "alterar metas"       on public.metas_loja;
drop policy if exists "excluir metas"       on public.metas_loja;

create policy "ver metas" on public.metas_loja
  for select to authenticated using (public.tem_permissao('acessar_bi'));
create policy "incluir metas" on public.metas_loja
  for insert to authenticated with check (public.tem_permissao('criar_metas'));
create policy "alterar metas" on public.metas_loja
  for update to authenticated
  using (public.tem_permissao('alterar_metas'))
  with check (public.tem_permissao('alterar_metas'));
create policy "excluir metas" on public.metas_loja
  for delete to authenticated using (public.tem_permissao('excluir_metas'));


-- ---------------------------------------------------------------------
-- 5. SEGURANÇA - LOJAS (só usuário logado com acesso ao BI)
-- ---------------------------------------------------------------------
alter table public.lojas enable row level security;

drop policy if exists "leitura publica" on public.lojas;
drop policy if exists "ver lojas"       on public.lojas;

create policy "ver lojas" on public.lojas
  for select to authenticated using (public.tem_permissao('acessar_bi'));


-- =====================================================================
-- 6. PRIMEIRO USUÁRIO (administrador) - fazer UMA vez
--
--  a) Authentication > Users > Add user > Create new user
--       Email:    agazambuja@bivendas.local     (troque "agazambuja" pelo seu login)
--       Password: uma senha forte
--       [x] Auto Confirm User
--
--  b) Rode o comando abaixo (ajuste login e nome):
--
-- insert into public.usuarios
--   (id, login, nome, trocar_senha, pode_acessar_bi, pode_gerenciar_usuarios,
--    pode_criar_metas, pode_alterar_metas, pode_excluir_metas)
-- select id, 'agazambuja', 'Antenor', false, true, true, true, true, true
-- from auth.users where email = 'agazambuja@bivendas.local'
-- on conflict (id) do nothing;
--
--  c) Authentication > Sign In / Providers > desligar
--     "Allow new users to sign up"  (só o administrador cria usuários)
-- =====================================================================
