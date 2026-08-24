-- Reprocessa vendas IAM das últimas 24h (ex.: pendente link/pix que não entrou no GC).
UPDATE public.iam_control_sync_state
SET last_synced_at = now() - interval '24 hours',
    last_result = coalesce(last_result, '{}'::jsonb) || jsonb_build_object('reset_motivo', 'reprocessar_pendentes_24h')
WHERE id = 'clientes';
