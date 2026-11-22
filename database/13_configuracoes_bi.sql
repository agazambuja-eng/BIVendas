-- =====================================================================
-- BIVendas - Configurações do BI gravadas no banco (em vez de fixas no programa)
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro. Rode DEPOIS dos scripts 05 e 10.
--
-- Tabela chave -> valor (JSON). Hoje usada pela aba CMV:
--   chave 'cmv_compras' = {
--     "linhas":  ["ARMACAO RX","ARMACAO SUN","ARMACAO CLIPON"],   -- linhas de produto que se compra para estoque
--     "planos":  ["FORNECEDOR MERCADORIA", ...],                   -- planos de contas que são compra de mercadoria
--     "cmvAlvo": 40, "reserva": 10, "cobertura": 3                  -- parâmetros padrão da análise
--   }
-- Todos que acessam o BI leem; só administrador (gerenciar usuários) ou quem
-- aprova compras altera. Novas chaves podem ser criadas no futuro sem mudar a tabela.
-- =====================================================================

create table if not exists public.configuracoes_bi (
  chave           text primary key check (chave ~ '^[a-z0-9_]{2,60}$'),
  valor           jsonb not null default '{}'::jsonb,
  atualizado_por  uuid references public.usuarios (id) on delete set null,
  atualizado_em   timestamptz not null default now()
);

create or replace function public.configuracoes_bi_carimbo()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;

drop trigger if exists configuracoes_bi_carimbo on public.configuracoes_bi;
create trigger configuracoes_bi_carimbo
  before insert or update on public.configuracoes_bi
  for each row execute function public.configuracoes_bi_carimbo();

alter table public.configuracoes_bi enable row level security;
drop policy if exists "ver configuracoes bi"     on public.configuracoes_bi;
drop policy if exists "incluir configuracoes bi" on public.configuracoes_bi;
drop policy if exists "alterar configuracoes bi" on public.configuracoes_bi;
drop policy if exists "excluir configuracoes bi" on public.configuracoes_bi;
create policy "ver configuracoes bi" on public.configuracoes_bi for select to authenticated
  using (public.tem_permissao('acessar_bi'));
create policy "incluir configuracoes bi" on public.configuracoes_bi for insert to authenticated
  with check (public.tem_permissao('gerenciar_usuarios') or public.tem_permissao('aprovar_compras'));
create policy "alterar configuracoes bi" on public.configuracoes_bi for update to authenticated
  using (public.tem_permissao('gerenciar_usuarios') or public.tem_permissao('aprovar_compras'))
  with check (public.tem_permissao('gerenciar_usuarios') or public.tem_permissao('aprovar_compras'));
create policy "excluir configuracoes bi" on public.configuracoes_bi for delete to authenticated
  using (public.tem_permissao('gerenciar_usuarios'));

-- Valor inicial: compra de mercadoria = armações (lentes só se compra na hora do óculos)
insert into public.configuracoes_bi (chave, valor)
values ('cmv_compras', '{"linhas":["ARMACAO RX","ARMACAO SUN","ARMACAO CLIPON"],"planos":[],"cmvAlvo":40,"reserva":10,"cobertura":3}'::jsonb)
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- Catálogo de nomes (planos de contas e linhas de produto) que o BI já viu.
-- Cada vez que alguém consulta, o BI grava os nomes novos (sem duplicar),
-- para a tela de configuração listar tudo, mesmo o que não apareceu na consulta atual.
--   chave 'catalogo_planos_contas'  = {"nomes": [...]}
--   chave 'catalogo_linhas_produto' = {"nomes": [...]}
-- Qualquer usuário do BI pode acrescentar nomes (só acrescenta; não apaga nem altera a configuração).
-- ---------------------------------------------------------------------
create or replace function public.registrar_catalogo_bi(p_chave text, p_nomes text[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  atuais jsonb;
  novos  text[];
begin
  if not public.tem_permissao('acessar_bi') then return 0; end if;
  if p_chave not in ('catalogo_planos_contas', 'catalogo_linhas_produto') then
    raise exception 'Catálogo inválido: %', p_chave;
  end if;
  select coalesce(valor -> 'nomes', '[]'::jsonb) into atuais from public.configuracoes_bi where chave = p_chave;
  atuais := coalesce(atuais, '[]'::jsonb);
  select array_agg(distinct n) into novos
    from (select left(btrim(x), 120) as n from unnest(coalesce(p_nomes, '{}')) as x) s
   where n <> '' and not (atuais ? n);
  if novos is null then return 0; end if;
  insert into public.configuracoes_bi (chave, valor)
  values (p_chave, jsonb_build_object('nomes', atuais || to_jsonb(novos)))
  on conflict (chave) do update set valor = jsonb_build_object('nomes', excluded.valor -> 'nomes');
  return array_length(novos, 1);
end $$;

revoke all on function public.registrar_catalogo_bi(text, text[]) from public;
grant execute on function public.registrar_catalogo_bi(text, text[]) to authenticated;
