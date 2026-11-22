-- =====================================================================
-- BIVendas - Permissão "Configuração do BI" no cadastro do usuário
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro. Rode DEPOIS dos scripts 05, 10 e 13.
--
-- pode_configurar_bi: abre Configurações › Configuração do BI
--   (planos de contas e linhas de compra; parâmetros da IA).
-- Planos por usuário, conexão SavWin de outros usuários e "quem usa a IA"
-- continuam só para o administrador (gerenciar usuários).
-- =====================================================================

alter table public.usuarios add column if not exists pode_configurar_bi boolean not null default false;

-- quem é administrador já começa com a permissão
update public.usuarios set pode_configurar_bi = true where pode_gerenciar_usuarios and not pode_configurar_bi;

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
      when 'configurar_bi'      then pode_configurar_bi
      else false
    end
    from public.usuarios
    where id = auth.uid()
  ), false);
$$;

-- configuracoes_bi: gravar = administrador ou quem tem "Configuração do BI"
drop policy if exists "incluir configuracoes bi" on public.configuracoes_bi;
drop policy if exists "alterar configuracoes bi" on public.configuracoes_bi;
create policy "incluir configuracoes bi" on public.configuracoes_bi for insert to authenticated
  with check (public.tem_permissao('gerenciar_usuarios') or public.tem_permissao('configurar_bi'));
create policy "alterar configuracoes bi" on public.configuracoes_bi for update to authenticated
  using (public.tem_permissao('gerenciar_usuarios') or public.tem_permissao('configurar_bi'))
  with check (public.tem_permissao('gerenciar_usuarios') or public.tem_permissao('configurar_bi'));
