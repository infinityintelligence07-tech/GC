import { useState } from 'react';
import { X, Download } from 'lucide-react';
import { Student } from '@/types';
import { formatCurrency } from '@/store/useAppStore';
import logoIAM from '@/assets/logo-iam-blue.png';

interface Props {
  student: Student;
  originalValues: {
    valorVenda: number;
    entrada: number;
    parcelasOriginais: number;
  };
  newValues: {
    novoSaldo: number;
    multaAplicada: number;
    jurosAplicados: number;
    novaEntrada: number;
    novasParcelas: number;
    novoValorParcela: number;
  };
  onClose: () => void;
}

export default function TermoAditivoModal({ student, originalValues, newValues, onClose }: Props) {
  const [isSigning, setIsSigning] = useState(false);

  const handleGeneratePDF = () => {
    // Create a print-friendly version
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const today = new Date();
    const dateStr = today.toLocaleDateString('pt-BR');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Termo Aditivo de Contrato - ${student.name}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #fff;
            padding: 40px 20px;
            line-height: 1.6;
            color: #333;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border: 1px solid #e0e0e0;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #1e40af;
            padding-bottom: 20px;
          }
          .logo {
            max-width: 120px;
            margin: 0 auto 15px;
          }
          .logo img {
            max-width: 100%;
            height: auto;
          }
          .title {
            font-size: 20px;
            font-weight: bold;
            color: #1e40af;
            margin-top: 15px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .subtitle {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
          }
          .content {
            margin-bottom: 25px;
          }
          .section {
            margin-bottom: 20px;
          }
          .section-title {
            font-weight: bold;
            font-size: 13px;
            color: #1e40af;
            margin-bottom: 10px;
            text-transform: uppercase;
            border-bottom: 1px solid #ddd;
            padding-bottom: 5px;
          }
          .row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 13px;
          }
          .row.highlight {
            background: #f0f4ff;
            padding: 8px;
            border-radius: 4px;
            font-weight: bold;
            color: #1e40af;
          }
          .label {
            font-weight: 500;
            color: #333;
          }
          .value {
            font-weight: bold;
            color: #1e40af;
            text-align: right;
          }
          .two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 15px;
          }
          .column {
            display: flex;
            flex-direction: column;
          }
          .signature-area {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
          }
          .signature-line {
            display: flex;
            justify-content: space-between;
            margin-top: 30px;
          }
          .sig-box {
            text-align: center;
            width: 45%;
          }
          .sig-line {
            border-top: 1px solid #333;
            margin-bottom: 5px;
            min-height: 60px;
          }
          .sig-label {
            font-size: 11px;
            color: #666;
            font-weight: 500;
          }
          .footer {
            margin-top: 30px;
            padding-top: 15px;
            border-top: 1px solid #ddd;
            text-align: center;
            font-size: 10px;
            color: #999;
          }
          .observation {
            background: #fffacd;
            border-left: 4px solid #ffd700;
            padding: 10px;
            margin: 15px 0;
            font-size: 12px;
            color: #333;
          }
          @media print {
            body {
              padding: 0;
              background: white;
            }
            .container {
              border: none;
              max-width: 100%;
              margin: 0;
              padding: 0;
            }
            .no-print {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">
              <img src="${logoIAM}" alt="IAM Logo">
            </div>
            <div class="title">TERMO ADITIVO DE CONTRATO</div>
            <div class="subtitle">Renegociação de Parcelas</div>
          </div>

          <div class="content">
            <div class="section">
              <div class="section-title">Identificação do Aluno</div>
              <div class="row">
                <span class="label">Nome:</span>
                <span>${student.name}</span>
              </div>
              <div class="row">
                <span class="label">CPF:</span>
                <span>${student.cpf}</span>
              </div>
              <div class="row">
                <span class="label">Data do Termo:</span>
                <span>${dateStr}</span>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Valores Originais do Contrato</div>
              <div class="two-col">
                <div class="column">
                  <div class="row">
                    <span class="label">Valor de Venda:</span>
                    <span>${formatCurrency(originalValues.valorVenda)}</span>
                  </div>
                  <div class="row">
                    <span class="label">Entrada:</span>
                    <span>${formatCurrency(originalValues.entrada)}</span>
                  </div>
                </div>
                <div class="column">
                  <div class="row">
                    <span class="label">Parcelas Originais:</span>
                    <span>${originalValues.parcelasOriginais}x</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Novo Acordo - Encargos e Recalcificação</div>
              <div class="observation">
                Conforme requerido, procede-se à renegociação do contrato original com a aplicação dos seguintes encargos e condições.
              </div>

              <div class="two-col">
                <div class="column">
                  <div class="row">
                    <span class="label">Saldo Devedor:</span>
                    <span>${formatCurrency(newValues.novoSaldo)}</span>
                  </div>
                  <div class="row">
                    <span class="label">Multa Aplicada:</span>
                    <span class="value">${formatCurrency(newValues.multaAplicada)}</span>
                  </div>
                </div>
                <div class="column">
                  <div class="row">
                    <span class="label">Juros Aplicados:</span>
                    <span class="value">${formatCurrency(newValues.jurosAplicados)}</span>
                  </div>
                  <div class="row highlight">
                    <span class="label">Total com Encargos:</span>
                    <span>${formatCurrency(newValues.novoSaldo + newValues.multaAplicada + newValues.jurosAplicados)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Novas Condições de Parcelamento</div>
              <div class="two-col">
                <div class="column">
                  <div class="row">
                    <span class="label">Nova Entrada:</span>
                    <span>${formatCurrency(newValues.novaEntrada)}</span>
                  </div>
                  <div class="row">
                    <span class="label">Novas Parcelas:</span>
                    <span>${newValues.novasParcelas}x</span>
                  </div>
                </div>
                <div class="column">
                  <div class="row highlight">
                    <span class="label">Novo Valor da Parcela:</span>
                    <span>${formatCurrency(newValues.novoValorParcela)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="section">
              <div class="observation">
                As partes concordam que este aditivo substitui as condições originais de parcelamento, mantendo validade integral do contrato de prestação de serviços educacionais. O aluno mantém todos os direitos e deveres previstos no contrato original, sujeitando-se às novas condições de pagamento aqui estabelecidas.
              </div>
            </div>

            <div class="signature-area">
              <div class="signature-line">
                <div class="sig-box">
                  <div class="sig-line"></div>
                  <div class="sig-label">Aluno(a): ${student.name}</div>
                </div>
                <div class="sig-box">
                  <div class="sig-line"></div>
                  <div class="sig-label">IAM - GC</div>
                </div>
              </div>
            </div>

            <div class="footer">
              <p>Documento gerado automaticamente pelo sistema de gestão financeira IAM.</p>
              <p>Data e hora: ${dateStr} às ${today.toLocaleTimeString('pt-BR')}</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    // Give it a moment to render before printing
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl border border-border">
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card">
          <h2 className="text-lg font-semibold text-foreground">Termo Aditivo de Contrato</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Preview */}
          <div className="border border-border rounded-xl p-6 bg-muted/20 space-y-4 max-h-96 overflow-y-auto">
            <div className="flex justify-center mb-4">
              <img src={logoIAM} alt="IAM" className="w-16 h-auto" />
            </div>

            <h3 className="text-center text-sm font-bold text-primary uppercase">TERMO ADITIVO DE CONTRATO</h3>
            <p className="text-center text-xs text-muted-foreground">Renegociação de Parcelas</p>

            <div className="space-y-3 text-xs">
              <div>
                <p className="font-semibold text-primary mb-1">Identificação do Aluno</p>
                <div className="text-foreground/80">
                  <p>Nome: {student.name}</p>
                  <p>CPF: {student.cpf}</p>
                </div>
              </div>

              <div>
                <p className="font-semibold text-primary mb-1">Valores Originais</p>
                <div className="grid grid-cols-2 gap-2 text-foreground/80">
                  <p>Valor de Venda: {formatCurrency(originalValues.valorVenda)}</p>
                  <p>Entrada: {formatCurrency(originalValues.entrada)}</p>
                  <p>Parcelas: {originalValues.parcelasOriginais}x</p>
                </div>
              </div>

              <div>
                <p className="font-semibold text-primary mb-1">Novo Acordo</p>
                <div className="grid grid-cols-2 gap-2 text-foreground/80">
                  <p>Saldo: {formatCurrency(newValues.novoSaldo)}</p>
                  <p>Multa: {formatCurrency(newValues.multaAplicada)}</p>
                  <p>Juros: {formatCurrency(newValues.jurosAplicados)}</p>
                </div>
              </div>

              <div>
                <p className="font-semibold text-primary mb-1">Novas Condições</p>
                <div className="grid grid-cols-2 gap-2 text-foreground/80">
                  <p>Nova Entrada: {formatCurrency(newValues.novaEntrada)}</p>
                  <p>Novas Parcelas: {newValues.novasParcelas}x</p>
                  <p className="col-span-2 font-bold text-primary">Valor Parcela: {formatCurrency(newValues.novoValorParcela)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-xs text-blue-800">
              Este termo documenta formalmente a renegociação do contrato. Após confirmação, um PDF pronto para impressão será gerado.
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-border flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleGeneratePDF}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <Download size={16} />
            Gerar PDF
          </button>
        </div>
      </div>
    </div>
  );
}
