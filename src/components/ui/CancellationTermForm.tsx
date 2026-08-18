import { CancellationCase } from '@/types';
import { Student } from '@/types';
import { Download, Upload, Copy, CheckCircle } from 'lucide-react';
import { useState } from 'react';

interface CancellationTermFormProps {
  cancellationCase: CancellationCase;
  student?: Student;
  onTermGenerated?: (termContent: string) => void;
  onFileUpload?: (files: File[]) => void;
}

export default function CancellationTermForm({
  cancellationCase,
  student,
  onTermGenerated,
  onFileUpload
}: CancellationTermFormProps) {
  const [termContent, setTermContent] = useState(cancellationCase.termTemplate || generateDefaultTerm(cancellationCase, student));
  const [showTemplate, setShowTemplate] = useState(true);
  const [copied, setCopied] = useState(false);

  function generateDefaultTerm(caseData: CancellationCase, studentData?: Student): string {
    const now = new Date().toLocaleDateString('pt-BR');
    return `TERMO DE CANCELAMENTO E DEVOLUÇÃO DE VALORES

Data: ${now}

DADOS DO CLIENTE:
Nome: ${caseData.studentName}
CPF: ${studentData?.cpf || '________________'}
Endereço: ${studentData?.address || '_________________________________'}, ${studentData?.numero || '____'}
Cidade/Estado: ${studentData?.cidade || '_________'} / ${studentData?.estado || '__'}
CEP: ${studentData?.cep || '_________'}

DADOS DO CONTRATO:
Produto/Curso: ${studentData?.product || '_________________________________'}
Valor Original: R$ ${studentData?.saleValue?.toFixed(2) || '________,__'}
Data de Inscrição: ${studentData?.enrollmentDate ? new Date(studentData.enrollmentDate).toLocaleDateString('pt-BR') : '___/___/______'}
Total de Parcelas: ${studentData?.totalInstallments || '__'}
Parcelas Pagas: ${studentData?.paidInstallments || '__'}

MOTIVO DO CANCELAMENTO:
${caseData.motivoCancelamento || '___________________________________________________________________'}

DETALHES DA SOLICITAÇÃO:
Notas: ${caseData.notes || '___________________________________________________________________'}

CONFIRMAÇÃO DO CLIENTE:
Confirmo que solicito o cancelamento de minha inscrição no curso acima mencionado e autorizo a devolução do saldo devido conforme cálculo acima.

__________________________________
Assinatura do Cliente

__________________________________
Data
`;
  }

  const handleCopyTerm = () => {
    navigator.clipboard.writeText(termContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTerm = () => {
    const element = document.createElement('a');
    const file = new Blob([termContent], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `Termo_Cancelamento_${cancellationCase.studentName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      onFileUpload?.(files);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
        <CheckCircle size={16} className="text-blue-600" />
        <p className="text-sm text-blue-800 font-medium">
          Termo pré-preenchido com dados do aluno. Revise antes de enviar.
        </p>
      </div>

      {showTemplate && (
        <div className="space-y-3">
          {/* Template Display */}
          <div className="relative">
            <textarea
              value={termContent}
              onChange={(e) => setTermContent(e.target.value)}
              className="w-full h-64 p-4 border border-border rounded-lg font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Conteúdo do termo de cancelamento"
            />
            <div className="absolute top-2 right-2 flex gap-1">
              <button
                onClick={handleCopyTerm}
                className="p-1.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition"
                title="Copiar"
              >
                {copied ? <CheckCircle size={14} className="text-emerald-600" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleDownloadTerm}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 text-xs font-medium transition"
            >
              <Download size={13} />
              Baixar Termo
            </button>
            <button
              onClick={() => onTermGenerated?.(termContent)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg iam-gradient text-primary-foreground text-xs font-medium transition"
            >
              <CheckCircle size={13} />
              Confirmar Termo
            </button>
            <button
              onClick={() => setShowTemplate(false)}
              className="px-3 py-2 rounded-lg bg-muted text-muted-foreground hover:text-foreground text-xs font-medium transition"
            >
              Próximo Passo
            </button>
          </div>
        </div>
      )}

      {!showTemplate && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <h4 className="text-sm font-semibold text-amber-900 mb-2">Upload do Termo Assinado</h4>
            <p className="text-xs text-amber-800 mb-4">
              Faça upload do termo assinado pelo cliente (PDF, imagem ou documento)
            </p>

            <div className="border-2 border-dashed border-amber-300 rounded-lg p-6 text-center">
              <Upload size={24} className="mx-auto mb-2 text-amber-600" />
              <label className="cursor-pointer">
                <span className="text-xs font-semibold text-amber-700 hover:text-amber-900">
                  Clique para enviar arquivos
                </span>
                <input
                  type="file"
                  multiple
                  onChange={handleFileInput}
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  className="hidden"
                />
              </label>
              <p className="text-[10px] text-amber-600 mt-2">
                Formatos: PDF, imagens, documentos
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowTemplate(true)}
              className="flex-1 px-3 py-2 rounded-lg bg-muted text-muted-foreground hover:text-foreground text-xs font-medium transition"
            >
              Voltar
            </button>
            <button
              className="flex-1 px-3 py-2 rounded-lg iam-gradient text-primary-foreground text-xs font-medium transition"
            >
              Finalizar Upload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
