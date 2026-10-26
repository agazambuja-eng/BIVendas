-- =====================================================================
-- BIVendas - Lojas liberadas por usuário
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro.
--
--  * usuarios.todas_lojas = true  -> vê todas as lojas (ex.: administrador)
--  * senão, vê só as lojas listadas em usuarios_lojas
-- =====================================================================


-- 1. "Todas as lojas" no cadastro do usuário
alter table public.usuarios
  add column if not exists todas_lojas boolean not null default false;

-- Administradores atuais passam a ver todas as lojas
update public.usuarios set todas_lojas = true where pode_gerenciar_usuarios;

-- meu_usuario() devolve também a coluna nova
create or replace function public.meu_usuario()
returns setof public.usuarios
language sql stable security definer set search_path = public
as $$
  select * from public.usuarios where id = auth.uid();
$$;


-- 2. Código da loja único (necessário para a ligação abaixo)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lojas_codigo_unico') then
    alter table public.lojas add constraint lojas_codigo_unico unique (codigo);
  end if;
end $$;


-- 3. Lojas de cada usuário
create table if not exists public.usuarios_lojas (
  usuario_id  uuid     not null references public.usuarios (id) on delete cascade,
  loja_codigo smallint not null references public.lojas (codigo) on delete cascade,
  primary key (usuario_id, loja_codigo)
);


-- 4. Funções de apoio
-- O usuário logado pode ver esta loja?
create or replace function public.pode_ver_loja(p_codigo integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.tem_permissao('acessar_bi') and (
    exists (select 1 from public.usuarios
            where id = auth.uid() and ativo and todas_lojas)
    or exists (select 1 from public.usuarios_lojas
               where usuario_id = auth.uid() and loja_codigo = p_codigo)
  );
$$;

-- Códigos das lojas que o usuário logado pode ver (usado pelo servidor)
create or replace function public.minhas_lojas()
returns setof integer
language sql stable security definer set search_path = public
as $$
  select codigo::integer from public.lojas
  where public.pode_ver_loja(codigo)
  order by codigo;
$$;

-- Lista completa de lojas para a tela de usuários (só administrador)
create or replace function public.lojas_para_cadastro()
returns table (codigo integer, nome text, gerente text)
language sql stable security definer set search_path = public
as $$
  select l.codigo::integer, l.nome, l.gerente
  from public.lojas l
  where public.tem_permissao('gerenciar_usuarios')
  order by l.codigo;
$$;

revoke all on function public.pode_ver_loja(integer)  from public, anon;
revoke all on function public.minhas_lojas()          from public, anon;
revoke all on function public.lojas_para_cadastro()   from public, anon;
grant execute on function public.pode_ver_loja(integer) to authenticated;
grant execute on function public.minhas_lojas()         to authenticated;
grant execute on function public.lojas_para_cadastro()  to authenticated;


-- 5. Segurança: LOJAS - cada um vê só as suas
alter table public.lojas enable row level security;
drop policy if exists "leitura publica" on public.lojas;
drop policy if exists "ver lojas"       on public.lojas;
create policy "ver lojas" on public.lojas
  for select to authenticated using (public.pode_ver_loja(codigo));


-- 6. Segurança: METAS - só das lojas do usuário
drop policy if exists "ver metas"     on public.metas_loja;
drop policy if exists "incluir metas" on public.metas_loja;
drop policy if exists "alterar metas" on public.metas_loja;
drop policy if exists "excluir metas" on public.metas_loja;

create policy "ver metas" on public.metas_loja
  for select to authenticated using (public.pode_ver_loja(codigo));
create policy "incluir metas" on public.metas_loja
  for insert to authenticated
  with check (public.tem_permissao('criar_metas') and public.pode_ver_loja(codigo));
create policy "alterar metas" on public.metas_loja
  for update to authenticated
  using (public.tem_permissao('alterar_metas') and public.pode_ver_loja(codigo))
  with check (public.tem_permissao('alterar_metas') and public.pode_ver_loja(codigo));
create policy "excluir metas" on public.metas_loja
  for delete to authenticated
  using (public.tem_permissao('excluir_metas') and public.pode_ver_loja(codigo));


-- 7. Segurança: USUARIOS_LOJAS - administrador define; usuário vê as suas
alter table public.usuarios_lojas enable row level security;
drop policy if exists "ver lojas do usuario"      on public.usuarios_lojas;
drop policy if exists "incluir lojas do usuario"  on public.usuarios_lojas;
drop policy if exists "excluir lojas do usuario"  on public.usuarios_lojas;

create policy "ver lojas do usuario" on public.usuarios_lojas
  for select to authenticated
  using (usuario_id = auth.uid() or public.tem_permissao('gerenciar_usuarios'));
create policy "incluir lojas do usuario" on public.usuarios_lojas
  for insert to authenticated with check (public.tem_permissao('gerenciar_usuarios'));
create policy "excluir lojas do usuario" on public.usuarios_lojas
  for delete to authenticated using (public.tem_permissao('gerenciar_usuarios'));
