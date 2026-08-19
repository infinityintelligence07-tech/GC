import { useState } from 'react';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import {
  CancellationCase,
  CancellationStage,
  CancellationOperationalStatus,
  MotivoCancelamento,
  MOTIVOS_CANCELAMENTO,
  FunnelStage,
  CancellationAction,
  CancellationResponsavel,
  PagamentoTipo,
} from '@/types';
import { X, Download, Upload, FileText, Trash2 } from 'lucide-react';
import CurrencyInput from '@/components/ui/CurrencyInput';
import { supabase } from '@/integrations/supabase/client';
import { useCompanyStore } from '@/store/useCompanyStore';

interface Props {
  onClose: () => void;
}

const PAGAMENTOS: PagamentoTipo[] = ['Pix', 'Cartão de Crédito'];

// Mapeia funnel → stage legado
const FUNNEL_TO_STAGE: Record<FunnelStage, CancellationStage> = {
  'Entrada': 'Aguardando Contato',
  'Em Execução': 'Ajustes em Geral / Boleto',
  'Formalização': 'Confeccionar Termo',
  'Pendente': 'PROCON ou Judicial',
  'Finalizado': 'Cancelado',
};

export default function ImportExternalCancellationModal({ onClose }: Props) {
  const { addCancellationCase, rules, acs, products } = useAppStore();
  const activeAcs = acs.filter((a) => a.active).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const [treinamento, setTreinamento] = useState<string>('');
  const [usarOutroTreinamento, setUsarOutroTreinamento] = useState(false);


  // Assessor responsável (obrigatório)
  const [acId, setAcId] = useState<string>('');

  // Identificação (simplificado — contrato já quitado)
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  // Pagamento
  const [pagamento, setPagamento] = useState<PagamentoTipo>('Pix');
  const [valorContrato, setValorContrato] = useState<number>(0);
  const [totalPagoKamino, setTotalPagoKamino] = useState<number>(0);
  const [qtdInscricoes, setQtdInscricoes] = useState<string>('');
  const [dataSolicitacao, setDataSolicitacao] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Perguntas de cancelamento
  const [motivoCancelamento, setMotivoCancelamento] = useState<MotivoCancelamento | ''>('');
  const [dentro7Dias, setDentro7Dias] = useState<boolean | null>(null);
  const [com30Dias, setCom30Dias] = useState<boolean | null>(null);
  const [observacoes, setObservacoes] = useState('');

  // PDF do contrato
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Cálculo de multa
  const multaPercent =
    dentro7Dias === true
      ? 0
      : com30Dias === true
        ? rules.multaCancelamentoComAntecedencia
        : com30Dias === false
          ? rules.multaCancelamentoSemAntecedencia
          : null;
  const multaValue = multaPercent != null ? (valorContrato * multaPercent) / 100 : null;

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const isPdfFile = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const isImageFile = f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i.test(f.name);
    if (!isPdfFile && !isImageFile) {
      setUploadError('Selecione um PDF ou uma imagem.');
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setUploadError('Arquivo maior que 15 MB.');
      return;
    }
    setUploadError(null);
    setPdfFile(f);
  };

  const canConfirm =
    !!acId &&
    !!nome.trim() &&
    !!treinamento.trim() &&

    !!whatsapp.trim() &&
    !!pagamento &&
    !!motivoCancelamento &&
    dentro7Dias !== null &&
    com30Dias !== null &&
    valorContrato > 0 &&
    totalPagoKamino > 0 &&
    !!observacoes.trim() &&
    !!pdfFile &&
    !!qtdInscricoes && parseInt(qtdInscricoes, 10) > 0 &&
    !!dataSolicitacao;

  const handleSave = async () => {
    if (!canConfirm) return;
    setUploading(true);
    setUploadError(null);
    let contractPdfUrl: string | undefined;

    try {
      if (pdfFile) {
        const activeCompanyId = useCompanyStore.getState().activeCompanyId;
        if (!activeCompanyId) throw new Error('Empresa ativa não identificada.');
        // Path prefixed with company_id so storage RLS can enforce company isolation.
        const path = `${activeCompanyId}/contracts/${Date.now()}_${pdfFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error } = await supabase.storage.from('cancellation-docs').upload(path, pdfFile, {
          contentType: pdfFile.type || 'application/pdf',
          upsert: false,
        });
        if (error) throw error;
        contractPdfUrl = path;
      }
    } catch (err: any) {
      setUploadError(err?.message ?? 'Falha ao enviar o arquivo.');
      setUploading(false);
      return;
    }

    const nowDate = new Date();
    const today = nowDate.toISOString().slice(0, 10);
    let createdAtIso = nowDate.toISOString();
    if (dataSolicitacao && dataSolicitacao !== today) {
      const [y, m, d] = dataSolicitacao.split('-').map(Number);
      const dt = new Date(y, (m || 1) - 1, d || 1, nowDate.getHours(), nowDate.getMinutes(), nowDate.getSeconds());
      if (!isNaN(dt.getTime())) createdAtIso = dt.toISOString();
    }
    const now = createdAtIso;
    // Importação vai direto para "Em Tratativas" (funnel "Em Execução")
    const funnelStage: FunnelStage = 'Em Execução';
    const stage = FUNNEL_TO_STAGE[funnelStage];
    const acao: CancellationAction = 'Aguardando Contato';
    const responsavel: CancellationResponsavel = 'Financeiro';
    const opStatus: CancellationOperationalStatus = 'Sem contato';

    const notasFinais = [
      '[Aluno importado manualmente — contrato pago à vista]',
      `Treinamento: ${treinamento}`,
      `Forma de pagamento: ${pagamento}`,
      `Valor do contrato: ${formatCurrency(valorContrato)}`,
      totalPagoKamino > 0 ? `Total Pago até o momento (Kamino): ${formatCurrency(totalPagoKamino)}` : null,
      multaValue != null ? `Multa calculada: ${multaPercent}% = ${formatCurrency(multaValue)}` : null,
      observacoes.trim() ? `\nObservações do assessor:\n${observacoes.trim()}` : null,
    ].filter(Boolean).join('\n');

    const newCase: CancellationCase = {
      id: '',
      studentName: nome.trim(),
      studentWhatsapp: whatsapp || undefined,
      ac: activeAcs.find((a) => a.id === acId)?.name ?? '',
      stage,
      operationalStatus: opStatus,
      value: valorContrato,
      createdAt: now,
      movedToCurrentStageAt: now,
      notes: notasFinais,
      motivoCancelamento: motivoCancelamento || undefined,
      descricaoCancelamento: observacoes || undefined,
      funnelStage,
      acao,
      responsavel,
      history: [{ date: now, from: stage, to: stage, operationalStatus: opStatus, note: 'Importado manualmente em Cancelamentos (Em Tratativas)' }],
      dentro7Dias: dentro7Dias ?? undefined,
      com30DiasAntecedencia: com30Dias ?? undefined,
      multaPercent: multaPercent ?? undefined,
      multaValue: multaValue ?? undefined,
      pagamentoTipo: pagamento,
      treinamento: treinamento.trim() || undefined,
      contractPdfUrl,
      externalImport: true,
      totalPagoAteMomento: totalPagoKamino > 0 ? totalPagoKamino : undefined,
      quantidadeInscricoes: qtdInscricoes && parseInt(qtdInscricoes, 10) > 0 ? parseInt(qtdInscricoes, 10) : undefined,
    };

    addCancellationCase(newCase);
    setUploading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl saas-shadow-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
              <Download size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Importar Aluno Cancelamento (PIX / Cartão)</h2>
              <p className="text-[11px] text-muted-foreground">Contrato já quitado. Cadastro simplificado.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Identificação */}
          <section>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Identificação</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                  Assessor responsável <span className="text-destructive">*</span>
                </label>
                <select className="input-field w-full" value={acId} onChange={(e) => setAcId(e.target.value)}>
                  <option value="">— Selecione um assessor —</option>
                  {activeAcs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {activeAcs.length === 0 && (
                  <p className="text-[10px] text-rose-600 mt-1">Nenhum assessor ativo cadastrado.</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                  Nome completo <span className="text-destructive">*</span>
                </label>
                <input className="input-field w-full" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do aluno" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                  Treinamento <span className="text-destructive">*</span>
                </label>
                {sortedProducts.length > 0 ? (
                  <select
                    className="input-field w-full"
                    value={usarOutroTreinamento ? '__other__' : treinamento}
                    onChange={(e) => {
                      if (e.target.value === '__other__') {
                        setUsarOutroTreinamento(true);
                        setTreinamento('');
                      } else {
                        setUsarOutroTreinamento(false);
                        setTreinamento(e.target.value);
                      }
                    }}
                  >
                    <option value="">— Selecione um treinamento —</option>
                    {sortedProducts.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                    <option value="__other__">Outro (digitar)…</option>
                  </select>
                ) : null}
                {(sortedProducts.length === 0 || usarOutroTreinamento) && (
                  <input
                    className="input-field w-full mt-2"
                    value={treinamento}
                    onChange={(e) => setTreinamento(e.target.value)}
                    placeholder="Nome do treinamento"
                  />
                )}

              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Telefone / WhatsApp <span className="text-destructive">*</span></label>
                <input className="input-field w-full" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(00) 00000-0000" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Forma de pagamento <span className="text-destructive">*</span></label>
                <select className="input-field w-full" value={pagamento} onChange={(e) => setPagamento(e.target.value as PagamentoTipo)}>
                  {PAGAMENTOS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* PDF Contrato */}
          <section>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Contrato (PDF ou imagem) <span className="text-destructive">*</span></h3>
            <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
              pdfFile ? 'bg-emerald-50 border-emerald-300' : 'border-border hover:border-primary hover:bg-primary/5'
            }`}>
              {pdfFile ? (
                <>
                  <FileText size={20} className="text-emerald-700 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-emerald-800 truncate">{pdfFile.name}</p>
                    <p className="text-[10px] text-emerald-600">{(pdfFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setPdfFile(null); }}
                    className="text-emerald-700 hover:text-rose-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              ) : (
                <>
                  <Upload size={20} className="text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-foreground">Anexar PDF ou imagem do contrato</p>
                    <p className="text-[10px] text-muted-foreground">Clique para selecionar (até 15 MB)</p>
                  </div>
                </>
              )}
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handlePickFile} />
            </label>
            {uploadError && <p className="text-[10px] text-rose-600 mt-1">{uploadError}</p>}
          </section>

          {/* Valor + Multa auto */}
          <section>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Valor do contrato</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                  Valor total <span className="text-destructive">*</span>
                </label>
                <CurrencyInput value={valorContrato} onChange={(v) => setValorContrato(v)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Multa calculada</label>
                <div className={`h-[42px] rounded-xl border px-3 flex items-center justify-between text-sm font-semibold ${
                  multaValue == null ? 'bg-muted/30 border-border text-muted-foreground' :
                  multaPercent === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                  'bg-amber-50 border-amber-200 text-amber-800'
                }`}>
                  <span>{multaValue == null ? '— responder perguntas abaixo —' : formatCurrency(multaValue)}</span>
                  {multaPercent != null && <span className="text-[10px] font-bold">{multaPercent}%</span>}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                Total Pago até o momento Kamino <span className="text-destructive">*</span>
              </label>
              <CurrencyInput value={totalPagoKamino} onChange={(v) => setTotalPagoKamino(v)} />
              <p className="text-[10px] text-muted-foreground mt-1">Preenchimento manual pelo assessor (obrigatório).</p>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                Quantidade de inscrições do contrato <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                min={1}
                step={1}
                className="input-field w-full"
                placeholder="Ex.: 1, 2, 3..."
                value={qtdInscricoes}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setQtdInscricoes(e.target.value.replace(/[^\d]/g, ''))}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Número de <strong>inscrições</strong> que compõem este contrato.</p>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                Data em que o aluno solicitou o cancelamento pela primeira vez no chat <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                className="input-field w-full"
                max={new Date().toISOString().slice(0, 10)}
                value={dataSolicitacao}
                onChange={(e) => setDataSolicitacao(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Se diferente de hoje, esta será a data considerada em <strong>"Solicitado"</strong> no card de cancelamentos.
              </p>
            </div>
          </section>


          {/* Motivo */}
          <section>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Motivo do Cancelamento <span className="text-destructive">*</span></h3>
            <select className="input-field w-full" value={motivoCancelamento} onChange={(e) => setMotivoCancelamento(e.target.value as MotivoCancelamento)}>
              <option value="">— Selecione um motivo —</option>
              {MOTIVOS_CANCELAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </section>

          {/* Perguntas 7d / 30d */}
          <section className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                Está dentro dos 7 dias de contrato? <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                {[
                  { v: true, label: 'Sim', cls: 'bg-emerald-500 border-emerald-500' },
                  { v: false, label: 'Não', cls: 'bg-rose-500 border-rose-500' },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    onClick={() => setDentro7Dias(o.v)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      dentro7Dias === o.v ? `${o.cls} text-white` : 'bg-card text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                Cancelamento pedido com &gt; 30 dias de antecedência do evento? <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                {[
                  { v: true, label: 'Sim, mais de 30D', cls: 'bg-emerald-500 border-emerald-500' },
                  { v: false, label: 'Não, menos de 30D', cls: 'bg-rose-500 border-rose-500' },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    onClick={() => setCom30Dias(o.v)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      com30Dias === o.v ? `${o.cls} text-white` : 'bg-card text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Observações */}
          <section>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Observações <span className="text-destructive">*</span></h3>
            <textarea
              className="input-field w-full resize-none"
              rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Anotação do assessor (obrigatório)..."
            />
          </section>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={handleSave}
            disabled={!canConfirm || uploading}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all disabled:opacity-50"
          >
            {uploading ? 'Enviando...' : 'Importar para Cancelamentos'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
