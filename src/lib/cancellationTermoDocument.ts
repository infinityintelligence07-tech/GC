import { formatCurrency } from '@/store/useAppStore';
import type { CancellationCase, RefundPaymentMethod, RefundPixKeyType, Student } from '@/types';
import { refundPaymentMethodLabel } from '@/types';

export type CancellationTermoVariant =
  | 'somente_estorno'
  | 'somente_multa'
  | 'multa_e_estorno'
  | 'sem_multa';

export interface CancellationTermoRefundParcel {
  date: string;
  value: number;
}

export interface CancellationTermoInput {
  studentName: string;
  cpf?: string;
  email?: string;
  whatsapp?: string;
  treinamento?: string;
  quantidadeInscricoes: number;
  /** true = CDC 7 dias (sem multa); false = com multa (e eventual estorno). */
  semMultaCDC7: boolean;
  multaPercent: number;
  multaValue: number;
  totalPago: number;
  /** Valor a devolver ao aluno (> 0). */
  estornoTotal: number;
  refundPaymentMethod?: RefundPaymentMethod;
  pixKeyType?: RefundPixKeyType | string;
  pixKey?: string;
  pixOtherHolder?: boolean;
  pixHolderName?: string;
  pixHolderPhone?: string;
  refundInstallments?: CancellationTermoRefundParcel[];
  /** Data limite para assinar (YYYY-MM-DD ou DD/MM/AAAA). */
  diaLimiteAssinatura?: string;
  /** Data do termo (default: hoje). */
  dataTermo?: Date;
}

export interface CancellationTermoDocument {
  variant: CancellationTermoVariant;
  titulo: string;
  localData: string;
  studentName: string;
  cpf: string;
  email: string;
  whatsapp: string;
  paragraphs: string[];
  bankLines: string[];
  showBankBlock: boolean;
}

/**
 * Regras do conteúdo do termo:
 * - Sem multa (CDC) ou % zerado + saldo a devolver → base "multa e estorno", só a parte de estorno
 * - % > 0 sem saldo a devolver → só multa
 * - % > 0 com saldo a devolver → multa e estorno
 * - Sem multa / % zerado sem estorno → termo sem multa (CDC)
 */
export function resolveCancellationTermoVariant(input: {
  semMultaCDC7: boolean;
  multaPercent: number;
  estornoTotal: number;
}): CancellationTermoVariant {
  const pct = Number(input.multaPercent) || 0;
  const semMultaEfetiva = input.semMultaCDC7 || pct <= 0;
  const comEstorno = Math.max(0, Number(input.estornoTotal) || 0) > 0.01;

  if (semMultaEfetiva && comEstorno) return 'somente_estorno';
  if (!semMultaEfetiva && comEstorno) return 'multa_e_estorno';
  if (!semMultaEfetiva && !comEstorno) return 'somente_multa';
  return 'sem_multa';
}

function tituloForVariant(variant: CancellationTermoVariant): string {
  switch (variant) {
    case 'somente_estorno':
      return 'Termo de Cancelamento (estorno)';
    case 'somente_multa':
      return 'Termo de Cancelamento (com multa)';
    case 'multa_e_estorno':
      return 'Termo de Cancelamento (com multa e estorno)';
    case 'sem_multa':
      return 'Termo de Cancelamento (sem multa)';
    default: {
      const _exhaustive: never = variant;
      return _exhaustive;
    }
  }
}

const INSTITUTO =
  'INSTITUTO ACADEMY MIND TREINAMENTOS LTDA., devidamente inscrito no CNPJ sob o nº 03.727.532/0001-13, com sede na Rua Major Rehder, nº 248 - Vila Rehder, Americana - SP, CEP 13465-390';

function dash(v?: string | null): string {
  const t = (v ?? '').trim();
  return t || '—';
}

function parseIsoOrBr(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const br = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateBRShort(dateStr?: string): string {
  const d = parseIsoOrBr(dateStr);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR');
}

export function formatDateBRLong(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function formatRefundDates(parcels: CancellationTermoRefundParcel[]): string {
  const dates = parcels
    .map((p) => formatDateBRShort(p.date))
    .filter((d) => d !== '—');
  if (dates.length === 0) return '—';
  if (dates.length === 1) return dates[0];
  if (dates.length === 2) return `${dates[0]} e ${dates[1]}`;
  return `${dates.slice(0, -1).join(', ')} e ${dates[dates.length - 1]}`;
}

function typicalParcelValue(parcels: CancellationTermoRefundParcel[]): number {
  if (!parcels.length) return 0;
  const values = parcels.map((p) => Number(p.value) || 0);
  const first = values[0];
  if (values.every((v) => Math.abs(v - first) < 0.02)) return first;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Monta o termo institucional conforme multa/% e saldo a devolver. Sem endereço/CEP/turma/preço do contrato. */
export function buildCancellationTermoDocument(input: CancellationTermoInput): CancellationTermoDocument {
  const variant = resolveCancellationTermoVariant(input);
  const titulo = tituloForVariant(variant);

  const dataTermo = input.dataTermo ?? new Date();
  const limite =
    parseIsoOrBr(input.diaLimiteAssinatura) ?? addDays(dataTermo, 5);
  const qtdInsc = Math.max(1, Math.round(input.quantidadeInscricoes) || 1);
  const treinamento = dash(input.treinamento);
  const totalPago = formatCurrency(input.totalPago);
  const estorno = Math.max(0, Number(input.estornoTotal) || 0);
  const incluiEstorno = variant === 'somente_estorno' || variant === 'multa_e_estorno';
  const incluiMulta = variant === 'somente_multa' || variant === 'multa_e_estorno';
  const parcels = (input.refundInstallments ?? []).filter((p) => (Number(p.value) || 0) > 0.0049 || !!p.date);
  const qtdParcelas = Math.max(1, parcels.length || 1);
  const valorParcela = formatCurrency(typicalParcelValue(parcels.length ? parcels : [{ date: '', value: estorno }]));
  const datasParcelas = formatRefundDates(
    parcels.length ? parcels : [{ date: '', value: estorno }],
  );
  const metodo = refundPaymentMethodLabel(input.refundPaymentMethod);

  const paragraphs: string[] = [];

  paragraphs.push(
    `Vem perante a ${INSTITUTO}, REQUERER O CANCELAMENTO de ${qtdInsc} inscrição(ões) no treinamento ${treinamento}.`,
  );

  if (variant === 'sem_multa' || (variant === 'somente_estorno' && input.semMultaCDC7)) {
    paragraphs.push(
      'Considerando que a contratação do treinamento se deu de forma presencial e que o pedido de cancelamento ocorreu durante o prazo de 7 (sete) dias de reflexão previsto no artigo 49 do Código de Defesa do Consumidor, não será aplicada multa rescisória correspondente conforme contrato assinado pelas partes.',
    );
    paragraphs.push('Ajustam as partes que:');
    paragraphs.push('Todos os bônus eventualmente concedidos pela IAM estão automaticamente cancelados.');
  } else if (variant === 'somente_estorno') {
    // % zerado (sem marcar CDC): base do termo com multa e estorno, sem cláusulas de multa.
    paragraphs.push(
      'Considerando a contratação presencial e que as partes acordam o cancelamento sem aplicação de multa rescisória;',
    );
    paragraphs.push('Acordam as partes que:');
    paragraphs.push('Todos os bônus eventualmente concedidos pela ACADEMY estão automaticamente cancelados.');
  } else {
    paragraphs.push(
      'Considerando a contratação presencial e que o pedido de cancelamento ocorreu após o prazo de 7 dias da contratação;',
    );
    paragraphs.push('Acordam as partes que:');
    paragraphs.push('Todos os bônus eventualmente concedidos pela ACADEMY estão automaticamente cancelados.');
  }

  if (incluiMulta) {
    const pct = Number.isFinite(input.multaPercent) ? input.multaPercent : 0;
    paragraphs.push(
      `Será aplicada a título de multa rescisória o valor correspondente a ${pct}% do preço principal, perfazendo o montante de ${formatCurrency(input.multaValue)}, conforme previsto em contrato.`,
    );
    paragraphs.push(
      `O(a) ALUNO(A) realizou o pagamento de ${totalPago} do qual será utilizado para abatimento da multa contratual.`,
    );
  }

  if (incluiEstorno) {
    if (incluiMulta) {
      paragraphs.push(
        `Assim, descontada a multa, saldo a ser reembolsado totaliza o importe de ${formatCurrency(estorno)}, o(a) ALUNO(A) informa os dados bancários para devolução do montante que será pago em ${qtdParcelas} parcela(s) de ${valorParcela} para a(s) data(s) de ${datasParcelas}.`,
      );
    } else {
      paragraphs.push(
        `O(a) ALUNO(A) realizou o pagamento de ${totalPago} e requereu o cancelamento da inscrição, o saldo a ser reembolsado totaliza o importe de ${formatCurrency(estorno)}, o(a) ALUNO(A) informa os dados bancários para devolução do montante que será pago em ${qtdParcelas} parcela(s) de ${valorParcela} para a(s) data(s) de ${datasParcelas}.`,
      );
    }
    paragraphs.push(
      `O ALUNO(A) deverá assinar o presente termo até dia ${formatDateBRShort(limite.toISOString().slice(0, 10))} caso não o faça, prorroga-se o prazo de pagamento acima ajustado para até 10 dias úteis após o recebimento do termo assinado.`,
    );
    paragraphs.push(
      `O ALUNO(A) fica ciente de que o estorno ora realizado será realizado mediante ${metodo === 'Boleto' ? 'boleto bancário / transferência' : 'transferência bancária'} e no caso de a compra ter sido realizada mediante parcelamento no cartão de crédito, exime-se a ACADEMY de quaisquer responsabilidades de pagamento em relação à fatura do plástico.`,
    );
  } else if (incluiMulta) {
    const saldoMulta = Math.round((input.multaValue - input.totalPago) * 100) / 100;
    if (saldoMulta > 0.01) {
      paragraphs.push(
        `Descontada a multa contratual do valor já pago (${totalPago}), permanece saldo a pagar pelo(a) ALUNO(A) no importe de ${formatCurrency(saldoMulta)}.`,
      );
    } else {
      paragraphs.push(
        `Descontada a multa contratual do valor já pago (${totalPago}), não há saldo a reembolsar ao(à) ALUNO(A).`,
      );
    }
  }

  paragraphs.push(
    'O(A) ALUNO(A) autoriza a devolução do preço quitado na conta corrente / chave indicada, estando ciente de que as informações são de sua inteira responsabilidade. Ocorrendo a transferência de recursos financeiros para a conta indicada, o(a) ALUNO(A) declara que não restam bens, direitos ou créditos, passados, presentes e futuros a serem recebidos, sendo que pelo presente termo de cancelamento, o(a) ALUNO(A) concede plena, ampla, geral e irrevogável quitação à ACADEMY, para nada mais reclamar, independentemente da natureza da obrigação.',
  );
  paragraphs.push(
    'O presente Instrumento é firmado sob as condições de irrevogabilidade e irretratabilidade, obrigando-se as partes como a seus herdeiros e/ou sucessores a qualquer título, ao fiel cumprimento do ora ajustado.',
  );
  paragraphs.push(
    'Fica eleito o foro da comarca de Americana/SP para dirimir quaisquer controvérsias provenientes do presente instrumento, com a renúncia expressa de qualquer outro, por mais privilegiado que seja ou venha a se tornar.',
  );
  paragraphs.push(
    'E por estarem justos e contratados, assinam as partes o presente instrumento, em duas vias de igual teor e forma, na presença das duas testemunhas abaixo, para que o mesmo produza seus jurídicos e legais efeitos.',
  );

  const showBankBlock = incluiEstorno;
  const bankLines: string[] = [];
  if (showBankBlock) {
    if ((input.refundPaymentMethod ?? 'pix') === 'pix') {
      bankLines.push(`Tipo da chave: ${dash(input.pixKeyType)}`);
      bankLines.push(`CHAVE PIX: ${dash(input.pixKey)}`);
      if (input.pixOtherHolder) {
        bankLines.push(`Titularidade (terceiro): ${dash(input.pixHolderName)}`);
        bankLines.push(`Telefone do titular: ${dash(input.pixHolderPhone)}`);
      } else {
        bankLines.push(`Titularidade: ${dash(input.studentName)}`);
        bankLines.push(`CPF/CNPJ: ${dash(input.cpf)}`);
      }
    } else {
      bankLines.push('Forma: Boleto (anexo / emissão na aba Estornos)');
      bankLines.push(`Titularidade: ${dash(input.studentName)}`);
      bankLines.push(`CPF/CNPJ: ${dash(input.cpf)}`);
    }
  }

  return {
    variant,
    titulo,
    localData: `Americana/SP, ${formatDateBRLong(dataTermo)}`,
    studentName: dash(input.studentName),
    cpf: dash(input.cpf),
    email: dash(input.email),
    whatsapp: dash(input.whatsapp),
    paragraphs,
    bankLines,
    showBankBlock,
  };
}

export function buildCancellationTermoInputFromCase(opts: {
  caseRef: Pick<
    CancellationCase,
    | 'studentName'
    | 'studentWhatsapp'
    | 'quantidadeInscricoes'
    | 'treinamento'
    | 'multaPercent'
    | 'multaValue'
    | 'cancellationFineValue'
    | 'totalPagoAteMomento'
    | 'refundPlan'
    | 'dentro7Dias'
  >;
  student?: Pick<Student, 'name' | 'cpf' | 'email' | 'whatsapp' | 'product'> | null;
  semMultaCDC7: boolean;
  multaPercent: number;
  multaValue: number;
  totalPago: number;
  estornoTotal: number;
  refundInstallments?: CancellationTermoRefundParcel[];
  refundPaymentMethod?: RefundPaymentMethod;
  pixKey?: string;
  pixKeyType?: RefundPixKeyType | string;
  pixOtherHolder?: boolean;
  pixHolderName?: string;
  pixHolderPhone?: string;
  diaLimiteAssinatura?: string;
}): CancellationTermoInput {
  const plan = opts.caseRef.refundPlan;
  const pixOtherHolder = opts.pixOtherHolder ?? plan?.pixOtherHolder ?? false;
  return {
    studentName: opts.student?.name || opts.caseRef.studentName,
    cpf: opts.student?.cpf,
    email: opts.student?.email,
    whatsapp: opts.student?.whatsapp || opts.caseRef.studentWhatsapp,
    treinamento: opts.student?.product || opts.caseRef.treinamento,
    quantidadeInscricoes: opts.caseRef.quantidadeInscricoes ?? 1,
    semMultaCDC7: opts.semMultaCDC7,
    multaPercent: opts.multaPercent,
    multaValue: opts.multaValue,
    totalPago: opts.totalPago,
    estornoTotal: opts.estornoTotal,
    refundPaymentMethod: opts.refundPaymentMethod ?? plan?.paymentMethod ?? 'pix',
    pixKeyType: opts.pixKeyType ?? plan?.pixKeyType,
    pixKey: opts.pixKey ?? plan?.pixKey,
    pixOtherHolder,
    pixHolderName: opts.pixHolderName ?? plan?.pixHolderName,
    pixHolderPhone: opts.pixHolderPhone ?? plan?.pixHolderPhone,
    refundInstallments:
      opts.refundInstallments ??
      plan?.installments?.map((p) => ({ date: p.date, value: Number(p.value) || 0 })),
    diaLimiteAssinatura: opts.diaLimiteAssinatura,
  };
}

export function cancellationTermoToPlainText(doc: CancellationTermoDocument): string {
  const lines = [
    doc.titulo.toUpperCase(),
    '',
    `NOME COMPLETO: ${doc.studentName}`,
    `CPF: ${doc.cpf}`,
    `E-MAIL: ${doc.email}`,
    `WHATSAPP: ${doc.whatsapp}`,
    '',
    ...doc.paragraphs,
  ];
  if (doc.showBankBlock) {
    lines.push('', 'Dados Bancários:', ...doc.bankLines);
  }
  lines.push('', doc.localData, '', doc.studentName, doc.cpf, '', 'INSTITUTO ACADEMY MIND TREINAMENTOS LTDA', 'CNPJ 03.727.532/0001-13');
  return lines.join('\n');
}

export function buildCancellationTermoPrintHtml(doc: CancellationTermoDocument, logoSrc?: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const paras = doc.paragraphs.map((p) => `<p>${escape(p)}</p>`).join('\n');
  const bank =
    doc.showBankBlock && doc.bankLines.length
      ? `<div class="block"><p class="section-title">Dados Bancários</p>${doc.bankLines
          .map((l) => `<p class="line">${escape(l)}</p>`)
          .join('')}</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${escape(doc.titulo)} — ${escape(doc.studentName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', Times, serif;
      background: #fff; color: #111;
      padding: 40px 24px; line-height: 1.55; font-size: 13px;
    }
    .container { max-width: 780px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 28px; }
    .logo { max-width: 110px; margin: 0 auto 12px; }
    .logo img { max-width: 100%; height: auto; }
    .title { font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 8px; }
    p { margin-bottom: 10px; text-align: justify; }
    .line { margin-bottom: 4px; text-align: left; }
    .field { margin-bottom: 4px; text-align: left; }
    .label { font-weight: bold; }
    .block { margin: 16px 0; }
    .section-title { font-weight: bold; text-transform: uppercase; margin: 18px 0 8px; text-align: left; }
    .signature { margin-top: 40px; display: flex; justify-content: space-between; gap: 24px; }
    .sig-box { width: 46%; text-align: center; }
    .sig-line { border-top: 1px solid #111; margin: 48px 0 6px; min-height: 1px; }
    .sig-label { font-size: 12px; }
    .place { margin-top: 28px; text-align: left; }
    @media print { body { padding: 0; } .container { max-width: 100%; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${logoSrc ? `<div class="logo"><img src="${logoSrc}" alt="IAM" /></div>` : ''}
      <div class="title">${escape(doc.titulo)}</div>
    </div>
    <div class="block">
      <p class="field"><span class="label">NOME COMPLETO:</span> ${escape(doc.studentName)}</p>
      <p class="field"><span class="label">CPF:</span> ${escape(doc.cpf)}</p>
      <p class="field"><span class="label">E-MAIL:</span> ${escape(doc.email)}</p>
      <p class="field"><span class="label">WHATSAPP:</span> ${escape(doc.whatsapp)}</p>
    </div>
    ${paras}
    ${bank}
    <p class="place">${escape(doc.localData)}</p>
    <div class="signature">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">${escape(doc.studentName)}<br>${escape(doc.cpf)}</div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">INSTITUTO ACADEMY MIND TREINAMENTOS LTDA<br>CNPJ 03.727.532/0001-13</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
