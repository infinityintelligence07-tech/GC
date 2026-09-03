/** Modelos de documentos gerenciáveis (termos, contratos, etc.) — persistência local por empresa. */

export type ManagedDocumentKind = 'contrato' | 'termo' | 'aditivo' | 'outro';

export const DOCUMENT_KIND_LABELS: Record<ManagedDocumentKind, string> = {
  contrato: 'Contrato',
  termo: 'Termo',
  aditivo: 'Aditivo',
  outro: 'Outro',
};

/** Contextos de uso aos quais um documento pode estar relacionado. */
export type DocumentRelation =
  | 'cancelamento_com_multa'
  | 'cancelamento_sem_multa'
  | 'renegociacao'
  | 'contrato'
  | 'aditivo'
  | 'reversao_cancelamento'
  | 'quitacao';

export const DOCUMENT_RELATIONS: readonly DocumentRelation[] = [
  'cancelamento_com_multa',
  'cancelamento_sem_multa',
  'renegociacao',
  'contrato',
  'aditivo',
  'reversao_cancelamento',
  'quitacao',
];

export const DOCUMENT_RELATION_LABELS: Record<DocumentRelation, string> = {
  cancelamento_com_multa: 'Cancelamento com multa',
  cancelamento_sem_multa: 'Cancelamento sem multa',
  renegociacao: 'Renegociação',
  contrato: 'Contrato',
  aditivo: 'Aditivo',
  reversao_cancelamento: 'Reversão de cancelamento',
  quitacao: 'Quitação',
};

export interface ManagedDocument {
  id: string;
  name: string;
  kind: ManagedDocumentKind;
  version: number;
  /** Corpo do documento (texto com placeholders {{CAMPO}}). */
  content: string;
  createdAt: string;
  updatedAt: string;
  updatedByName?: string;
  /** Chave de modelo embutido do app (permite resetar para o padrão). */
  builtInKey?: string;
  /** Contextos de uso relacionados a este documento (ex.: cancelamento com multa). */
  relatedTo?: DocumentRelation[];
  companyId: string;
}

export interface ManagedDocumentsExport {
  version: 1;
  exportedAt: string;
  documents: Array<Omit<ManagedDocument, 'companyId'> & { companyId?: string }>;
}

const STORAGE_PREFIX = 'gc:managed-documents:v1:';

function storageKey(companyId: string): string {
  return `${STORAGE_PREFIX}${companyId || 'default'}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function extractTemplateVariables(content: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const key = m[1].trim();
    if (key) found.add(key);
  }
  return [...found];
}

const BUILTIN_RELATED: Partial<Record<string, DocumentRelation[]>> = {
  termo_cancelamento_com_multa: ['cancelamento_com_multa'],
  termo_cancelamento_sem_multa: ['cancelamento_sem_multa'],
  termo_renegociacao: ['renegociacao'],
};

const BUILTIN_TEMPLATES: Array<{
  key: string;
  name: string;
  kind: ManagedDocumentKind;
  content: string;
}> = [
  {
    key: 'termo_cancelamento_com_multa',
    name: 'Termo de Cancelamento (com multa e estorno)',
    kind: 'termo',
    content: `TERMO DE CANCELAMENTO (COM MULTA E ESTORNO)

NOME COMPLETO: {{NOME COMPLETO}}
CPF: {{CPF}}
E-MAIL: {{E-MAIL}}
WHATSAPP: {{WHATSAPP}}

Vem perante a INSTITUTO ACADEMY MIND TREINAMENTOS LTDA., devidamente inscrito no CNPJ sob o nº 03.727.532/0001-13, com sede na Rua Major Rehder, nº 248 - Vila Rehder, Americana - SP, CEP 13465-390, REQUERER O CANCELAMENTO de {{QUANTIDADE DE INSCRIÇÕES}} inscrição(ões) no treinamento {{TREINAMENTO}}.

Considerando a contratação presencial e que o pedido de cancelamento ocorreu após o prazo de 7 dias da contratação;

Acordam as partes que:
Todos os bônus eventualmente concedidos pela ACADEMY estão automaticamente cancelados.

Será aplicada a título de multa rescisória o valor correspondente a {{PORCENTAGEM DA MULTA}} do preço principal, perfazendo o montante de {{TOTAL DA MULTA}}, conforme previsto em contrato.

O(a) ALUNO(A) realizou o pagamento de {{TOTAL PAGO}} do qual será utilizado para abatimento da multa contratual.

Assim, descontada a multa, saldo a ser reembolsado totaliza o importe de {{TOTAL ESTORNO}}, o(a) ALUNO(A) informa os dados bancários para devolução do montante que será pago em {{QTD PARCELAS ESTORNO}} parcela(s) de {{VALOR PARCELA ESTORNO}} para a(s) data(s) de {{DATAS ESTORNO}}.

O ALUNO(A) deverá assinar o presente termo até dia {{DIA LIMITE ASSINATURA}} caso não o faça, prorroga-se o prazo de pagamento acima ajustado para até 10 dias úteis após o recebimento do termo assinado.

Dados Bancários:
CHAVE PIX ({{TIPO PIX}}): {{CHAVE PIX}}
Titularidade: {{NOME COMPLETO}}
CPF/CNPJ: {{CPF}}

Americana/SP, {{DATA DO TERMO}}

____________________________________________
{{NOME COMPLETO}}
{{CPF}}

_______________________________________________________
INSTITUTO ACADEMY MIND TREINAMENTOS LTDA
CNPJ 03.727.532/0001-13
`,
  },
  {
    key: 'termo_cancelamento_sem_multa',
    name: 'Termo de Cancelamento (sem multa)',
    kind: 'termo',
    content: `TERMO DE CANCELAMENTO (SEM MULTA)

NOME COMPLETO: {{NOME COMPLETO}}
CPF: {{CPF}}
E-MAIL: {{E-MAIL}}
WHATSAPP: {{WHATSAPP}}

Vem perante a INSTITUTO ACADEMY MIND TREINAMENTOS LTDA., devidamente inscrito no CNPJ sob o nº 03.727.532/0001-13, com sede na Rua Major Rehder, nº 248 - Vila Rehder, Americana - SP, CEP 13465-390, REQUERER O CANCELAMENTO de {{QUANTIDADE DE INSCRIÇÕES}} inscrição(ões) no treinamento {{TREINAMENTO}}.

Considerando que a contratação do treinamento se deu de forma presencial e que o pedido de cancelamento ocorreu durante o prazo de 7 (sete) dias de reflexão previsto no artigo 49 do Código de Defesa do Consumidor, não será aplicada multa rescisória correspondente conforme contrato assinado pelas partes.

Ajustam as partes que:
Todos os bônus eventualmente concedidos pela IAM estão automaticamente cancelados.

O(a) ALUNO(A) realizou o pagamento de {{TOTAL PAGO}} e requereu o cancelamento da inscrição, o saldo a ser reembolsado totaliza o importe de {{TOTAL ESTORNO}}, o(a) ALUNO(A) informa os dados bancários para devolução do montante que será pago em {{QTD PARCELAS ESTORNO}} parcela(s) de {{VALOR PARCELA ESTORNO}} para a(s) data(s) de {{DATAS ESTORNO}}.

O ALUNO(A) deverá assinar o presente termo até dia {{DIA LIMITE ASSINATURA}} caso não o faça, prorroga-se o prazo de pagamento acima ajustado para até 10 dias úteis após o recebimento do termo assinado.

Dados Bancários:
CHAVE PIX ({{TIPO PIX}}): {{CHAVE PIX}}
Titularidade: {{NOME COMPLETO}}
CPF/CNPJ: {{CPF}}

Americana/SP, {{DATA DO TERMO}}

____________________________________________
{{NOME COMPLETO}}
{{CPF}}

_______________________________________________________
INSTITUTO ACADEMY MIND TREINAMENTOS LTDA
CNPJ 03.727.532/0001-13
`,
  },
  {
    key: 'termo_renegociacao',
    name: 'Termo de Renegociação',
    kind: 'termo',
    content: `TERMO DE RENEGOCIAÇÃO

NOME COMPLETO: {{NOME COMPLETO}}
CPF/CNPJ: {{CPF}}
WHATSAPP: {{WHATSAPP}}
EMAIL: {{E-MAIL}}

E o INSTITUTO ACADEMY MIND TREINAMENTOS LTDA, pessoa jurídica de direito privado, devidamente inscrita no CNPJ nº 03.727.532/0001-13, com sede na R. Major Rehder, 248 - Vila Rehder, Americana - SP, 13465-390, AJUSTAM SUA RELAÇÃO CONTRATUAL CONFORME A SEGUIR EXPOSTO.

O(A) ALUNO(A) possui {{QUANTIDADE DE INSCRIÇÕES}} inscrição(ões) no treinamento {{TREINAMENTO}}, contrato assinado em {{DATA CONTRATO}}.

O presente instrumento visa formalizar a renegociação realizada entre as partes referente ao montante pendente de pagamento pelo(a) ALUNO(a), de modo que as alterações de valores refletem a nova forma de pagamento, estando o(a) ALUNO(a) ciente e de acordo com as novas condições.

RENEGOCIAÇÃO DAS PARCELAS FICANDO DA SEGUINTE FORMA:

TREINAMENTO: {{TREINAMENTO}}
TOTAL CONTRATADO: {{TOTAL CONTRATADO}}
TOTAL PAGO: {{TOTAL PAGO}}
SALDO EM ABERTO: {{SALDO EM ABERTO}}
QTD PARCELAS EM ABERTO: {{QTD PARCELAS ABERTO}}
TOTAL APÓS RENEGOCIAÇÃO: {{TOTAL APOS RENEGOCIACAO}}
NOVA ENTRADA: {{NOVA ENTRADA}}
NOVAS PARCELAS: {{NOVAS PARCELAS}}
VALOR DA PARCELA: {{VALOR PARCELA}}
TAXA DE JUROS A.M.: {{TAXA JUROS}}
PARCELAMENTO:
{{PARCELAMENTO}}

Americana/SP, {{DATA DO TERMO}}

____________________________________________
{{NOME COMPLETO}}
{{CPF}}

_______________________________________________________
INSTITUTO ACADEMY MIND TREINAMENTOS LTDA
CNPJ 03.727.532/0001-13
`,
  },
];

function readRaw(companyId: string): ManagedDocument[] {
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ManagedDocument[]) : [];
  } catch {
    return [];
  }
}

function writeRaw(companyId: string, docs: ManagedDocument[]): void {
  localStorage.setItem(storageKey(companyId), JSON.stringify(docs));
  window.dispatchEvent(new CustomEvent('gc-managed-documents-changed', { detail: { companyId } }));
}

/** Garante modelos embutidos e devolve a lista completa da empresa. */
export function listManagedDocuments(companyId: string): ManagedDocument[] {
  const cid = companyId || 'default';
  let docs = readRaw(cid);
  const stamp = nowIso();
  let changed = false;

  for (const t of BUILTIN_TEMPLATES) {
    const exists = docs.some((d) => d.builtInKey === t.key);
    if (exists) continue;
    docs.push({
      id: newId(),
      name: t.name,
      kind: t.kind,
      version: 1,
      content: t.content.trim() + '\n',
      createdAt: stamp,
      updatedAt: stamp,
      updatedByName: 'Sistema',
      builtInKey: t.key,
      relatedTo: BUILTIN_RELATED[t.key],
      companyId: cid,
    });
    changed = true;
  }

  docs = docs.map((d) => {
    if (!d.builtInKey || d.relatedTo?.length) return d;
    const related = BUILTIN_RELATED[d.builtInKey];
    if (!related?.length) return d;
    changed = true;
    return { ...d, relatedTo: related };
  });

  if (changed) writeRaw(cid, docs);
  return docs.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function getManagedDocument(companyId: string, id: string): ManagedDocument | undefined {
  return listManagedDocuments(companyId).find((d) => d.id === id);
}

export function createManagedDocument(
  companyId: string,
  input: {
    name: string;
    kind: ManagedDocumentKind;
    content: string;
    relatedTo?: DocumentRelation[];
    updatedByName?: string;
  },
): ManagedDocument {
  const cid = companyId || 'default';
  const docs = listManagedDocuments(cid);
  const stamp = nowIso();
  const doc: ManagedDocument = {
    id: newId(),
    name: input.name.trim() || 'Novo documento',
    kind: input.kind,
    version: 1,
    content: input.content,
    relatedTo: input.relatedTo?.length ? [...input.relatedTo] : undefined,
    createdAt: stamp,
    updatedAt: stamp,
    updatedByName: input.updatedByName,
    companyId: cid,
  };
  writeRaw(cid, [...docs, doc]);
  return doc;
}

export function updateManagedDocument(
  companyId: string,
  id: string,
  patch: Partial<Pick<ManagedDocument, 'name' | 'kind' | 'content' | 'relatedTo' | 'updatedByName'>>,
  opts?: { bumpVersion?: boolean },
): ManagedDocument | null {
  const cid = companyId || 'default';
  const docs = listManagedDocuments(cid);
  const idx = docs.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  const prev = docs[idx];
  const next: ManagedDocument = {
    ...prev,
    name: patch.name?.trim() || prev.name,
    kind: patch.kind ?? prev.kind,
    content: patch.content ?? prev.content,
    relatedTo:
      patch.relatedTo !== undefined
        ? patch.relatedTo.length
          ? [...patch.relatedTo]
          : undefined
        : prev.relatedTo,
    updatedAt: nowIso(),
    updatedByName: patch.updatedByName ?? prev.updatedByName,
    version: opts?.bumpVersion === false ? prev.version : prev.version + 1,
  };
  const copy = [...docs];
  copy[idx] = next;
  writeRaw(cid, copy);
  return next;
}

export function duplicateManagedDocument(
  companyId: string,
  id: string,
  updatedByName?: string,
): ManagedDocument | null {
  const src = getManagedDocument(companyId, id);
  if (!src) return null;
  return createManagedDocument(companyId, {
    name: `${src.name} (cópia)`,
    kind: src.kind,
    content: src.content,
    relatedTo: src.relatedTo,
    updatedByName,
  });
}

export function deleteManagedDocument(companyId: string, id: string): boolean {
  const cid = companyId || 'default';
  const docs = listManagedDocuments(cid);
  const next = docs.filter((d) => d.id !== id);
  if (next.length === docs.length) return false;
  writeRaw(cid, next);
  return true;
}

export function resetBuiltInDocument(
  companyId: string,
  id: string,
  updatedByName?: string,
): ManagedDocument | null {
  const cid = companyId || 'default';
  const docs = listManagedDocuments(cid);
  const idx = docs.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  const prev = docs[idx];
  if (!prev.builtInKey) return null;
  const builtin = BUILTIN_TEMPLATES.find((t) => t.key === prev.builtInKey);
  if (!builtin) return null;
  const next: ManagedDocument = {
    ...prev,
    name: builtin.name,
    kind: builtin.kind,
    content: builtin.content.trim() + '\n',
    version: prev.version + 1,
    updatedAt: nowIso(),
    updatedByName,
  };
  const copy = [...docs];
  copy[idx] = next;
  writeRaw(cid, copy);
  return next;
}

export function exportDocumentsJson(docs: ManagedDocument[]): string {
  const payload: ManagedDocumentsExport = {
    version: 1,
    exportedAt: nowIso(),
    documents: docs.map(({ companyId: _c, ...rest }) => rest),
  };
  return JSON.stringify(payload, null, 2);
}

export function exportDocumentTxt(doc: ManagedDocument): string {
  return doc.content;
}

export function parseImportPayload(
  text: string,
  fileName: string,
): {
  docs: Array<{ name: string; kind: ManagedDocumentKind; content: string; relatedTo?: DocumentRelation[] }>;
  error?: string;
} {
  const trimmed = text.trim();
  if (!trimmed) return { docs: [], error: 'Arquivo vazio.' };

  if (fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.documents)
          ? parsed.documents
          : parsed?.name && parsed?.content
            ? [parsed]
            : null;
      if (!list) return { docs: [], error: 'JSON inválido. Use o formato exportado pelo GC.' };
      const docs = list
        .map((item: any) => ({
          name: String(item.name || 'Documento importado').trim(),
          kind: (['contrato', 'termo', 'aditivo', 'outro'].includes(item.kind)
            ? item.kind
            : 'outro') as ManagedDocumentKind,
          content: String(item.content ?? ''),
          relatedTo: Array.isArray(item.relatedTo)
            ? item.relatedTo.filter((id: unknown): id is DocumentRelation =>
                typeof id === 'string' && (DOCUMENT_RELATIONS as readonly string[]).includes(id),
              )
            : undefined,
        }))
        .filter((d: { content: string }) => d.content.length > 0);
      if (!docs.length) return { docs: [], error: 'Nenhum documento válido no JSON.' };
      return { docs };
    } catch {
      return { docs: [], error: 'Não foi possível ler o JSON.' };
    }
  }

  const baseName = fileName.replace(/\.[^.]+$/, '') || 'Documento importado';
  return {
    docs: [
      {
        name: baseName,
        kind: /termo/i.test(baseName) ? 'termo' : /aditivo|renegocia/i.test(baseName) ? 'aditivo' : /contrato/i.test(baseName) ? 'contrato' : 'outro',
        content: trimmed,
      },
    ],
  };
}

export async function readFileAsText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    return extractDocxText(file);
  }
  return file.text();
}

async function extractDocxText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('DOCX inválido (sem document.xml).');
  const texts: string[] = [];
  const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) texts.push(m[1]);
  // Agrupa por parágrafo de forma simples
  const paras = xml
    .split(/<\/w:p>/)
    .map((chunk) => {
      const parts: string[] = [];
      const r = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let mm: RegExpExecArray | null;
      while ((mm = r.exec(chunk))) parts.push(mm[1]);
      return parts.join('');
    })
    .map((p) => p.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))
    .filter((p) => p.trim().length > 0);
  return paras.join('\n');
}

export function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function subscribeManagedDocuments(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener('gc-managed-documents-changed', handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener('gc-managed-documents-changed', handler);
    window.removeEventListener('storage', handler);
  };
}
