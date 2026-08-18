UPDATE public.cancellation_cases SET inscricoes_revertidas = 1, updated_at = now() WHERE id = '6804c7f9-85f9-41de-9b9a-7901f730f9df' AND inscricoes_revertidas = 0;

INSERT INTO public.commissions (company_id, cancellation_case_id, student_id, student_name, ac_id, ac_name, payment_type, reverted_value, percent, value, status, pending_approval, product)
SELECT '00000000-0000-0000-0000-0000000a1a11', '6804c7f9-85f9-41de-9b9a-7901f730f9df', '419d06a1-0c2b-4410-a13f-505e6a412ba6', 'Viviane Cristina dos Santos Teodoro', 'e6336188-785a-4d8a-8ad1-d150353edd3d', 'Paula Passini', 'boleto', 14300, 0.5, 71.50, 'pendente', true, 'Confronto'
WHERE NOT EXISTS (SELECT 1 FROM public.commissions c WHERE c.cancellation_case_id = '6804c7f9-85f9-41de-9b9a-7901f730f9df' AND c.status <> 'cancelada');