// Helper compartilhado: valida que o chamador da edge function tem role 'admin'.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export interface CallerContext {
  url: string;
  serviceKey: string;
  callerUserId: string;
  admin: ReturnType<typeof createClient>;
}

export async function requireAdmin(req: Request): Promise<CallerContext | Response> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'Sem token de autenticação' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Valida JWT chamando o auth com a anon key
  const anon = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ ok: false, error: 'Token inválido' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const callerUserId = userData.user.id;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Checa role admin
  const { data: roleRow, error: roleErr } = await admin
    .from('user_roles').select('role').eq('user_id', callerUserId).eq('role', 'admin').maybeSingle();
  if (roleErr || !roleRow) {
    return new Response(JSON.stringify({ ok: false, error: 'Acesso restrito a administradores' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return { url, serviceKey, callerUserId, admin };
}
