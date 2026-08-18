// Apaga usuário (auth.users + app_users em cascata). Apenas admin pode chamar.
import { requireAdmin, corsHeaders } from '../_shared/admin-guard.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const guard = await requireAdmin(req);
  if (guard instanceof Response) return guard;
  const { admin } = guard;

  try {
    const { app_user_id } = await req.json();
    const { data: row, error } = await admin.from('app_users').select('auth_user_id').eq('id', app_user_id).single();
    if (error || !row) {
      return new Response(JSON.stringify({ ok: false, error: 'Usuário não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (row.auth_user_id) {
      await admin.auth.admin.deleteUser(row.auth_user_id).catch(() => {});
    }
    await admin.from('app_users').delete().eq('id', app_user_id);
    return new Response(JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
