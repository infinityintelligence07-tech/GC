import type { Installment } from '@/types';

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Baixa de quitação aprovada na Conciliação: marca todas as parcelas em aberto
 * como pagas e grava `paidValue` de modo que a soma recebida seja exatamente
 * `valorPago` (o desconto concedido é abatido das últimas parcelas). Sem isso
 * o card "Pago" (que lê `paidValue`) somava o valor cheio das parcelas e
 * ignorava o desconto — ex.: quitação de R$ 1.994,00 por R$ 1.794,60 aparecia
 * como R$ 1.994,00 recebidos.
 */
export function aplicarBaixaQuitacao(
  installments: Installment[],
  opts: { valorPago?: unknown; paidDate: string; paidMarkedAt: string },
): Installment[] {
  const abertas = installments.filter((i) => !i.paid);
  const totalAberto = r2(abertas.reduce((a, i) => a + Number(i.value || 0), 0));
  const valorPago = Number(opts.valorPago);
  let desconto =
    Number.isFinite(valorPago) && valorPago >= 0 && valorPago < totalAberto - 0.005
      ? r2(totalAberto - valorPago)
      : 0;

  // Abate o desconto de trás para frente: a última parcela absorve primeiro.
  const paidValuePorNumero = new Map<number, number>();
  for (let k = abertas.length - 1; k >= 0 && desconto > 0.005; k--) {
    const inst = abertas[k];
    const valor = r2(Number(inst.value || 0));
    const abate = Math.min(valor, desconto);
    paidValuePorNumero.set(inst.number, r2(valor - abate));
    desconto = r2(desconto - abate);
  }

  return installments.map((i) => {
    if (i.paid) return i;
    const pv = paidValuePorNumero.get(i.number);
    return {
      ...i,
      paid: true,
      paidDate: opts.paidDate,
      paidMarkedAt: opts.paidMarkedAt,
      ...(pv != null ? { paidValue: pv } : {}),
    };
  });
}
