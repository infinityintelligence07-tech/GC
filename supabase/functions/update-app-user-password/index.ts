// Troca a senha de um usuário. Apenas admin pode chamar.
import { requireAdmin, corsHeaders } from '../_shared/admin-guard.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const guard = await requireAdmin(req);
  if (guard instanceof Response) return guard;
  const { admin } = guard;

  try {
    const { app_user_id, password } = await req.json();
    if (!app_user_id || !password) {
      return new Response(JSON.stringify({ ok: false, error: 'app_user_id e password obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: row, error } = await admin.from('app_users').select('auth_user_id').eq('id', app_user_id).single();
    if (error || !row?.auth_user_id) {
      return new Response(JSON.stringify({ ok: false, error: 'Usuário não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(row.auth_user_id, { password });
    if (updErr) {
      return new Response(JSON.stringify({ ok: false, error: updErr.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
