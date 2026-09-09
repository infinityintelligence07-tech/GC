/**
 * Ponte entre os modelos editáveis da aba Documentos e os geradores de termo
 * (cancelamento e renegociação). Quando existe modelo editado/criado para o
 * contexto, o termo (preview, PDF e ZapSign) passa a ser o texto do modelo com
 * os {{CAMPOS}} preenchidos; senão, vale o texto institucional do código.
 */
import { useCompanyStore } from '@/store/useCompanyStore';
import {
  findManagedTemplateForRelation,
  type DocumentRelation,
  type ManagedDocument,
} from '@/lib/managedDocuments';
import { renderTemplate, type TemplateVars } from '@/lib/templateRender';

export interface TermoTemplateAplicado {
  /** Texto final (placeholders preenchidos). */
  text: string;
  /** Nome e versão do modelo, para mostrar no preview. */
  nome: string;
  versao: number;
  docId: string;
}

function activeCompanyId(): string {
  return useCompanyStore.getState().activeCompanyId || 'default';
}

export function findTermoTemplate(relation: DocumentRelation): ManagedDocument | undefined {
  return findManagedTemplateForRelation(activeCompanyId(), relation);
}

/** Renderiza o modelo do contexto, se houver um editado/criado na aba Documentos. */
export function aplicarTermoTemplate(
  relation: DocumentRelation,
  vars: TemplateVars,
): TermoTemplateAplicado | undefined {
  const doc = findTermoTemplate(relation);
  if (!doc) return undefined;
  return { text: renderTemplate(doc.content, vars).trim() + '\n', nome: doc.name, versao: doc.version, docId: doc.id };
}

/**
 * Campos disponíveis para os modelos de cancelamento ({{NOME COMPLETO}},
 * {{TOTAL DA MULTA}}, …). Lista usada na ajuda da aba Documentos.
 */
export const CANCELAMENTO_TEMPLATE_FIELDS: readonly string[] = [
  'TÍTULO',
  'NOME COMPLETO',
  'CPF',
  'E-MAIL',
  'WHATSAPP',
  'TREINAMENTO',
  'QUANTIDADE DE INSCRIÇÕES',
  'PORCENTAGEM DA MULTA',
  'TOTAL DA MULTA',
  'TOTAL PAGO',
  'TOTAL ESTORNO',
  'SALDO A PAGAR',
  'QTD PARCELAS ESTORNO',
  'VALOR PARCELA ESTORNO',
  'DATAS ESTORNO',
  'DIA LIMITE ASSINATURA',
  'FORMA ESTORNO',
  'TIPO PIX',
  'CHAVE PIX',
  'TITULARIDADE',
  'TELEFONE TITULAR',
  'DATA DO TERMO',
  'LOCAL E DATA',
];

/** Campos disponíveis para os modelos de renegociação. */
export const RENEGOCIACAO_TEMPLATE_FIELDS: readonly string[] = [
  'NOME COMPLETO',
  'CPF',
  'E-MAIL',
  'WHATSAPP',
  'TREINAMENTO',
  'QUANTIDADE DE INSCRIÇÕES',
  'DATA CONTRATO',
  'TOTAL CONTRATADO',
  'TOTAL PAGO',
  'SALDO EM ABERTO',
  'QTD PARCELAS ABERTO',
  'MULTA',
  'JUROS',
  'TOTAL APÓS RENEGOCIAÇÃO',
  'NOVA ENTRADA',
  'DATA ENTRADA',
  'ENTRADA',
  'NOVAS PARCELAS',
  'VALOR PARCELA',
  'PRIMEIRO VENCIMENTO',
  'DIA VENCIMENTO',
  'TAXA JUROS',
  'PARCELAMENTO',
  'DATA DO TERMO',
  'LOCAL E DATA',
];
