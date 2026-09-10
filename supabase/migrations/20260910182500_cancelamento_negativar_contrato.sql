-- Cancelamento com desfecho "Negativar Contrato" (10/09/2026).
--
-- Regra do financeiro: quando o aluno se recusa a pagar a multa, o contrato
-- INTEIRO vai para negativação. O cancelamento não baixa parcela nenhuma e a
-- dashboard não muda: a ficha fica "À Negativar" (Manual) com todas as
-- parcelas em aberto, e depois "Negativado" quando a negativação for feita.
-- Caso real: Lucilene dos Santos Barbosa (Confronto) — "Aluna falou que não
-- vai pagar a multa. Seguir com a negativação."
--
-- Marcador no caso: negativar_contrato. Ao conciliar na aba Conciliação, o
-- front lê o marcador e aplica o desfecho de negativação em vez da baixa.
-- students.status_cancelamento ganha o valor 'negativacao' (coluna text, sem
-- constraint) para o aluno sair do funil de cancelamento sem virar 'cancelado'.
ALTER TABLE public.cancellation_cases
  ADD COLUMN IF NOT EXISTS negativar_contrato boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cancellation_cases.negativar_contrato IS
  'Desfecho "Negativar Contrato": aluno se recusou a pagar a multa; contrato inteiro segue na carteira como À Negativar, nada é baixado.';
