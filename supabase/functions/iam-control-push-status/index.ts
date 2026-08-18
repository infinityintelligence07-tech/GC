import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const IAM_URL = Deno.env.get('IAM_CONTROL_API_URL') ?? '';
const IAM_TOKEN = Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BATCH = 500;
const PAGE = 1000;

type Row = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  cpf: string | null;
  address: string | null;
  numero: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  status: string | null;
  status_cancelamento: string | null;
  iam_control_aluno_id: number | null;
};

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const INADIMPLENTE_SET = new Set([
  'vencido 1',
  'vencido1',
  'vencido 2',
  'vencido2',
  'a negativar',
  'anegativar',
  'negativado',
  'pendente',
]);

function isInadimplente(r: Row): boolean {
  const st = norm(r.status);
  if (!st) return false;
  return INADIMPLENTE_SET.has(st) || st.includes('inadimpl');
}

function isEmCancelamento(r: Row): boolean {
  const sc = norm(r.status_cancelamento);
  const st = norm(r.status);
  if (sc && ['cancelado', 'solicitado', 'aguardando_conciliacao', 'aguardando conciliacao'].includes(sc)) return true;
  if (sc.includes('cancel')) return true;
  if (st.includes('cancel')) return true;
  return false;
}

/** Telefone: só dígitos, remove 55 (12–13 dígitos), insere 9 quando tem 10 dígitos. */
function normalizePhone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10) d = d.slice(0, 2) + '9' + d.slice(2);
  return d;
}

const DOMAIN_FIXES: Record<string, string> = {
  'gmai.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gamil.com': 'gmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'yaho.com': 'yahoo.com',
};

function normalizeEmail(raw: unknown): string {
  const e = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!e || !e.includes('@')) return '';
  const [user, ...rest] = e.split('@');
  let domain = rest.join('@');
  if (DOMAIN_FIXES[domain]) domain = DOMAIN_FIXES[domain];
  const fixed = `${user}@${domain}`;
  return /^[^@\s]+@[^@\s.]+\.[a-z]{2,}$/.test(fixed) ? fixed : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    if (!IAM_URL || !IAM_TOKEN) {
      return json({ error: 'IAM_CONTROL_API_URL/IAM_CONTROL_WEBHOOK_TOKEN não configurados' }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    let studentIds: string[] | null = null;
    try {
      const raw = await req.text();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.student_ids)) {
          studentIds = parsed.student_ids.filter((v: unknown) => typeof v === 'string');
        }
      }
    } catch (_) {
      /* sem body */
    }

    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from('students')
        .select('id, name, email, whatsapp, cpf, address, numero, cidade, estado, cep, status, status_cancelamento, iam_control_aluno_id')
        .range(from, from + PAGE - 1);
      if (studentIds && studentIds.length > 0) q = q.in('id', studentIds);

      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
    }

    const porAlunoEspecifico = Boolean(studentIds && studentIds.length > 0);
    const alvos = porAlunoEspecifico ? rows : rows.filter((r) => isInadimplente(r) && !isEmCancelamento(r));

    let telefones_normalizados = 0;
    let emails_normalizados = 0;
    let sem_telefone = 0;

    const itens = alvos.map((r) => {
      const telOriginal = String(r.whatsapp ?? '').replace(/\D/g, '');
      const telefone = normalizePhone(r.whatsapp);
      if (telefone && telefone !== telOriginal) telefones_normalizados++;
      if (!telefone) sem_telefone++;

      const emailOriginal = String(r.email ?? '').trim();
      const email = normalizeEmail(r.email);
      if (email && email !== emailOriginal.toLowerCase()) emails_normalizados++;

      const item: Record<string, unknown> = {
        ...(r.iam_control_aluno_id != null ? { iam_control_aluno_id: r.iam_control_aluno_id } : {}),
        gestao_contas_student_id: r.id,
        nome: r.name ?? '',
        ...(email ? { email } : {}),
        telefone,
        ...(r.cpf ? { cpf: r.cpf } : {}),
        ...(r.cep ? { cep: r.cep } : {}),
        ...(r.address ? { logradouro: r.address } : {}),
        ...(r.numero ? { numero: r.numero } : {}),
        ...(r.cidade ? { cidade: r.cidade } : {}),
        ...(r.estado ? { estado: r.estado } : {}),
      };

      if (isEmCancelamento(r)) {
        item.status = r.status_cancelamento || r.status || 'Cancelado';
      } else if (isInadimplente(r)) {
        item.status = 'Inadimplente';
        item.inadimplente = true;
      } else if (porAlunoEspecifico && r.status) {
        item.status = r.status;
        item.inadimplente = false;
      }

      return item;
    });

    const byId = new Map(itens.map((it) => [String(it.gestao_contas_student_id), it]));

    let enviados = 0;
    let atualizados = 0;
    let sem_alteracao = 0;
    let nao_encontrados = 0;
    let ambiguos = 0;
    let lotes = 0;
    const erros: string[] = [];
    const listaAmbiguos: Record<string, unknown>[] = [];
    const listaNaoEncontrados: Record<string, unknown>[] = [];
    let respostaBruta = '';

    const url = `${IAM_URL.replace(/\/$/, '')}/webhooks/gestao-contas/status`;

    for (let i = 0; i < itens.length; i += BATCH) {
      const lote = itens.slice(i, i + BATCH);
      lotes++;
      const send = (payload: unknown) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-webhook-token': IAM_TOKEN },
          body: JSON.stringify(payload),
        });

      let res = await send(porAlunoEspecifico ? { itens: lote } : { somente_inadimplentes: true, itens: lote });
      let text = await res.text();
      if (!res.ok && text.includes('somente_inadimplentes')) {
        res = await send({ itens: lote });
        text = await res.text();
      }

      if (!res.ok) {
        erros.push(`lote ${lotes}: HTTP ${res.status} ${text.slice(0, 200)}`);
        continue;
      }

      enviados += lote.length;
      if (!respostaBruta) respostaBruta = text.slice(0, 4000);

      try {
        const parsed = JSON.parse(text);
        const lista: Record<string, unknown>[] = Array.isArray(parsed)
          ? parsed
          : (parsed?.resultados ?? parsed?.itens ?? parsed?.detalhes ?? parsed?.results ?? []);

        let contouPorItem = false;
        for (const r of lista ?? []) {
          contouPorItem = true;
          const resultado = norm(
            (r as any)?.resultado ?? (r as any)?.status_processamento ?? (r as any)?.result ?? '',
          );
          const gid = String((r as any)?.gestao_contas_student_id ?? '');
          const orig = byId.get(gid);
          const mensagem =
            (r as any)?.mensagem ?? (r as any)?.message ?? (r as any)?.motivo ?? (r as any)?.detalhe ?? '';

          if (resultado.includes('nao_encontrado') || resultado.includes('not_found')) {
            nao_encontrados++;
            listaNaoEncontrados.push({
              gestao_contas_student_id: gid,
              nome: orig?.nome ?? (r as any)?.nome ?? '',
              telefone: orig?.telefone ?? '',
              email: orig?.email ?? '',
              mensagem_iam: mensagem,
            });
          } else if (resultado.includes('ambiguo') || resultado.includes('ambiguous')) {
            ambiguos++;
            {
              listaAmbiguos.push({
                gestao_contas_student_id: gid,
                nome: orig?.nome ?? (r as any)?.nome ?? '',
                telefone: orig?.telefone ?? '',
                email: orig?.email ?? '',
                mensagem_iam: mensagem,
                ids_conflitantes:
                  (r as any)?.ids ?? (r as any)?.conflitos ?? (r as any)?.alunos_ids ?? null,
              });
            }
          } else if (resultado.includes('sem_alteracao') || resultado.includes('inalterado')) {
            sem_alteracao++;
          } else {
            atualizados++;
          }
        }

        if (!contouPorItem) {
          if (typeof parsed?.atualizados === 'number') atualizados += parsed.atualizados;
          if (typeof parsed?.sem_alteracao === 'number') sem_alteracao += parsed.sem_alteracao;
          if (typeof parsed?.nao_encontrados === 'number') nao_encontrados += parsed.nao_encontrados;
          if (typeof parsed?.ambiguos === 'number') ambiguos += parsed.ambiguos;
        }
      } catch (_) {
        /* resposta sem JSON estruturado */
      }
    }

    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvLines = ['tipo,gestao_contas_student_id,nome,telefone,email,mensagem_iam,ids_conflitantes'];
    for (const r of listaNaoEncontrados) {
      csvLines.push(
        ['nao_encontrado', r.gestao_contas_student_id, r.nome, r.telefone, r.email, r.mensagem_iam, '']
          .map(esc)
          .join(','),
      );
    }
    for (const r of listaAmbiguos) {
      let ids = Array.isArray(r.ids_conflitantes)
        ? (r.ids_conflitantes as unknown[]).join(' ')
        : String(r.ids_conflitantes ?? '');
      if (!ids) {
        const m = String(r.mensagem_iam ?? '').match(/\d+/g);
        ids = m ? m.join(' ') : '';
      }
      csvLines.push(
        ['ambiguo', r.gestao_contas_student_id, r.nome, r.telefone, r.email, r.mensagem_iam, ids]
          .map(esc)
          .join(','),
      );
    }
    const csv = csvLines.join('\n');

    return json({
      csv,
      resumo: {
        total: itens.length,
        enviados,
        atualizados,
        sem_alteracao,
        nao_encontrados,
        ambiguos,
        lotes,
        erros: erros.length,
        ocorrencias: erros.slice(0, 25),
        telefones_normalizados,
        emails_normalizados,
        sem_telefone,
      },
      ambiguos_restantes: listaAmbiguos,
      nao_encontrados_restantes: listaNaoEncontrados,
      resposta_iam: respostaBruta,
    });
  } catch (err) {
    console.error('[iam-control-push-status]', err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
