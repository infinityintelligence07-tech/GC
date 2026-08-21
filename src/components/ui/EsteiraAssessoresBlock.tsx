import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { orderActiveAcs, peekNextAc } from '@/lib/acEsteira';
import type { AC } from '@/types';

interface Props {
  acs: AC[];
}

/** Bloco read-only: ordem da esteira e próximo AC a receber aluno novo. */
export default function EsteiraAssessoresBlock({ acs }: Props) {
  const [lastAssignedAcId, setLastAssignedAcId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('ac_esteira_state')
        .select('last_assigned_ac_id')
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Tabela ainda não migrada / sem permissão — UI degrada sem quebrar Config
        console.warn('[esteira]', error.message);
        setLastAssignedAcId(null);
      } else {
        setLastAssignedAcId(data?.last_assigned_ac_id ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [acs.length]);

  const ordered = orderActiveAcs(acs);
  const next = peekNextAc(acs, lastAssignedAcId);
  const lastName = lastAssignedAcId
    ? acs.find((a) => a.id === lastAssignedAcId)?.name
    : null;

  return (
    <div className="mb-4 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-start gap-2 mb-2">
        <Users size={14} className="text-primary mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-semibold text-foreground">Esteira de distribuição</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Alunos novos sem assessor entram na fila dos ativos. Quem recebe vai para o fim.
            Se o CPF+ciclo já existir, o aluno fica com o assessor da ficha.
          </p>
        </div>
      </div>

      {ordered.length === 0 ? (
        <p className="text-[11px] text-amber-700">Nenhum assessor ativo — a esteira não atribui ninguém.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {ordered.map((ac, i) => (
              <span
                key={ac.id}
                className={`text-[10px] px-2 py-0.5 rounded-md border ${
                  next?.id === ac.id
                    ? 'bg-primary/10 text-primary border-primary/30 font-semibold'
                    : 'bg-card text-muted-foreground border-border'
                }`}
                title={next?.id === ac.id ? 'Próximo a receber' : `Posição ${i + 1}`}
              >
                {i + 1}. {ac.name}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {loading ? (
              'Carregando estado da fila…'
            ) : (
              <>
                Próximo a receber:{' '}
                <span className="font-semibold text-foreground">{next?.name ?? '—'}</span>
                {lastName ? (
                  <span className="text-muted-foreground/80"> · último: {lastName}</span>
                ) : null}
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
