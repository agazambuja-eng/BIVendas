-- =====================================================================
-- BIVendas - Cadastro de lojas (usado no modal "Selecionar Lojas")
-- Tabela criada pelo Table Editor: id, nome, gerente, codigo
-- Como usar: Supabase > SQL Editor > New query > colar > Run
-- =====================================================================

-- Código da loja único (o BI usa o código, ex.: 520, no filtro)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lojas_codigo_unico') then
    alter table public.lojas add constraint lojas_codigo_unico unique (codigo);
  end if;
end $$;

-- Leitura pública (o BI lê com a chave publishable)
alter table public.lojas enable row level security;

drop policy if exists "leitura publica" on public.lojas;
create policy "leitura publica" on public.lojas
  for select using (true);
