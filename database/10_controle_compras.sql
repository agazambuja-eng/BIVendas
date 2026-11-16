-- =====================================================================
-- BIVendas - Controle de Solicitações de Compras
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro. Rode DEPOIS dos scripts 05 e 06.
--
-- Cria:
--   * 2 permissões novas no cadastro de usuários:
--       pode_solicitar_compras  -> gerente: cria pedidos das lojas dele
--       pode_aprovar_compras    -> gestor: catálogo, aprovar/reprovar,
--                                  compra solicitada, entregue
--   * produtos_compra            -> catálogo padronizado
--   * pedidos_compra             -> pedido numerado por loja (520-0001...)
--   * pedidos_compra_itens       -> itens (qtd solicitada e aprovada)
--   * pedidos_compra_historico   -> quem fez o quê e quando
--   * funções compras_*          -> únicas formas de criar/alterar pedidos
--                                  (conferem permissão e situação)
--
-- Situações do pedido:
--   aguardando -> aprovado -> comprado -> entregue
--   aguardando -> reprovado
--   aguardando -> cancelado (pelo próprio solicitante)
-- =====================================================================


-- 1. Permissões novas ---------------------------------------------------
alter table public.usuarios add column if not exists pode_solicitar_compras boolean not null default false;
alter table public.usuarios add column if not exists pode_aprovar_compras   boolean not null default false;

-- Administradores atuais ganham as duas (podem tirar depois na tela)
update public.usuarios set pode_solicitar_compras = true, pode_aprovar_compras = true
 where pode_gerenciar_usuarios and not (pode_solicitar_compras or pode_aprovar_compras);

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
      when 'solicitar_compras'  then pode_solicitar_compras
      when 'aprovar_compras'    then pode_aprovar_compras
      else false
    end
    from public.usuarios
    where id = auth.uid()
  ), false);
$$;

-- meu_usuario() já devolve todas as colunas (inclui as novas)
create or replace function public.meu_usuario()
returns setof public.usuarios
language sql stable security definer set search_path = public
as $$
  select * from public.usuarios where id = auth.uid();
$$;

-- Loja liberada para o usuário logado (todas_lojas ou usuarios_lojas)
create or replace function public.compras_pode_loja(p_codigo integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.usuarios
                 where id = auth.uid() and ativo and todas_lojas)
      or exists (select 1 from public.usuarios_lojas ul
                 join public.usuarios u on u.id = ul.usuario_id and u.ativo
                 where ul.usuario_id = auth.uid() and ul.loja_codigo = p_codigo);
$$;

-- Lojas que o usuário pode usar nas compras (código e nome)
create or replace function public.compras_minhas_lojas()
returns table (codigo integer, nome text)
language sql stable security definer set search_path = public
as $$
  select l.codigo::integer, l.nome::text
    from public.lojas l
   where l.codigo is not null
     and (public.tem_permissao('solicitar_compras') or public.tem_permissao('aprovar_compras'))
     and public.compras_pode_loja(l.codigo)
   order by l.codigo;
$$;


-- 2. Catálogo -----------------------------------------------------------
create table if not exists public.produtos_compra (
  id            bigint generated always as identity primary key,
  codigo        text    not null,
  nome          text    not null,
  categoria     text,
  unidade       text    not null default 'unidade',
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.produtos_compra drop constraint if exists produtos_compra_codigo_unico;
alter table public.produtos_compra add constraint produtos_compra_codigo_unico unique (codigo);

create or replace function public.compras_atualizado_em()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists produtos_compra_atualizado_em on public.produtos_compra;
create trigger produtos_compra_atualizado_em before update on public.produtos_compra
  for each row execute function public.compras_atualizado_em();


-- 3. Pedidos, itens e histórico ------------------------------------------
create table if not exists public.pedidos_compra (
  id                bigint generated always as identity primary key,
  loja_codigo       integer not null,
  numero            integer not null,
  status            text    not null default 'aguardando',
  solicitante_id    uuid    not null,
  solicitante_nome  text    not null,
  observacao        text,
  parecer           text,
  criado_em         timestamptz not null default now(),
  decidido_por      text,
  decidido_em       timestamptz,
  comprado_em       timestamptz,
  entregue_em       timestamptz,
  atualizado_em     timestamptz not null default now()
);
alter table public.pedidos_compra drop constraint if exists pedidos_compra_numero_unico;
alter table public.pedidos_compra add constraint pedidos_compra_numero_unico unique (loja_codigo, numero);
alter table public.pedidos_compra drop constraint if exists pedidos_compra_status_valido;
alter table public.pedidos_compra add constraint pedidos_compra_status_valido
  check (status in ('aguardando', 'aprovado', 'reprovado', 'comprado', 'entregue', 'cancelado'));
create index if not exists pedidos_compra_status_idx on public.pedidos_compra (status, criado_em desc);
drop trigger if exists pedidos_compra_atualizado_em on public.pedidos_compra;
create trigger pedidos_compra_atualizado_em before update on public.pedidos_compra
  for each row execute function public.compras_atualizado_em();

create table if not exists public.pedidos_compra_itens (
  id              bigint generated always as identity primary key,
  pedido_id       bigint  not null references public.pedidos_compra (id) on delete cascade,
  produto_id      bigint  references public.produtos_compra (id) on delete set null,
  produto_codigo  text    not null,
  produto_nome    text    not null,
  unidade         text    not null,
  qtd_solicitada  numeric(12,2) not null check (qtd_solicitada > 0),
  qtd_aprovada    numeric(12,2) check (qtd_aprovada >= 0),
  observacao      text
);
create index if not exists pedidos_compra_itens_pedido_idx on public.pedidos_compra_itens (pedido_id);

create table if not exists public.pedidos_compra_historico (
  id            bigint generated always as identity primary key,
  pedido_id     bigint not null references public.pedidos_compra (id) on delete cascade,
  quando        timestamptz not null default now(),
  usuario_id    uuid,
  usuario_nome  text,
  acao          text not null,
  detalhe       text
);
create index if not exists pedidos_compra_hist_pedido_idx on public.pedidos_compra_historico (pedido_id, quando);


-- 4. Segurança (RLS) -------------------------------------------------------
--   Catálogo: lê quem solicita ou aprova; altera só quem aprova.
--   Pedidos: lê quem aprova (todos) ou quem solicita (lojas dele).
--   Pedidos só mudam pelas funções compras_* (abaixo).
alter table public.produtos_compra          enable row level security;
alter table public.pedidos_compra           enable row level security;
alter table public.pedidos_compra_itens     enable row level security;
alter table public.pedidos_compra_historico enable row level security;

drop policy if exists "ver catalogo compras"     on public.produtos_compra;
drop policy if exists "incluir catalogo compras" on public.produtos_compra;
drop policy if exists "alterar catalogo compras" on public.produtos_compra;
drop policy if exists "excluir catalogo compras" on public.produtos_compra;
create policy "ver catalogo compras" on public.produtos_compra for select to authenticated
  using (public.tem_permissao('solicitar_compras') or public.tem_permissao('aprovar_compras'));
create policy "incluir catalogo compras" on public.produtos_compra for insert to authenticated
  with check (public.tem_permissao('aprovar_compras'));
create policy "alterar catalogo compras" on public.produtos_compra for update to authenticated
  using (public.tem_permissao('aprovar_compras')) with check (public.tem_permissao('aprovar_compras'));
create policy "excluir catalogo compras" on public.produtos_compra for delete to authenticated
  using (public.tem_permissao('aprovar_compras'));

drop policy if exists "ver pedidos compra" on public.pedidos_compra;
create policy "ver pedidos compra" on public.pedidos_compra for select to authenticated
  using (public.tem_permissao('aprovar_compras')
         or (public.tem_permissao('solicitar_compras') and public.compras_pode_loja(loja_codigo)));

drop policy if exists "ver itens compra" on public.pedidos_compra_itens;
create policy "ver itens compra" on public.pedidos_compra_itens for select to authenticated
  using (exists (select 1 from public.pedidos_compra p where p.id = pedido_id));

drop policy if exists "ver historico compra" on public.pedidos_compra_historico;
create policy "ver historico compra" on public.pedidos_compra_historico for select to authenticated
  using (exists (select 1 from public.pedidos_compra p where p.id = pedido_id));

grant select, insert, update, delete on public.produtos_compra to authenticated;
grant select on public.pedidos_compra, public.pedidos_compra_itens, public.pedidos_compra_historico to authenticated;


-- 5. Funções (as únicas formas de criar e mudar pedidos) -------------------
create or replace function public.compras_nome_usuario()
returns text language sql stable security definer set search_path = public
as $$ select coalesce((select nome from public.usuarios where id = auth.uid()), 'usuário') $$;

-- Envia um pedido novo. p_itens = [{"produto_id": 1, "qtd": 4, "obs": "preto"}, ...]
create or replace function public.compras_enviar_pedido(p_loja integer, p_observacao text, p_itens jsonb)
returns public.pedidos_compra
language plpgsql security definer set search_path = public
as $$
declare
  v_pedido public.pedidos_compra;
  v_numero integer;
  v_item   jsonb;
  v_prod   public.produtos_compra;
  v_qtd    numeric;
begin
  if not public.tem_permissao('solicitar_compras') then
    raise exception 'Sem permissão para solicitar compras.';
  end if;
  if not public.compras_pode_loja(p_loja) then
    raise exception 'Você não tem acesso à loja %.', p_loja;
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Inclua pelo menos um item.';
  end if;

  -- número sequencial por loja, sem repetir mesmo com dois envios ao mesmo tempo
  perform pg_advisory_xact_lock(hashtext('pedidos_compra'), p_loja);
  select coalesce(max(numero), 0) + 1 into v_numero from public.pedidos_compra where loja_codigo = p_loja;

  insert into public.pedidos_compra (loja_codigo, numero, solicitante_id, solicitante_nome, observacao)
  values (p_loja, v_numero, auth.uid(), public.compras_nome_usuario(), nullif(trim(p_observacao), ''))
  returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_prod from public.produtos_compra where id = (v_item->>'produto_id')::bigint and ativo;
    if not found then raise exception 'Produto % não existe ou está inativo.', v_item->>'produto_id'; end if;
    v_qtd := (v_item->>'qtd')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida para %.', v_prod.nome; end if;
    insert into public.pedidos_compra_itens (pedido_id, produto_id, produto_codigo, produto_nome, unidade, qtd_solicitada, observacao)
    values (v_pedido.id, v_prod.id, v_prod.codigo, v_prod.nome, v_prod.unidade, v_qtd, nullif(trim(v_item->>'obs'), ''));
  end loop;

  insert into public.pedidos_compra_historico (pedido_id, usuario_id, usuario_nome, acao, detalhe)
  values (v_pedido.id, auth.uid(), v_pedido.solicitante_nome, 'enviado', jsonb_array_length(p_itens) || ' item(ns)');
  return v_pedido;
end $$;

-- Gestor aprova (com quantidades ajustadas) ou reprova.
-- p_itens = [{"id": 10, "qtd_aprovada": 40}, ...] (ignorado ao reprovar)
create or replace function public.compras_decidir(p_pedido bigint, p_aprovar boolean, p_parecer text, p_itens jsonb)
returns public.pedidos_compra
language plpgsql security definer set search_path = public
as $$
declare
  v_pedido public.pedidos_compra;
  v_item   jsonb;
  v_nome   text := public.compras_nome_usuario();
begin
  if not public.tem_permissao('aprovar_compras') then raise exception 'Sem permissão para aprovar compras.'; end if;
  select * into v_pedido from public.pedidos_compra where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_pedido.status <> 'aguardando' then raise exception 'Este pedido já foi %.', v_pedido.status; end if;
  if not p_aprovar and coalesce(trim(p_parecer), '') = '' then
    raise exception 'Informe o motivo da reprovação no parecer.';
  end if;

  if p_aprovar then
    update public.pedidos_compra_itens set qtd_aprovada = qtd_solicitada where pedido_id = p_pedido;
    for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
      update public.pedidos_compra_itens
         set qtd_aprovada = greatest(0, (v_item->>'qtd_aprovada')::numeric)
       where id = (v_item->>'id')::bigint and pedido_id = p_pedido;
    end loop;
  end if;

  update public.pedidos_compra
     set status = case when p_aprovar then 'aprovado' else 'reprovado' end,
         parecer = nullif(trim(p_parecer), ''), decidido_por = v_nome, decidido_em = now()
   where id = p_pedido
  returning * into v_pedido;

  insert into public.pedidos_compra_historico (pedido_id, usuario_id, usuario_nome, acao, detalhe)
  values (p_pedido, auth.uid(), v_nome, v_pedido.status, nullif(trim(p_parecer), ''));
  return v_pedido;
end $$;

-- Avança a situação: 'comprado' (gestor), 'entregue' (gestor ou a loja),
-- 'cancelado' (o próprio solicitante, enquanto aguarda).
create or replace function public.compras_marcar(p_pedido bigint, p_status text, p_detalhe text)
returns public.pedidos_compra
language plpgsql security definer set search_path = public
as $$
declare
  v_pedido public.pedidos_compra;
  v_nome   text := public.compras_nome_usuario();
  v_gestor boolean := public.tem_permissao('aprovar_compras');
begin
  select * into v_pedido from public.pedidos_compra where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;

  if p_status = 'comprado' then
    if not v_gestor then raise exception 'Sem permissão.'; end if;
    if v_pedido.status <> 'aprovado' then raise exception 'Só pedido aprovado pode ir para compra.'; end if;
    update public.pedidos_compra set status = 'comprado', comprado_em = now() where id = p_pedido returning * into v_pedido;
  elsif p_status = 'entregue' then
    if not (v_gestor or (public.tem_permissao('solicitar_compras') and public.compras_pode_loja(v_pedido.loja_codigo))) then
      raise exception 'Sem permissão.';
    end if;
    if v_pedido.status <> 'comprado' then raise exception 'Só pedido com compra solicitada pode ser marcado como entregue.'; end if;
    update public.pedidos_compra set status = 'entregue', entregue_em = now() where id = p_pedido returning * into v_pedido;
  elsif p_status = 'cancelado' then
    if v_pedido.solicitante_id <> auth.uid() and not v_gestor then raise exception 'Só quem pediu pode cancelar.'; end if;
    if v_pedido.status <> 'aguardando' then raise exception 'Só pedido aguardando aprovação pode ser cancelado.'; end if;
    update public.pedidos_compra set status = 'cancelado' where id = p_pedido returning * into v_pedido;
  else
    raise exception 'Situação inválida: %', p_status;
  end if;

  insert into public.pedidos_compra_historico (pedido_id, usuario_id, usuario_nome, acao, detalhe)
  values (p_pedido, auth.uid(), v_nome, p_status, nullif(trim(p_detalhe), ''));
  return v_pedido;
end $$;

revoke all on function public.compras_enviar_pedido(integer, text, jsonb) from public, anon;
revoke all on function public.compras_decidir(bigint, boolean, text, jsonb) from public, anon;
revoke all on function public.compras_marcar(bigint, text, text) from public, anon;
revoke all on function public.compras_minhas_lojas() from public, anon;
grant execute on function public.compras_enviar_pedido(integer, text, jsonb) to authenticated;
grant execute on function public.compras_decidir(bigint, boolean, text, jsonb) to authenticated;
grant execute on function public.compras_marcar(bigint, text, text) to authenticated;
grant execute on function public.compras_minhas_lojas() to authenticated;
grant execute on function public.compras_pode_loja(integer) to authenticated;


-- 6. Conferência -------------------------------------------------------------
select nome, pode_solicitar_compras, pode_aprovar_compras from public.usuarios order by nome;
