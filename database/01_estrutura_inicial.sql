-- =====================================================================
-- BIVendas - Estrutura inicial do banco (Supabase / PostgreSQL)
-- Como usar: Supabase > SQL Editor > New query > colar tudo > Run
-- Pode rodar mais de uma vez sem erro (usa IF NOT EXISTS).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. LOJAS
--    codigo    = código da loja no ERP Savwin (ex.: 520)
--    descricao = nome da loja (ex.: FAROL)
-- ---------------------------------------------------------------------
create table if not exists public.lojas (
  id          bigint generated always as identity primary key,
  codigo      integer not null unique,
  descricao   text    not null,
  gerente     text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. TIPOS DE META
--    Tabela de apoio: cada tipo de meta tem um código e uma descrição.
--    Permite criar novos tipos sem alterar a estrutura.
-- ---------------------------------------------------------------------
create table if not exists public.tipos_meta (
  id          bigint generated always as identity primary key,
  codigo      text not null unique,          -- ex.: VENDA
  descricao   text not null,                 -- ex.: Meta de venda (R$)
  unidade     text not null default 'R$'     -- R$, %, QTD
              check (unidade in ('R$', '%', 'QTD'))
);

insert into public.tipos_meta (codigo, descricao, unidade) values
  ('VENDA',    'Meta de venda líquida',          'R$'),
  ('TICKET',   'Meta de ticket médio',           'R$'),
  ('DESCONTO', 'Limite de desconto',             '%'),
  ('GOOGLE',   'Avaliações do Google no mês',    'QTD')
on conflict (codigo) do nothing;


-- ---------------------------------------------------------------------
-- 3. METAS DA LOJA
--    Uma linha por loja + mês + tipo de meta.
--    competencia = sempre o dia 1 do mês (ex.: 2026-09-01 = setembro/2026)
-- ---------------------------------------------------------------------
create table if not exists public.metas_loja (
  id            bigint generated always as identity primary key,
  loja_codigo   integer not null references public.lojas (codigo),
  tipo_codigo   text    not null references public.tipos_meta (codigo),
  competencia   date    not null check (extract(day from competencia) = 1),
  descricao     text,
  valor         numeric(14,2) not null check (valor >= 0),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (loja_codigo, tipo_codigo, competencia)
);

create index if not exists metas_loja_competencia_idx
  on public.metas_loja (competencia);


-- ---------------------------------------------------------------------
-- 4. SEGURANÇA (Row Level Security)
--    O BI usa a chave pública (publishable/anon) no navegador.
--    Por enquanto: qualquer um com a chave pode LER; só usuários
--    logados podem gravar. Ajustaremos quando criarmos USUARIOS.
-- ---------------------------------------------------------------------
alter table public.lojas      enable row level security;
alter table public.tipos_meta enable row level security;
alter table public.metas_loja enable row level security;

drop policy if exists "leitura publica" on public.lojas;
drop policy if exists "leitura publica" on public.tipos_meta;
drop policy if exists "leitura publica" on public.metas_loja;
create policy "leitura publica" on public.lojas      for select using (true);
create policy "leitura publica" on public.tipos_meta for select using (true);
create policy "leitura publica" on public.metas_loja for select using (true);

drop policy if exists "gravacao autenticada" on public.lojas;
drop policy if exists "gravacao autenticada" on public.metas_loja;
create policy "gravacao autenticada" on public.lojas
  for all to authenticated using (true) with check (true);
create policy "gravacao autenticada" on public.metas_loja
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------
-- 5. DADOS DE EXEMPLO (Setembro/2026, tirados do painel em PDF)
--    Apague este bloco se não quiser os exemplos.
-- ---------------------------------------------------------------------
insert into public.lojas (codigo, descricao) values
  (518, 'VISÃO KODAK PORTO CALVO'),
  (519, 'ZVC JATIÚCA'),
  (520, 'FAROL'),
  (521, 'GRUTA'),
  (522, 'MACEIÓ SHOPPING'),
  (523, 'ZVC MACEIÓ SHOPPING'),
  (538, 'ARAPIRACA'),
  (561, 'POP VISION')
on conflict (codigo) do nothing;

insert into public.metas_loja (loja_codigo, tipo_codigo, competencia, valor) values
  (520, 'VENDA', '2026-09-01', 185000),
  (521, 'VENDA', '2026-09-01', 220000),
  (522, 'VENDA', '2026-09-01', 270000),
  (538, 'VENDA', '2026-09-01', 120000),
  (561, 'VENDA', '2026-09-01',  30000),
  (519, 'VENDA', '2026-09-01', 125000),
  (523, 'VENDA', '2026-09-01', 185000),
  (518, 'VENDA', '2026-09-01',  50000)
on conflict (loja_codigo, tipo_codigo, competencia) do nothing;

-- Ticket (R$ 1.500), desconto (10%) e Google (20/mês) iguais para todas
insert into public.metas_loja (loja_codigo, tipo_codigo, competencia, valor)
select l.codigo, t.tipo, '2026-09-01', t.valor
from public.lojas l
cross join (values ('TICKET', 1500), ('DESCONTO', 10), ('GOOGLE', 20)) as t(tipo, valor)
on conflict (loja_codigo, tipo_codigo, competencia) do nothing;


-- ---------------------------------------------------------------------
-- PRÓXIMAS TABELAS (não criadas ainda)
--   usuarios   -> perfil ligado ao login do Supabase (auth.users)
--   metas_vendedor, avaliacoes_google, observacoes_reuniao ...
-- ---------------------------------------------------------------------
