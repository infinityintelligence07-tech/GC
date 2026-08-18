// Cria um novo usuário (auth + app_users + user_roles). Apenas admin pode chamar.
import { requireAdmin, corsHeaders } from '../_shared/admin-guard.ts';

function loginToEmail(login: string): string {
  const t = (login || '').trim().toLowerCase();
  if (t.includes('@')) return t;
  return `${t.replace(/[^a-z0-9._-]/g, '')}@app.local`;
}

const ROLE_TO_ENUM: Record<string, string[]> = {
  admin: ['admin'], ac: ['ac'], acn2: ['ac'],
  financeiro: ['financeiro'], financial: ['financeiro'],
  conciliacao: ['conciliacao'], juridico: ['juridico'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const guard = await requireAdmin(req);
  if (guard instanceof Response) return guard;
  const { admin, callerUserId } = guard;

  try {
    const body = await req.json();
    const { name, login, password, role, ac_id, photo, permissions, company_id: bodyCompanyId } = body ?? {};
    if (!name || !login || !password || !role) {
      return new Response(JSON.stringify({ ok: false, error: 'name, login, password, role obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Resolve company_id explicitamente — service-role não enxerga auth.uid(),
    // então a default current_company_id() retorna NULL e quebra o NOT NULL.
    let companyId: string | null = bodyCompanyId ?? null;
    if (!companyId) {
      const { data: activeRow } = await admin
        .from('user_active_company')
        .select('company_id')
        .eq('user_id', callerUserId)
        .maybeSingle();
      companyId = (activeRow as any)?.company_id ?? null;
    }
    if (!companyId) {
      const { data: anyCompany } = await admin
        .from('user_companies')
        .select('company_id')
        .eq('user_id', callerUserId)
        .limit(1)
        .maybeSingle();
      companyId = (anyCompany as any)?.company_id ?? null;
    }
    if (!companyId) {
      return new Response(JSON.stringify({ ok: false, error: 'Não foi possível identificar a empresa ativa do administrador.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const email = loginToEmail(login);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { name, login },
    });
    if (createErr || !created.user) {
      return new Response(JSON.stringify({ ok: false, error: createErr?.message ?? 'createUser falhou' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const authId = created.user.id;

    // Insere app_users (company_id explícito — ver comentário acima)
    const { data: row, error: insertErr } = await admin
      .from('app_users')
      .insert({ name, login, role, ac_id, photo, permissions, auth_user_id: authId, company_id: companyId })
      .select().single();
    if (insertErr) {
      // rollback auth.user
      await admin.auth.admin.deleteUser(authId).catch(() => {});
      return new Response(JSON.stringify({ ok: false, error: insertErr.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Roles
    const enumRoles = ROLE_TO_ENUM[String(role).toLowerCase()] ?? ['ac'];
    const rolesPayload = enumRoles.map((r) => ({ user_id: authId, role: r }));
    await admin.from('user_roles').insert(rolesPayload);

    return new Response(JSON.stringify({ ok: true, row }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
