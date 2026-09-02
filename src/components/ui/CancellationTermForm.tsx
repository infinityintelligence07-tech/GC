import { CancellationCase, Student } from '@/types';
import { Download, Upload, Copy, CheckCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  buildCancellationTermoDocument,
  buildCancellationTermoInputFromCase,
  cancellationTermoToPlainText,
} from '@/lib/cancellationTermoDocument';

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
  onFileUpload,
}: CancellationTermFormProps) {
  const defaultTerm = useMemo(() => {
    const semMultaCDC7 =
      cancellationCase.dentro7Dias === true && (cancellationCase.multaPercent ?? -1) === 0;
    const fineValue = cancellationCase.cancellationFineValue ?? cancellationCase.multaValue ?? 0;
    const totalPaid = Number(cancellationCase.totalPagoAteMomento) || 0;
    const balance = Math.round((fineValue - totalPaid) * 100) / 100;
    const doc = buildCancellationTermoDocument(
      buildCancellationTermoInputFromCase({
        caseRef: cancellationCase,
        student,
        semMultaCDC7,
        multaPercent: cancellationCase.multaPercent ?? 0,
        multaValue: fineValue,
        totalPago: totalPaid,
        estornoTotal: balance < 0 ? Math.abs(balance) : 0,
      }),
    );
    return cancellationTermoToPlainText(doc);
  }, [cancellationCase, student]);

  const [termContent, setTermContent] = useState(cancellationCase.termTemplate || defaultTerm);
  const [showTemplate, setShowTemplate] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopyTerm = () => {
    navigator.clipboard.writeText(termContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onTermGenerated?.(termContent);
  };

  const handleDownloadTerm = () => {
    const element = document.createElement('a');
    const file = new Blob([termContent], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `Termo_Cancelamento_${cancellationCase.studentName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    onTermGenerated?.(termContent);
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
          Termo institucional pré-preenchido (sem endereço, turma ou preço do contrato). Revise antes de enviar.
        </p>
      </div>

      {showTemplate && (
        <div className="space-y-3">
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

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleDownloadTerm}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 text-xs font-medium transition"
            >
              <Download size={13} />
              Baixar Termo
            </button>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border text-foreground hover:bg-muted/80 text-xs font-medium transition cursor-pointer">
              <Upload size={13} />
              Anexar assinado
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleFileInput} />
            </label>
            <button
              type="button"
              onClick={() => setShowTemplate(false)}
              className="px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Ocultar
            </button>
          </div>
        </div>
      )}

      {!showTemplate && (
        <button
          type="button"
          onClick={() => setShowTemplate(true)}
          className="text-xs font-medium text-primary hover:underline"
        >
          Mostrar termo
        </button>
      )}
    </div>
  );
}
