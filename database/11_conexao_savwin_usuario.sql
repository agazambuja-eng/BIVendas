-- =====================================================================
-- 11 · Conexão SavWin no cadastro do usuário
--
-- Cada usuário do BI guarda o SEU acesso ao SavWin (usado no Estoque
-- encalhado, na pesquisa de preço de venda e no detalhe por loja):
--   identificadorsav  ex.: 09983-ONE
--   loginsav          login do SavWin
--   senhasav          senha do SavWin. O BI grava CIFRADA (AES-256-GCM,
--                     texto começando com "v1:"). Se for digitada pura aqui
--                     na tabela, também funciona.
--
-- O usuário preenche pelo botão "🔌 Conexão SavWin" (ao lado de Trocar senha).
-- Quem grava é o servidor do BI (chave secreta), depois de testar o login.
-- Rodar uma vez no SQL Editor do Supabase.
-- =====================================================================

alter table public.usuarios
  add column if not exists identificadorsav text,
  add column if not exists loginsav         text,
  add column if not exists senhasav         text;

comment on column public.usuarios.identificadorsav is 'SavWin: identificador da empresa (ex.: 09983-ONE)';
comment on column public.usuarios.loginsav         is 'SavWin: login do usuário';
comment on column public.usuarios.senhasav         is 'SavWin: senha (gravada cifrada pelo BI, prefixo v1:)';

-- meu_usuario() devolve "select *" da tabela, então já traz as colunas novas.
-- Conferir:
-- select id, login, identificadorsav, loginsav, left(senhasav, 3) as senha from public.usuarios;
