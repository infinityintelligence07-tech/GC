-- O bucket cancellation-docs tinha políticas RLS mas nunca foi criado,
-- causando "Bucket not found" ao anexar PDFs em Cancelamentos.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cancellation-docs', 'cancellation-docs', false, 15728640)
ON CONFLICT (id) DO NOTHING;
