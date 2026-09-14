-- Altemir Borghezan — Missão Governar (IAM - GC)
-- Ficha importada do Kamino veio com só 2 parcelas (entrada R$ 3.000 + 1 boleto R$ 1.323,05).
-- Correto: ENTRADA R$ 3.000,00 + BOLETO 10x R$ 1.323,05 (contrato R$ 16.230,50).
-- Pagos: entrada + boletos dos meses 05, 06, 07 e 08/2026. Próximo vence 15/09/2026 e
-- os demais no dia 15 dos meses subsequentes (até 15/02/2027).
-- Mantém o padrão do registro: entrada embutida na P1 (down_payment = 0).
-- Datas de pagamento dos boletos 06/07/08 não informadas → assumidas = vencimento.

UPDATE public.students
SET
  sale_value         = 16230.50,
  down_payment       = 0,
  installment_value  = 1323.05,
  total_installments = 11,
  paid_installments  = 5,
  due_day            = 15,
  status             = 'Em Dia',
  status_mode        = 'Automático',
  installments = '[
    {"number": 1,  "value": 3000,    "paid": true,  "dueDate": "2026-04-19", "paidDate": "2026-04-20",
     "tags": ["6618a678-280e-4b76-8cd2-f2872d8406c0", "313c5b97-5823-4d57-87e4-8c0611a58acd"]},
    {"number": 2,  "value": 1323.05, "paid": true,  "dueDate": "2026-05-19", "paidDate": "2026-07-10",
     "tags": ["87e96ab4-bba7-4b76-95d8-f63098555638"]},
    {"number": 3,  "value": 1323.05, "paid": true,  "dueDate": "2026-06-15", "paidDate": "2026-06-15",
     "tags": ["87e96ab4-bba7-4b76-95d8-f63098555638"]},
    {"number": 4,  "value": 1323.05, "paid": true,  "dueDate": "2026-07-15", "paidDate": "2026-07-15",
     "tags": ["87e96ab4-bba7-4b76-95d8-f63098555638"]},
    {"number": 5,  "value": 1323.05, "paid": true,  "dueDate": "2026-08-15", "paidDate": "2026-08-15",
     "tags": ["87e96ab4-bba7-4b76-95d8-f63098555638"]},
    {"number": 6,  "value": 1323.05, "paid": false, "dueDate": "2026-09-15"},
    {"number": 7,  "value": 1323.05, "paid": false, "dueDate": "2026-10-15"},
    {"number": 8,  "value": 1323.05, "paid": false, "dueDate": "2026-11-15"},
    {"number": 9,  "value": 1323.05, "paid": false, "dueDate": "2026-12-15"},
    {"number": 10, "value": 1323.05, "paid": false, "dueDate": "2027-01-15"},
    {"number": 11, "value": 1323.05, "paid": false, "dueDate": "2027-02-15"}
  ]'::jsonb,
  history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Fluxo de pagamento corrigido: entrada R$ 3.000,00 + boleto 10x R$ 1.323,05 (contrato R$ 16.230,50). Pagos: entrada e boletos 05/06/07/08-2026. Próximo vencimento 15/09/2026, demais todo dia 15 até 02/2027.'
  )),
  updated_at = now()
WHERE id = '81a7dc2b-ca05-416c-8f65-420c0f74cfd9'
  AND company_id = '00000000-0000-0000-0000-0000000a1a11'
  AND product = 'Missão Governar';
