// Edge function ÚNICA — migra os registros de public.app_users para auth.users + profiles + user_roles.
// Roda apenas se nenhum profile existir ainda (proteção contra re-execução acidental).
// verify_jwt = false (bootstrap; protegido pela checagem "profiles vazio").

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface AppUserRow {
  id: string;
  login: string;
  name: string;
  password: string;
  role: string;
  ac_id: string | null;
  photo: string | null;
  permissions: Record<string, unknown> | null;
}

function roleToEnum(role: string): string[] {
  // Mapeia o role legado para a(s) role(s) novas
  const r = (role || '').toLowerCase().trim();
  if (r === 'admin') return ['admin'];
  if (r === 'ac' || r === 'assessor' || r === 'gestor') return ['ac'];
  if (r === 'financeiro' || r === 'financial') return ['financeiro'];
  if (r === 'conciliacao' || r === 'conciliação') return ['conciliacao'];
  if (r === 'juridico' || r === 'jurídico') return ['juridico'];
  // fallback seguro
  return ['ac'];
}

function loginToEmail(login: string): string {
  const trimmed = (login || '').trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return `${trimmed.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@app.local`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Lê opção do body
    let body: { promote_first_to_admin?: string; dry_run?: boolean } = {};
    try { body = await req.json(); } catch (_) { /* no body ok */ }
    const dryRun = body.dry_run === true;
    const promoteLogin = body.promote_first_to_admin?.trim().toLowerCase();

    // Proteção: só roda se ainda não houver profiles
    const { count: existingProfiles, error: countErr } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true });
    if (countErr) throw countErr;
    if ((existingProfiles ?? 0) > 0 && !dryRun) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Migração já foi executada — existem perfis no sistema. Para rodar de novo, limpe as tabelas profiles e user_roles manualmente.',
        profiles_existentes: existingProfiles,
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Busca todos os app_users
    const { data: appUsers, error: auErr } = await admin.from('app_users').select('*');
    if (auErr) throw auErr;
    if (!appUsers || appUsers.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Nenhum app_user encontrado.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const log: Array<{ login: string; email: string; status: 'ok' | 'skip' | 'error'; message?: string; auth_id?: string; roles?: string[]; promoted_admin?: boolean }> = [];

    for (const row of appUsers as AppUserRow[]) {
      const email = loginToEmail(row.login);
      const baseRoles = roleToEnum(row.role);
      const shouldPromote = promoteLogin && row.login.trim().toLowerCase() === promoteLogin;
      const finalRoles = shouldPromote && !baseRoles.includes('admin') ? [...baseRoles, 'admin'] : baseRoles;

      if (dryRun) {
        log.push({ login: row.login, email, status: 'ok', message: 'dry-run', roles: finalRoles, promoted_admin: shouldPromote });
        continue;
      }

      // Cria auth.user com a senha atual (Supabase faz hash bcrypt)
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: row.password || crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { name: row.name, login: row.login },
      });

      if (createErr || !created.user) {
        log.push({ login: row.login, email, status: 'error', message: createErr?.message ?? 'createUser falhou' });
        continue;
      }

      const newId = created.user.id;

      // Upsert no profile (trigger já criou linha vazia)
      const { error: upErr } = await admin.from('profiles').upsert({
        id: newId,
        name: row.name,
        login: row.login,
        ac_id: row.ac_id,
        photo: row.photo,
        permissions: row.permissions ?? {},
      }, { onConflict: 'id' });
      if (upErr) {
        log.push({ login: row.login, email, status: 'error', message: `profile upsert: ${upErr.message}`, auth_id: newId });
        continue;
      }

      // Insere papéis
      const rolesRows = finalRoles.map((r) => ({ user_id: newId, role: r }));
      const { error: rolesErr } = await admin.from('user_roles').insert(rolesRows);
      if (rolesErr) {
        log.push({ login: row.login, email, status: 'error', message: `user_roles: ${rolesErr.message}`, auth_id: newId });
        continue;
      }

      log.push({ login: row.login, email, status: 'ok', auth_id: newId, roles: finalRoles, promoted_admin: shouldPromote });
    }

    const counts = {
      total: log.length,
      ok: log.filter((l) => l.status === 'ok').length,
      error: log.filter((l) => l.status === 'error').length,
    };

    return new Response(JSON.stringify({ ok: true, dry_run: dryRun, counts, log }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
