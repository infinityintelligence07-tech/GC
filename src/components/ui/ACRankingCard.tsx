import { AC, Student } from '@/types';
import { Trophy, TrendingUp } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import MetaGauge from './MetaGauge';
import { isSolicitacaoCancelamento } from '@/lib/acPortfolioVisibility';

interface ACRankingCardProps {
  acs: AC[];
  students: Student[];
  /**
   * Data de referência (modo Histórico). Quando informada, o status considerado
   * é o do aluno na data de referência (já calculado pelo chamador).
   */
  referenceDate?: Date;
  /**
   * Quantidade de alunos transferidos por Renegociação por AC (nome → qtd).
   * Só informativo no rodapé — NÃO entra no % (mesma Taxa Em Dia da carteira).
   */
  renegByAc?: Record<string, number>;
}

/**
 * Pódio de Ranking dos Assessores.
 *
 * Regra alinhada à Taxa Em Dia da carteira do assessor:
 *   alunos "Em Dia" / (carteira − alunos novos) × 100
 *
 *   - numerador   = "Em Dia" (exclui solicitação de cancelamento)
 *   - carteira    = alunos ativos do AC (Pagos / cancelados / RE / judicial
 *                   / finalizado já filtrados pelo chamador)
 *   - alunos novos = "Aluno Novo" (exclui solicitação de cancelamento)
 */
export default function ACRankingCard({ acs, students, referenceDate: _referenceDate, renegByAc }: ACRankingCardProps) {
  const rules = useAppStore((s) => s.rules);
  const metas = { meta1: rules.meta1, meta2: rules.meta2, meta3: rules.meta3 };
  const acStats = acs
    .filter((ac) => ac.active)
    .map((ac) => {
      const acStudents = students.filter((s) => s.ac === ac.name);
      const carteiraTotal = acStudents.length;
      const alunosNovos = acStudents.filter(
        (s) => s.status === 'Aluno Novo' && !isSolicitacaoCancelamento(s),
      ).length;
      const emDia = acStudents.filter(
        (s) => s.status === 'Em Dia' && !isSolicitacaoCancelamento(s),
      ).length;
      // Igual à Taxa Em Dia da carteira: total − novos (solicitações ficam no denom).
      const denominador = carteiraTotal - alunosNovos;
      const renegociado = renegByAc?.[ac.name] ?? 0;
      const liquidezRateExact = denominador > 0 ? (emDia / denominador) * 100 : 0;
      const liquidezRate = Math.round(liquidezRateExact * 10) / 10;

      return {
        ...ac,
        totalStudents: denominador,
        emDia,
        carteira: denominador,
        renegociado,
        denominador,
        liquidezRate,
        liquidezRateExact,
      };
    })
    .filter((ac) => ac.denominador > 0)
    .sort((a, b) => b.liquidezRateExact - a.liquidezRateExact);

  if (acStats.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <Header />
        <p className="text-xs text-muted-foreground text-center py-10">
          Sem dados suficientes para gerar o ranking. Cadastre alunos vinculados aos assessores para ver a classificação.
        </p>
      </div>
    );
  }

  const podium = acStats.slice(0, 3);
  const rest = acStats.slice(3);

  const second = podium[1];
  const first = podium[0];
  const third = podium[2];
  const visualOrder = [second, first, third].filter(Boolean) as typeof podium;

  return (
    <div className="relative overflow-hidden bg-card border border-border rounded-2xl p-6 saas-shadow">
      <Header />

      {/* Pódio */}
      <div className="relative mt-8">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-0 w-72 h-64 rounded-full blur-3xl opacity-25 dark:opacity-35"
          style={{ background: 'radial-gradient(circle, hsl(38 45% 65% / 0.55), transparent 70%)' }}
        />

        <div className="relative flex items-end justify-center gap-4 sm:gap-8 pb-1">
          {visualOrder.map((ac) => {
            const place = ac.id === first?.id ? 1 : ac.id === second?.id ? 2 : 3;
            return <PodiumColumn key={ac.id} ac={ac} place={place} metas={metas} />;
          })}
        </div>

        <div
          aria-hidden
          className="absolute left-6 right-6 bottom-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"
        />
      </div>

      {/* Demais posições */}
      {rest.length > 0 && (
        <div className="mt-10 pt-5 border-t border-border/60">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Demais posições
          </p>
          <ul className="space-y-1.5">
            {rest.map((ac, idx) => {
              const place = idx + 4;
              return (
                <li
                  key={ac.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted/60 transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-muted text-muted-foreground text-[11px] font-bold flex items-center justify-center">
                    {place}
                  </span>
                  {ac.photo ? (
                    <img
                      src={ac.photo}
                      alt={ac.name}
                      className="w-8 h-8 rounded-full object-cover border border-border"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold text-muted-foreground border border-border">
                      {ac.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{ac.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {ac.emDia} em dia / {ac.denominador} {ac.denominador === 1 ? 'aluno' : 'alunos'}
                      {ac.renegociado > 0 ? ` · Reneg ${ac.renegociado}` : ''}
                    </p>
                  </div>
                  <MetaGauge value={ac.liquidezRate} meta1={metas.meta1} meta2={metas.meta2} meta3={metas.meta3} size={70} showLabel={false} />
                  <RateBadge rate={ac.liquidezRate} />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Rodapé — fórmula */}
      <p className="mt-5 text-[10px] text-muted-foreground text-center">
        Taxa Em Dia % = Alunos &quot;Em Dia&quot; ÷ (Carteira − Alunos Novos) — mesma regra da carteira do assessor
      </p>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-[hsl(38_40%_55%/0.12)] flex items-center justify-center shrink-0">
        <Trophy size={20} className="text-[hsl(36_45%_55%)]" strokeWidth={1.8} />
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground tracking-tight">Ranking</h3>
        <p className="text-[10px] text-muted-foreground">Por Taxa Em Dia % (igual à carteira)</p>
      </div>
    </div>
  );
}

function RateBadge({ rate }: { rate: number }) {
  const tone =
    rate >= 80
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30'
      : rate >= 60
        ? 'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30'
        : 'bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${tone}`}>
      <TrendingUp size={10} strokeWidth={2.2} />
      {rate.toFixed(1).replace('.', ',')}%
    </span>
  );
}

interface PodiumColumnProps {
  ac: {
    id: string;
    name: string;
    photo?: string;
    totalStudents: number;
    emDia: number;
    carteira: number;
    renegociado: number;
    denominador: number;
    liquidezRate: number;
  };
  place: 1 | 2 | 3;
  metas: { meta1: number; meta2: number; meta3: number };
}

function PodiumColumn({ ac, place, metas }: PodiumColumnProps) {
  const palette = {
    1: {
      ringStyle: { boxShadow: '0 0 0 3px hsl(38 50% 60%), 0 0 28px -4px hsl(38 55% 55% / 0.55)' },
      cylinderTop: 'hsl(40 55% 78%)',
      cylinderMid: 'hsl(38 48% 60%)',
      cylinderBot: 'hsl(34 38% 38%)',
      cylinderEdge: 'hsl(38 45% 50%)',
      podiumHeight: 'h-28',
      avatarSize: 'w-24 h-24 sm:w-28 sm:h-28',
      badgeBg: 'bg-[hsl(38_50%_60%)] text-[hsl(36_60%_15%)]',
      badgeRing: 'ring-2 ring-[hsl(40_60%_75%)]',
      nameClass: 'text-base sm:text-lg font-bold text-foreground',
      valueColor: 'hsl(36 50% 45%)',
      darkValueColor: 'hsl(40 55% 70%)',
      wrapper: 'order-2 z-10',
    },
    2: {
      ringStyle: { boxShadow: '0 0 0 2px hsl(220 12% 70%)' },
      cylinderTop: 'hsl(220 14% 88%)',
      cylinderMid: 'hsl(220 12% 72%)',
      cylinderBot: 'hsl(220 10% 48%)',
      cylinderEdge: 'hsl(220 10% 60%)',
      podiumHeight: 'h-20',
      avatarSize: 'w-20 h-20 sm:w-24 sm:h-24',
      badgeBg: 'bg-[hsl(220_12%_75%)] text-[hsl(220_25%_25%)]',
      badgeRing: 'ring-2 ring-[hsl(220_15%_85%)]',
      nameClass: 'text-sm sm:text-base font-semibold text-foreground',
      valueColor: 'hsl(220 12% 45%)',
      darkValueColor: 'hsl(220 15% 75%)',
      wrapper: 'order-1',
    },
    3: {
      ringStyle: { boxShadow: '0 0 0 2px hsl(22 40% 55%)' },
      cylinderTop: 'hsl(22 45% 70%)',
      cylinderMid: 'hsl(22 42% 52%)',
      cylinderBot: 'hsl(20 35% 32%)',
      cylinderEdge: 'hsl(22 40% 45%)',
      podiumHeight: 'h-14',
      avatarSize: 'w-20 h-20 sm:w-24 sm:h-24',
      badgeBg: 'bg-[hsl(22_42%_55%)] text-[hsl(22_60%_15%)]',
      badgeRing: 'ring-2 ring-[hsl(22_45%_70%)]',
      nameClass: 'text-sm sm:text-base font-semibold text-foreground',
      valueColor: 'hsl(22 45% 42%)',
      darkValueColor: 'hsl(22 50% 65%)',
      wrapper: 'order-3',
    },
  }[place];

  return (
    <div className={`flex flex-col items-center flex-1 max-w-[180px] ${palette.wrapper}`}>
      <div className="relative">
        {ac.photo ? (
          <img
            src={ac.photo}
            alt={ac.name}
            className={`${palette.avatarSize} rounded-full object-cover bg-muted`}
            style={palette.ringStyle}
          />
        ) : (
          <div
            className={`${palette.avatarSize} rounded-full bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center text-2xl font-bold text-muted-foreground`}
            style={palette.ringStyle}
          >
            {ac.name.charAt(0).toUpperCase()}
          </div>
        )}
        <span
          className={`absolute -top-2 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full ${palette.badgeBg} ${palette.badgeRing} text-xs font-extrabold flex items-center justify-center shadow-md`}
        >
          {place}
        </span>
      </div>

      <div className="mt-3 text-center min-w-0 w-full">
        <p className={`${palette.nameClass} truncate`}>{ac.name}</p>
        <p
          className="mt-0.5 text-base sm:text-lg font-bold tabular-nums"
          style={{ color: `var(--ranking-value, ${palette.valueColor})` }}
        >
          <span className="dark:hidden">{ac.liquidezRate.toFixed(1).replace('.', ',')}%</span>
          <span className="hidden dark:inline" style={{ color: palette.darkValueColor }}>
            {ac.liquidezRate.toFixed(1).replace('.', ',')}%
          </span>
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
          {ac.emDia} / {ac.denominador} {ac.denominador === 1 ? 'aluno' : 'alunos'}
        </p>
        {ac.renegociado > 0 && (
          <p className="text-[9px] text-muted-foreground/80 truncate">
            Reneg: {ac.renegociado}
          </p>
        )}
      </div>

      <div className="mt-2">
        <MetaGauge
          value={ac.liquidezRate}
          meta1={metas.meta1}
          meta2={metas.meta2}
          meta3={metas.meta3}
          size={place === 1 ? 150 : 130}
          showLabel={false}
        />
      </div>
      <Cylinder
        height={palette.podiumHeight}
        topColor={palette.cylinderTop}
        midColor={palette.cylinderMid}
        botColor={palette.cylinderBot}
        edgeColor={palette.cylinderEdge}
        place={place}
      />
    </div>
  );
}

function Cylinder({
  height,
  topColor,
  midColor,
  botColor,
  edgeColor,
  place,
}: {
  height: string;
  topColor: string;
  midColor: string;
  botColor: string;
  edgeColor: string;
  place: number;
}) {
  return (
    <div className="relative mt-4 w-full">
      <div
        aria-hidden
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-[85%] h-3 rounded-[50%] blur-md opacity-40"
        style={{ background: 'hsl(220 20% 15% / 0.45)' }}
      />
      <div className={`relative w-full ${height}`}>
        <div
          className="absolute inset-0 rounded-b-md overflow-hidden"
          style={{
            background: `linear-gradient(180deg, ${midColor} 0%, ${midColor} 55%, ${botColor} 100%)`,
            boxShadow: `inset 0 -4px 12px ${botColor}, inset 0 0 0 1px ${edgeColor}`,
          }}
        >
          <div
            className="absolute top-0 bottom-0 left-0 w-[18%]"
            style={{ background: `linear-gradient(90deg, ${topColor}40 0%, transparent 100%)` }}
          />
          <div
            className="absolute top-0 bottom-0 right-0 w-[20%]"
            style={{ background: `linear-gradient(270deg, ${botColor}55 0%, transparent 100%)` }}
          />
          <span
            className="absolute inset-0 flex items-center justify-center text-white/90 font-bold tracking-wide drop-shadow-sm"
            style={{ fontSize: place === 1 ? '0.9rem' : '0.78rem' }}
          >
            {place}º
          </span>
        </div>
        <div
          className="absolute -top-[10px] left-0 right-0 h-[20px] rounded-[50%]"
          style={{
            background: `radial-gradient(ellipse at 35% 30%, ${topColor} 0%, ${midColor} 75%, ${edgeColor} 100%)`,
            boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.4), inset 0 -2px 4px ${edgeColor}`,
          }}
        />
      </div>
    </div>
  );
}
