## Objetivo

Criar uma aba **Registros** no menu lateral (em cinza, abaixo de tudo e acima do rodapé "© 2026 Sistema IAM"), visível apenas para usuários com a permissão **Admin** ativa em nível "Só visualizar" ou "Ver e editar". A aba lista, em ordem cronológica reversa, todas as ações relevantes feitas no sistema nos últimos 7 dias, com **o que foi feito** e **quem fez**.

## Banco de dados

Nova tabela `public.activity_logs`:

- `id` uuid pk
- `created_at` timestamptz default now()
- `actor_user_id` uuid (auth.users id, nullable se sistema)
- `actor_name` text
- `company_id` uuid (escopo multi-empresa)
- `action` text — código curto (ex.: `student.create`, `installment.mark_paid`, `user.update`, `cancellation.move`)
- `entity` text — ex.: `student`, `user`, `installment`, `cancellation`, `renda_extra`, `ac`, `tag`, `config`
- `entity_id` text (nullable)
- `entity_label` text — rótulo legível (ex.: nome do aluno)
- `summary` text — descrição em PT-BR já formatada
- `meta` jsonb — payload bruto opcional (antes/depois)

Políticas RLS: leitura permitida apenas a usuários com `permissions.admin` = `view`/`edit` (helper `has_admin_permission(uid)`); insert permitido a `authenticated` (qualquer usuário grava as próprias ações); sem update/delete pelo cliente.

Retenção: filtro no front por `created_at >= now() - 7 days`. (Limpeza física fica para depois — não é requisito agora.)

## Camada de gravação

Novo helper `src/lib/activityLog.ts` com `logActivity({ action, entity, entityId?, entityLabel?, summary, meta? })` que:

1. Lê `currentUser` e `activeCompanyId` do store.
2. Insere fire-and-forget em `activity_logs` (sem await em UX crítica; erros só em console).

Instrumentar pontos-chave no store/mutations (sem alterar lógica):

- `useAppStore`: `addUser`, `updateUser`, `deleteUser`, `addAC`, `updateAC`, `deleteAC`, `addProduct`, `updateProduct`, `deleteProduct`, `addStudentTag`, `updateStudentTag`, `deleteStudentTag`, alterações em `financialRules`.
- `useAppStore` (alunos): criar/editar/excluir aluno, mudar status manual, mover para Renda Extra, reverter, cancelar.
- `useConciliacaoStore`: `registrarConciliacao` (criação), `aprovar`, `conciliar`, `reprovar`.
- Conciliação imediata em `conciliacaoImmediate.ts`: marcação de parcela paga, quitação, renegociação.
- Cancelamentos: criar caso, mover de stage, finalizar, reverter.
- Importações: Kamino, alunos, cancelamentos externos (resumo com totais).

Cada call gera um `summary` legível, ex.: *"Marcou parcela 3/12 do aluno João Silva como paga (R$ 350,00)"*.

## UI

### Sidebar

Em `src/components/layout/Sidebar.tsx`, adicionar item **Registros** depois de todos os outros do menu e antes do rodapé do copyright. Estilo: link discreto cinza (`text-muted-foreground`), ícone `ScrollText` ou `History`. Renderização condicional: só aparece se `canViewTab(currentUser, 'admin')`.

### Tipos / permissões

- Adicionar rota `registros` em `TabKey` (`src/types/index.ts`) e mapeá-la em `Index.tsx` (`TAB_TO_PERMISSION.registros = 'admin'`, `TAB_ORDER` inclui no fim).
- A permissão `admin` (já existente) passa a controlar a visibilidade dessa aba via `canViewTab(user, 'admin')`.

### Página `RegistrosPage`

`src/pages/RegistrosPage.tsx`:

- Header com título "Registros" e subtítulo "Ações feitas no sistema nos últimos 7 dias".
- Barra de filtros: busca textual (em `summary`/`actor_name`/`entity_label`), filtro por usuário, filtro por entidade (Aluno, Equipe, Conciliação, Cancelamento, Renda Extra, Configurações), filtro por data.
- Lista em tabela/feed com: data/hora (dd/mm/aaaa HH:mm), ícone da entidade, descrição (`summary`), badge do usuário (`actor_name`).
- Carrega com `supabase.from('activity_logs').select('*').gte('created_at', 7diasAtrás).order('created_at', desc).limit(500)`.
- Realtime opcional via subscribe na tabela para atualização ao vivo.

## Detalhes técnicos

- Helper `has_admin_permission(uuid)` em SQL (security definer) usado nas policies de SELECT.
- `logActivity` é resistente a falhas: nunca quebra a UX se o insert falhar.
- Não há remoção/edição de logs pelo cliente; admin enxerga tudo, mas não modifica.
- Mudanças isoladas em UI/dados — nenhuma regra de negócio existente é alterada, apenas registrada.

## Arquivos afetados

- Migração SQL nova (tabela + policies + helper).
- `src/types/index.ts` — adicionar `registros` a `TabKey`.
- `src/pages/Index.tsx` — mapeamento e render.
- `src/components/layout/Sidebar.tsx` — item de menu cinza.
- `src/pages/RegistrosPage.tsx` — nova página.
- `src/lib/activityLog.ts` — novo helper.
- `src/store/useAppStore.ts`, `src/store/useConciliacaoStore.ts`, `src/lib/conciliacaoImmediate.ts`, `src/lib/supabaseMutations.ts`, modais relevantes — instrumentação `logActivity(...)`.
