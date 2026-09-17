import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/store/useAppStore';
import type { Student } from '@/types';
import type { CancellationTermoDocument } from '@/lib/cancellationTermoDocument';
import { templateTextToZapSignMarkdown } from '@/lib/templateRender';

/**
 * Integração direta com a ZapSign (edge functions `zapsign-termo` e `zapsign-webhook`).
 *
 * O termo é enviado como Markdown — a ZapSign gera o PDF, cria o documento e devolve os links
 * de assinatura (aluno + Instituto). O status final chega pelo webhook e fica em `zapsign_documents`;
 * `getZapSignTermoStatus` lê primeiro do banco e só consulta a ZapSign se ainda pendente.
 */

export type ZapSignTermoTipo = 'cancelamento' | 'renegociacao' | 'aditivo' | 'outro';

export interface ZapSignTermoSigner {
  nome: string;
  email: string;
  status: string;
  tipo: 'sign' | 'witness';
  /** Quem assina: aluno (1º) ou instituto/IAM (2º). */
  papel?: 'aluno' | 'instituto';
  signed_at?: string | null;
  sign_url?: string;
}

export interface ZapSignTermoResult {
  ok: boolean;
  /** Token do documento na ZapSign (usar em `getZapSignTermoStatus`). */
  id?: string;
  nome_documento?: string;
  status?: string;
  /** Link do aluno (1º signatário). */
  url_assinatura?: string;
  /** Link do Instituto / IAM (2º signatário). */
  url_assinatura_iam?: string;
  file_url?: string;
  signers?: ZapSignTermoSigner[];
  signed_at?: string | null;
  signed_file_path?: string | null;
  created_at?: string;
  error?: string;
  detalhe?: string;
}

export const INSTITUTO_RAZAO = 'INSTITUTO ACADEMY MIND TREINAMENTOS LTDA';
export const INSTITUTO_CNPJ = '03.727.532/0001-13';
/** Âncoras de posicionamento das assinaturas na ZapSign (criadas na edge `zapsign-termo`). */
export const ZAPSIGN_ANCHOR_ALUNO = '<<gc_aluno>>';
export const ZAPSIGN_ANCHOR_IAM = '<<gc_instituto>>';
const INSTITUTO_QUALIFICACAO =
  `${INSTITUTO_RAZAO}, pessoa jurídica de direito privado, inscrita no CNPJ nº ${INSTITUTO_CNPJ}, ` +
  'com sede na R. Major Rehder, 248 - Vila Rehder, Americana - SP, 13465-390';

/**
 * Sanitiza texto para o Markdown da ZapSign. O renderizador dela NÃO honra
 * escape com barra invertida (mostra o "\" literal) nem tabelas GFM, então
 * aqui só se neutralizam os caracteres que quebrariam a estrutura do documento
 * (pipe, quebras de linha e marcadores de bloco no início do texto).
 * HTML simples (table) é usado só no bloco de assinaturas — a ZapSign costuma
 * preservar tags HTML embutidas no markdown_text.
 */
function md(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '/')
    .replace(/^\s*([#>*+-]|\d+\.)\s+/, '')
    .trim();
}

function linhaCampo(rotulo: string, valor: string | null | undefined): string {
  return `**${rotulo}:** ${md(valor) || '—'}`;
}

/**
 * Bloco de assinaturas lado a lado (como no preview/PDF do GC).
 * Usa HTML table (markdown GFM `|` vira texto cru na ZapSign) + âncoras
 * `<<gc_aluno>>` / `<<gc_instituto>>` para a ZapSign posicionar as rubricas.
 * Sem underscores longos — eles viravam régua horizontal (---) no PDF.
 */
function blocoAssinaturas(nome: string, cpf: string): string {
  const nomeAluno = md(nome) || 'ALUNO(A)';
  const docAluno = md(cpf) || 'CPF —';
  return [
    '',
    '<table style="width:100%;border:none;border-collapse:collapse">',
    '<tr>',
    '<td style="width:48%;text-align:center;vertical-align:top;border:none;padding:12px 8px">',
    ZAPSIGN_ANCHOR_ALUNO,
    '<br/><br/>',
    `<strong>${nomeAluno}</strong><br/>`,
    docAluno,
    '</td>',
    '<td style="width:4%;border:none"></td>',
    '<td style="width:48%;text-align:center;vertical-align:top;border:none;padding:12px 8px">',
    ZAPSIGN_ANCHOR_IAM,
    '<br/><br/>',
    `<strong>${INSTITUTO_RAZAO}</strong><br/>`,
    `CNPJ ${INSTITUTO_CNPJ}`,
    '</td>',
    '</tr>',
    '</table>',
    '',
  ].join('');
}

/** Remove bloco final de linhas de assinatura (underscores + nomes) de modelos da aba Documentos. */
function stripTrailingSignatureBlock(markdown: string): string {
  const linhas = markdown.replace(/\r\n/g, '\n').split('\n');
  const isSigLine = (l: string) => {
    const t = l.replace(/\u00A0/g, '').trim();
    return /^_{8,}$/.test(t) || /^[-*]{3,}$/.test(t);
  };
  const isDocLabel = (l: string) => {
    const t = l.replace(/\*\*/g, '').trim();
    if (!t) return false;
    if (/^CNPJ\b/i.test(t)) return true;
    if (/^CPF\b/i.test(t)) return true;
    if (/instituto academy mind/i.test(t)) return true;
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(t)) return true;
    return false;
  };
  const isNameLike = (l: string) => {
    const t = l.replace(/\*\*/g, '').trim();
    if (!t || isDocLabel(l) || isSigLine(l)) return false;
    // Nome do aluno / razão social (sem pontuação de frase).
    return !/[.!?;:]/.test(t) && t.length >= 3 && t.length <= 120;
  };

  let end = linhas.length;
  while (end > 0 && !linhas[end - 1].trim()) end--;

  let start = end;
  let sawUnderline = false;
  /** Antes da 1ª linha de underscore (de baixo p/ cima): só CNPJ/Instituto/CPF. Depois: nomes também. */
  for (let k = end - 1; k >= 0; k--) {
    const raw = linhas[k];
    if (!raw.trim()) {
      start = k;
      continue;
    }
    if (isSigLine(raw)) {
      sawUnderline = true;
      start = k;
      continue;
    }
    if (isDocLabel(raw) || (sawUnderline && isNameLike(raw))) {
      start = k;
      continue;
    }
    break;
  }
  if (!sawUnderline) return markdown.trimEnd();
  return linhas.slice(0, start).join('\n').trimEnd();
}

/** Remove assinaturas antigas do markdown e anexa o bloco padronizado (âncoras + tabela). */
export function withZapSignAssinaturas(markdown: string, nome: string, cpf: string): string {
  return `${stripTrailingSignatureBlock(markdown)}\n${blocoAssinaturas(nome, cpf)}`;
}

/**
 * Termo de cancelamento em Markdown para a ZapSign — exatamente o conteúdo do
 * preview/PDF do GC (`buildCancellationTermoDocument`). Motivo e observações
 * jurídicas do caso são uso interno e NÃO entram no documento assinado.
 */
export function buildCancelamentoTermoMarkdown(doc: CancellationTermoDocument): string {
  // Modelo editado na aba Documentos: corpo do modelo + bloco de assinaturas padronizado.
  if (doc.templateText) {
    return withZapSignAssinaturas(templateTextToZapSignMarkdown(doc.templateText), doc.studentName, doc.cpf);
  }
  const partes: string[] = [
    `# ${md(doc.titulo)}`,
    '',
    linhaCampo('NOME COMPLETO', doc.studentName),
    linhaCampo('CPF', doc.cpf),
    linhaCampo('E-MAIL', doc.email),
    linhaCampo('WHATSAPP', doc.whatsapp),
    '',
    ...doc.paragraphs.flatMap((p) => [md(p), '']),
  ];
  if (doc.showBankBlock && doc.bankLines.length > 0) {
    partes.push('**DADOS BANCÁRIOS**', '', ...doc.bankLines.map((l) => `- ${md(l)}`), '');
  }
  partes.push(md(doc.localData), blocoAssinaturas(doc.studentName, doc.cpf));
  return partes.join('\n');
}

export interface RenegociacaoTermoMarkdownInput {
  student: Pick<Student, 'name' | 'cpf' | 'whatsapp' | 'email' | 'product'>;
  /** Data por extenso curta (dd/mm/aaaa) usada em "Americana, {data}". */
  dateStr: string;
  contratoAssinado: string;
  qtdInscricoes: number;
  totalContratado: number;
  totalPago: number;
  saldoAberto: number;
  qtdParcelasAberto: number;
  totalAposReneg: number;
  entradaLinha: string;
  primeiraParcelaVencimento?: string;
  diaVencimento: number;
  parcelamentoLines: string[];
  taxaJurosMes: number;
}

/** Termo de renegociação (mesmo conteúdo do preview/PDF do TermoAditivoModal) em Markdown. */
export function buildRenegociacaoTermoMarkdown(i: RenegociacaoTermoMarkdownInput): string {
  const s = i.student;
  return [
    '# TERMO DE RENEGOCIAÇÃO',
    '',
    'Pelo presente instrumento, o(a) ALUNO(A):',
    '',
    linhaCampo('NOME COMPLETO', s.name),
    linhaCampo('CPF/CNPJ', s.cpf),
    linhaCampo('WHATSAPP', s.whatsapp),
    linhaCampo('EMAIL', s.email),
    '',
    `E o ${md(INSTITUTO_QUALIFICACAO)}, **AJUSTAM SUA RELAÇÃO CONTRATUAL CONFORME A SEGUIR EXPOSTO.**`,
    '',
    `O(A) ALUNO(A) possui **${i.qtdInscricoes}** inscrição(ões) no treinamento **${md(s.product) || '—'}**, contrato assinado em **${md(i.contratoAssinado)}**.`,
    '',
    'O presente instrumento visa formalizar a renegociação realizada entre as partes referente ao montante pendente de pagamento pelo(a) ALUNO(a), de modo que as alterações de valores refletem a nova forma de pagamento, estando o(a) ALUNO(a) ciente e de acordo com as novas condições.',
    '',
    'Os demais termos aqui descritos seguem todo o disposto no contrato principal, em especial em relação a multa, correção monetária, juros e atualizações.',
    '',
    'As partes acordam a seguinte negociação:',
    '',
    '## Renegociação das parcelas ficando da seguinte forma',
    '',
    linhaCampo('TREINAMENTO', s.product),
    linhaCampo('TOTAL CONTRATADO', formatCurrency(i.totalContratado)),
    linhaCampo('TOTAL PAGO PELO ALUNO(A) ATÉ O MOMENTO', formatCurrency(i.totalPago)),
    linhaCampo('SALDO EM ABERTO DO CONTRATO', formatCurrency(i.saldoAberto)),
    linhaCampo('QUANTIDADE DE PARCELAS EM ABERTO', String(i.qtdParcelasAberto)),
    linhaCampo('TOTAL A SER PAGO APÓS A RENEGOCIAÇÃO', formatCurrency(i.totalAposReneg)),
    '',
    '## Novo parcelamento acordado',
    '',
    md(i.entradaLinha),
    '',
    `As demais parcelas serão conforme descrito abaixo e o primeiro vencimento será dia **${md(i.primeiraParcelaVencimento) || '—'}** e as demais parcelas vencerão no dia **${i.diaVencimento}** dos meses subsequentes.`,
    '',
    ...(i.parcelamentoLines.length > 0 ? i.parcelamentoLines.map((l) => `- ${md(l)}`) : ['- —']),
    '',
    linhaCampo('Taxa de juros aplicada ao mês', `${i.taxaJurosMes.toLocaleString('pt-BR')}%`),
    '',
    'Permanecem vigentes as demais cláusulas contratuais do instrumento anteriormente celebrado pelas partes naquilo que não estiver disposto no presente termo de renegociação.',
    '',
    'O INSTITUTO, somente após o recebimento da importância total dará ao ALUNO(A) a mais ampla, rasa, geral e irrevogável quitação de suas obrigações em relação ao treinamento contratado.',
    '',
    `Americana, ${md(i.dateStr)}.`,
    blocoAssinaturas(s.name, s.cpf),
  ].join('\n');
}

/** Só dígitos; garante DDI 55 para o wa.me. */
export function whatsappDigitsBR(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 12 && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export interface ZapSignSignerCheck {
  ok: boolean;
  motivo?: string;
  email?: string;
  whatsapp?: string;
}

/** Aluno precisa de e-mail ou WhatsApp para receber o link e a ZapSign aceitar o signatário. */
export function checkStudentZapSignSigner(
  student: Pick<Student, 'name' | 'email' | 'whatsapp'> | null | undefined,
): ZapSignSignerCheck {
  if (!student?.name?.trim()) return { ok: false, motivo: 'Aluno sem nome cadastrado.' };
  const email = (student.email ?? '').trim();
  const whatsapp = whatsappDigitsBR(student.whatsapp);
  if (!email && !whatsapp) {
    return { ok: false, motivo: 'Cadastre o e-mail ou o WhatsApp do aluno para enviar o termo para assinatura.' };
  }
  return { ok: true, email: email || undefined, whatsapp: whatsapp || undefined };
}

export interface CreateZapSignTermoInput {
  tipo: ZapSignTermoTipo;
  nomeDocumento: string;
  markdown: string;
  /** `id` ausente = aluno sem ficha no GC (dados preenchidos manualmente). */
  student: Pick<Student, 'name' | 'email' | 'whatsapp'> & { id?: string };
  cancellationCaseId?: string;
  /** ZapSign envia o link por e-mail automaticamente (grátis). */
  enviarEmail?: boolean;
  /** ZapSign envia por WhatsApp automaticamente (consome créditos ZapSign). */
  enviarWhatsapp?: boolean;
  mensagem?: string;
}

export async function createZapSignTermo(input: CreateZapSignTermoInput): Promise<ZapSignTermoResult> {
  const check = checkStudentZapSignSigner(input.student);
  if (!check.ok) return { ok: false, error: check.motivo };

  const { data, error } = await supabase.functions.invoke<ZapSignTermoResult>('zapsign-termo', {
    body: {
      action: 'create',
      tipo: input.tipo,
      nome_documento: input.nomeDocumento,
      markdown_text: input.markdown,
      student_id: input.student.id,
      cancellation_case_id: input.cancellationCaseId,
      signer: { name: input.student.name.trim(), email: check.email ?? '', phone: check.whatsapp ?? '' },
      enviar_email: input.enviarEmail === true,
      enviar_whatsapp: input.enviarWhatsapp === true,
      mensagem: input.mensagem,
    },
  });

  if (error) return { ok: false, error: error.message || 'Falha ao gerar termo na ZapSign.' };
  if (!data?.ok) {
    return { ok: false, error: data?.error || 'Não foi possível gerar o termo na ZapSign.', detalhe: data?.detalhe };
  }
  return data;
}

export async function getZapSignTermoStatus(docToken: string): Promise<ZapSignTermoResult> {
  const id = docToken.trim();
  if (!id) return { ok: false, error: 'ID do termo não informado.' };

  const { data, error } = await supabase.functions.invoke<ZapSignTermoResult>('zapsign-termo', {
    body: { action: 'status', id },
  });
  if (error) return { ok: false, error: error.message || 'Falha ao consultar status do termo.' };
  if (!data?.ok) {
    return { ok: false, error: data?.error || 'Não foi possível consultar o status do termo.', detalhe: data?.detalhe };
  }
  return data;
}

/**
 * Exclui o termo na ZapSign (soft delete: o link de assinatura deixa de valer).
 * Usado ao descartar um rascunho de renegociação com termo pendente. Termo já
 * assinado não é excluído (a edge function recusa com 409).
 */
export async function deleteZapSignTermo(docToken: string, motivo?: string): Promise<ZapSignTermoResult> {
  const id = docToken.trim();
  if (!id) return { ok: false, error: 'ID do termo não informado.' };

  const { data, error } = await supabase.functions.invoke<ZapSignTermoResult>('zapsign-termo', {
    body: { action: 'delete', id, motivo },
  });
  if (error) return { ok: false, error: error.message || 'Falha ao excluir o termo na ZapSign.' };
  if (!data?.ok) {
    return { ok: false, error: data?.error || 'Não foi possível excluir o termo na ZapSign.', detalhe: data?.detalhe };
  }
  return data;
}

/** Interpreta se o termo já foi assinado (status normalizado pela edge function). */
export function isZapSignTermoAssinado(
  result: Pick<ZapSignTermoResult, 'status' | 'signers'> | null | undefined,
): boolean {
  if (!result) return false;
  const status = String(result.status ?? '').toLowerCase();
  if (/^(signed|completed)$|assinad|conclu|finaliz/.test(status)) return true;
  const signers = result.signers ?? [];
  if (signers.length > 0) {
    const relevant = signers.filter((s) => s.tipo !== 'witness');
    const pool = relevant.length ? relevant : signers;
    return pool.every((s) => /signed|assinad|completed|conclu/.test(String(s.status ?? '').toLowerCase()));
  }
  return false;
}

export function isZapSignTermoRecusado(result: Pick<ZapSignTermoResult, 'status'> | null | undefined): boolean {
  return /^(refused|rejected|recusad)/.test(String(result?.status ?? '').toLowerCase());
}

/** Extrai links de assinatura do aluno e da IAM a partir do retorno da ZapSign. */
export function pickZapSignSignerUrls(
  result: Pick<ZapSignTermoResult, 'url_assinatura' | 'url_assinatura_iam' | 'signers' | 'file_url'> | null | undefined,
): { aluno: string; iam: string } {
  const signers = result?.signers ?? [];
  const alunoSigner =
    signers.find((s) => s.papel === 'aluno') ??
    signers.find((s) => !/instituto academy mind/i.test(s.nome)) ??
    signers[0];
  const iamSigner =
    signers.find((s) => s.papel === 'instituto') ??
    signers.find((s) => /instituto academy mind/i.test(s.nome)) ??
    signers[1];
  return {
    aluno: result?.url_assinatura || alunoSigner?.sign_url || result?.file_url || '',
    iam: result?.url_assinatura_iam || iamSigner?.sign_url || '',
  };
}

/** Texto do toast após gerar o termo, conforme os envios automáticos escolhidos. */
export function describeEnvioAutomatico(envio: { email?: string; whatsapp?: string }): string {
  const canais: string[] = [];
  if (envio.email) canais.push(`e-mail (${envio.email})`);
  if (envio.whatsapp) canais.push('WhatsApp');
  if (canais.length === 0) {
    return 'Termo gerado na ZapSign. Copie o link do aluno e o da IAM para assinar.';
  }
  return `Termo gerado na ZapSign e enviado ao aluno por ${canais.join(' e ')}. Copie também o link da IAM.`;
}

/** Mensagem pronta para o aluno com o link de assinatura. */
export function buildTermoWhatsAppMessage(opts: { nomeAluno: string; titulo: string; link: string }): string {
  const primeiro = opts.nomeAluno.trim().split(/\s+/)[0] || 'tudo bem';
  return (
    `Olá, ${primeiro}! Aqui é do Instituto Academy Mind.\n\n` +
    `Segue o link para assinatura eletrônica do seu ${opts.titulo}:\n${opts.link}\n\n` +
    'A assinatura é feita pela ZapSign, direto no celular, em poucos segundos. Qualquer dúvida, é só responder por aqui.'
  );
}

/** Abre o WhatsApp (wa.me) com a mensagem pronta. */
export function buildWhatsAppShareUrl(whatsapp: string | null | undefined, message: string): string | null {
  const digits = whatsappDigitsBR(whatsapp);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function openZapSignUrl(url?: string) {
  if (!url) throw new Error('Link de assinatura não disponível.');
  window.open(url, '_blank', 'noopener,noreferrer');
}
