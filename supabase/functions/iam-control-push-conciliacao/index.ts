// GC → IAM Control: avisa que um contrato foi conciliado no GC.
//
// Disparado (fire-and-forget) quando a fila "IAM CONTROL → GC" aprova/concilia
// um contrato (iam_gc_conciliado_at preenchido). Envia ao IAM Control o
// contrato com status_conciliacao = CONCILIADO para o status lá acompanhar o GC.
//
// Body:
//   { student_id: uuid }            — um contrato
//   { student_ids: uuid[] }         — vários
//   { ..., conciliado_por?: string, conciliado_em?: iso }
//                                   — quem/quando aprovou no GC. O front manda
//                                     isso porque a gravação de
//                                     iam_gc_conciliado_at pode ainda não ter
//                                     chegado ao banco quando a função roda.
//   { ..., probe: true }            — só testa os endpoints do IAM e devolve as
//                                     respostas brutas; não grava histórico.
//
// O IAM Control expõe os webhooks em /webhooks/gestao-contas/*. Como o endpoint
// de conciliação de contrato pode variar entre versões do backend do IAM, a
// função tenta as rotas abaixo em ordem e usa a primeira que existir
// (qualquer resposta que não seja 404/405):
//   1. POST /webhooks/gestao-contas/contratos/conciliar      { itens: [...] }
//   2. POST /webhooks/gestao-contas/contrato/{id}/conciliar  { ...item }
//   3. PATCH /webhooks/gestao-contas/contrato/{id}           { status_conciliacao }
// Item enviado:
//   { contrato_id, iam_control_aluno_id, gestao_contas_student_id, treinamento,
//     status_conciliacao: 'CONCILIADO', conciliado_em, conciliado_por }
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TIMEOUT_MS = 20_000;

interface StudentRow {
  id: string;
  name: string | null;
  product: string | null;
  iam_control_aluno_id: number | null;
  iam_control_contrato_id: string | null;
  iam_control_contrato_status: string | null;
  iam_gc_conciliado_at: string | null;
  history: unknown;
}


interface ItemConciliacao {
  contrato_id: string;
  iam_control_aluno_id: number;
  gestao_contas_student_id: string;
  treinamento: string;
  status_conciliacao: 'CONCILIADO';
  conciliado_em: string;
  conciliado_por: string;
}

interface Tentativa {
  rota: string;
  metodo: string;
  http: number;
  corpo: string;
}

interface ResultadoAluno {
  student_id: string;
  nome: string;
  contrato_id: string | null;
  ok: boolean;
  motivo: string;
  tentativas: Tentativa[];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Extrai o revisor da última entrada de histórico "aprovado na Conciliação por X". */
function revisorDoHistorico(history: unknown): string {
  if (!Array.isArray(history)) return 'Conciliação GC';
  for (let i = history.length - 1; i >= 0; i--) {
    const text = String((history[i] as { text?: unknown })?.text ?? '');
    const m = text.match(/aprovad[oa] na Conciliação por (.+?)\.\s*Passa/i) ?? text.match(/\(por (.+?)\)/);
    if (m?.[1]) return m[1].trim();
  }
  return 'Conciliação GC';
}

async function chamarIam(
  apiUrl: string,
  token: string,
  metodo: string,
  rota: string,
  body: unknown,
): Promise<Tentativa> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${apiUrl}${rota}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-webhook-token': token },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const corpo = (await res.text().catch(() => '')).slice(0, 600);
    return { rota, metodo, http: res.status, corpo };
  } catch (e) {
    return { rota, metodo, http: 0, corpo: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Rota inexistente nesta versão do backend IAM → tenta a próxima. */
const rotaInexistente = (t: Tentativa) => t.http === 404 || t.http === 405 || t.http === 0;

async function enviarConciliacao(apiUrl: string, token: string, item: ItemConciliacao): Promise<{ ok: boolean; tentativas: Tentativa[] }> {
  const tentativas: Tentativa[] = [];
  const id = encodeURIComponent(item.contrato_id);

  const planos: Array<[string, string, unknown]> = [
    ['POST', '/webhooks/gestao-contas/contratos/conciliar', { itens: [item] }],
    ['POST', `/webhooks/gestao-contas/contrato/${id}/conciliar`, item],
    ['PATCH', `/webhooks/gestao-contas/contrato/${id}`, { status_conciliacao: item.status_conciliacao, conciliado_em: item.conciliado_em, conciliado_por: item.conciliado_por }],
  ];

  for (const [metodo, rota, body] of planos) {
    const t = await chamarIam(apiUrl, token, metodo, rota, body);
    tentativas.push(t);
    if (rotaInexistente(t)) continue;
    return { ok: t.http >= 200 && t.http < 300, tentativas };
  }
  return { ok: false, tentativas };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST.' });

  const apiUrl = (Deno.env.get('IAM_CONTROL_API_URL') ?? 'https://iamcontrol.com.br/api').replace(/\/+$/, '');
  const token = Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '';
  if (!token) return json(500, { ok: false, error: 'IAM_CONTROL_WEBHOOK_TOKEN não configurado.' });

  let ids: string[] = [];
  let probe = false;
  let conciliadoPorBody = '';
  let conciliadoEmBody = '';
  try {
    const corpo = await req.json();
    if (typeof corpo?.student_id === 'string') ids.push(corpo.student_id);
    if (Array.isArray(corpo?.student_ids)) ids.push(...corpo.student_ids.filter((v: unknown) => typeof v === 'string'));
    probe = corpo?.probe === true;
    if (typeof corpo?.conciliado_por === 'string') conciliadoPorBody = corpo.conciliado_por.trim();
    if (typeof corpo?.conciliado_em === 'string' && !Number.isNaN(new Date(corpo.conciliado_em).getTime())) {
      conciliadoEmBody = new Date(corpo.conciliado_em).toISOString();
    }
  } catch {
    /* sem body */
  }
  ids = [...new Set(ids)];
  if (ids.length === 0) return json(400, { ok: false, error: 'Informe student_id ou student_ids.' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await supabase
    .from('students')
    .select('id, name, product, iam_control_aluno_id, iam_control_contrato_id, iam_control_contrato_status, iam_gc_conciliado_at, history')
    .in('id', ids);
  if (error) return json(500, { ok: false, error: error.message });

  const resultados: ResultadoAluno[] = [];
  for (const row of (data ?? []) as StudentRow[]) {
    const base = { student_id: row.id, nome: row.name ?? '', contrato_id: row.iam_control_contrato_id };
    if (row.iam_control_aluno_id == null || !row.iam_control_contrato_id) {
      resultados.push({ ...base, ok: false, motivo: 'ficha sem iam_control_aluno_id/contrato_id — não é contrato IAM', tentativas: [] });
      continue;
    }
    // Aprovado no GC = flag no banco OU o front acabou de aprovar (body).
    const conciliadoEm = row.iam_gc_conciliado_at ?? conciliadoEmBody;
    if (!conciliadoEm && !probe) {
      resultados.push({ ...base, ok: false, motivo: 'contrato ainda não aprovado no GC (iam_gc_conciliado_at vazio)', tentativas: [] });
      continue;
    }

    const item: ItemConciliacao = {
      contrato_id: String(row.iam_control_contrato_id),
      iam_control_aluno_id: Number(row.iam_control_aluno_id),
      gestao_contas_student_id: row.id,
      treinamento: row.product ?? '',
      status_conciliacao: 'CONCILIADO',
      conciliado_em: conciliadoEm || new Date().toISOString(),
      conciliado_por: conciliadoPorBody || revisorDoHistorico(row.history),
    };

    const { ok, tentativas } = await enviarConciliacao(apiUrl, token, item);
    const ultima = tentativas[tentativas.length - 1];
    const semEndpoint = !ok && tentativas.every(rotaInexistente);
    const motivo = ok
      ? `IAM Control confirmou (${ultima.metodo} ${ultima.rota} → ${ultima.http})`
      : semEndpoint
        ? 'IAM Control não expõe endpoint de conciliação de contrato (404/405 em todas as rotas)'
        : `IAM Control recusou (${ultima.metodo} ${ultima.rota} → HTTP ${ultima.http}): ${ultima.corpo.slice(0, 200)}`;
    resultados.push({ ...base, ok, motivo, tentativas });

    // Sem endpoint no backend do IAM: só loga — não enche o histórico de toda
    // ficha aprovada com um aviso até o IAM publicar a rota.
    if (semEndpoint) {
      console.warn(`[iam-control-push-conciliacao] ${row.name} contrato ${item.contrato_id}: ${motivo}`);
      continue;
    }

    if (!probe) {
      const texto = ok
        ? `IAM Control atualizado: contrato ${item.contrato_id} marcado como CONCILIADO (espelho da aprovação no GC).`
        : `IAM Control NÃO atualizado — ${motivo}. Status do contrato ${item.contrato_id} segue manual no IAM.`;
      // Append atômico: o front pode estar gravando o histórico da aprovação
      // neste mesmo instante; reescrever o array aqui perderia uma das entradas.
      const { error: histErr } = await supabase.rpc('student_history_append', { p_student_id: row.id, p_text: texto });
      if (histErr) console.warn('[iam-control-push-conciliacao] histórico não gravado:', histErr.message);
    }
  }

  const encontrados = new Set(resultados.map((r) => r.student_id));
  for (const id of ids) {
    if (!encontrados.has(id)) resultados.push({ student_id: id, nome: '', contrato_id: null, ok: false, motivo: 'ficha não encontrada', tentativas: [] });
  }

  return json(200, {
    ok: resultados.some((r) => r.ok),
    probe,
    enviados: resultados.filter((r) => r.ok).length,
    falhas: resultados.filter((r) => !r.ok).length,
    resultados,
  });
});
