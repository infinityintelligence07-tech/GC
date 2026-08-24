import { useState } from 'react';
import { RefreshCw, Upload, AlertTriangle, Link2 } from 'lucide-react';
import { pullClientesCompleto, pushAllStatuses, type IamPullResumo } from '@/lib/iamControlSync';
import { toast } from 'sonner';

const WEBHOOK_URL =
  'https://cbqkoverzdzmhceztldv.supabase.co/functions/v1/iam-control-receive-aluno';

export default function IamControlSyncSection() {
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [resumo, setResumo] = useState<IamPullResumo | null>(null);
  const [progresso, setProgresso] = useState('');
  const [pushResult, setPushResult] = useState('');

  const handlePull = async () => {
    setPulling(true);
    setResumo(null);
    setProgresso('');
    try {
      const { resumo: r, total_paginas } = await pullClientesCompleto(({ page, total, resumo: acc }) => {
        setProgresso(`Página ${page} de ${total}`);
        setResumo(acc);
      });
      setResumo(r);
      setProgresso(`Concluído (${total_paginas} páginas)`);
      toast.success('Sincronização com o IAM Control concluída');
    } catch (err) {
      console.error('[IAM Control] pull-clientes falhou:', err);
      toast.error('Falha ao sincronizar com o IAM Control');
    } finally {
      setPulling(false);
    }
  };

  const handlePushAll = async () => {
    setPushing(true);
    setPushResult('');
    try {
      const data = await pushAllStatuses();
      const enviados = (data?.resumo as { enviados?: number } | undefined)?.enviados ?? data?.enviados;
      setPushResult(
        enviados != null ? `${enviados} alunos reenviados ao IAM Control.` : 'Reenvio concluído.',
      );
      toast.success('Dados reenviados ao IAM Control');
    } catch (err) {
      console.error('[IAM Control] push-status (reconciliação) falhou:', err);
      toast.error('Falha ao reenviar dados');
    } finally {
      setPushing(false);
    }
  };

  const ambiguos = resumo?.ambiguos ?? 0;

  return (
    <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
      <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
        <Link2 size={14} /> IAM Control
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Os cadastros de alunos ficam ligados nos dois sentidos: nome, e-mail, WhatsApp, CPF,
        endereço e status. Alteração aqui é enviada ao IAM Control; alteração lá entra neste
        sistema. <strong>Entram alunos com contrato Conciliado ou Pendente (link/PIX)</strong> no IAM Control
        (pull manual e push automático na conciliação).
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handlePull}
          disabled={pulling}
          className="px-4 py-2 rounded-lg text-xs font-medium iam-gradient text-primary-foreground shadow-md disabled:opacity-50 flex items-center gap-2"
        >
          <RefreshCw size={13} className={pulling ? 'animate-spin' : ''} />
          {pulling ? 'Sincronizando…' : 'Trazer alunos do IAM Control (conciliados + pendentes)'}
        </button>
        <button
          onClick={handlePushAll}
          disabled={pushing}
          className="px-4 py-2 rounded-lg text-xs font-medium bg-muted text-foreground hover:bg-muted/70 disabled:opacity-50 flex items-center gap-2"
        >
          <Upload size={13} className={pushing ? 'animate-pulse' : ''} />
          {pushing ? 'Reenviando…' : 'Enviar alunos deste sistema ao IAM Control'}
        </button>
      </div>

      {progresso && <p className="text-xs text-muted-foreground mt-3">{progresso}</p>}
      {pushResult && <p className="text-xs text-muted-foreground mt-3">{pushResult}</p>}

      {resumo && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              { label: 'Recebidos', value: resumo.recebidos ?? 0 },
              { label: 'Criados', value: resumo.criados ?? 0 },
              { label: 'Atualizados', value: resumo.atualizados ?? 0 },
              { label: 'Ambíguos', value: ambiguos },
              { label: 'Erros', value: resumo.erros ?? 0 },
            ].map((k) => (
              <div key={k.label} className="bg-muted/40 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
                <p className="text-base font-semibold text-foreground">{k.value}</p>
              </div>
            ))}
          </div>

          {ambiguos > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <AlertTriangle size={13} />
                {ambiguos} cadastro(s) ambíguo(s) — conferência manual necessária
              </p>
              <ul className="mt-2 space-y-1 max-h-56 overflow-auto">
                {(resumo.ocorrencias ?? []).map((o, i) => (
                  <li key={i} className="text-[11px] text-foreground/80 font-mono break-all">
                    {typeof o === 'string' ? o : JSON.stringify(o)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-4 break-all">
        Webhook para o IAM Control enviar alterações na hora:{' '}
        <span className="font-mono text-foreground/80">{WEBHOOK_URL}</span>
      </p>
    </div>
  );
}
