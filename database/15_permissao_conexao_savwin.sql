-- =====================================================================
-- BIVendas - Permissão "Conexão SavWin" no cadastro do usuário
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run
-- Pode rodar mais de uma vez sem erro. Rode DEPOIS do script 14.
--
-- pode_conexao_savwin: abre Configurações › Conexão SavWin e cadastra o
--   acesso SavWin dos outros usuários. A lista e a gravação passam pelo
--   servidor; a senha fica cifrada e nunca volta para a tela.
-- =====================================================================

alter table public.usuarios add column if not exists pode_conexao_savwin boolean not null default false;

-- quem é administrador já começa com a permissão
update public.usuarios set pode_conexao_savwin = true where pode_gerenciar_usuarios and not pode_conexao_savwin;

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
      when 'conexao_savwin'     then pode_conexao_savwin
      else false
    end
    from public.usuarios
    where id = auth.uid()
  ), false);
$$;
