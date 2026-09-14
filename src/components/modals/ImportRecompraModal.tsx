// ─── Modal: Importar Planilha de Recompra ────────────────────────────────────
// Conciliação > Recompras. Lê a planilha do financeiro (DATA DO DÉBITO,
// DOCUMENTO, BANCO, VALOR DEBITADO, VENCIMENTO, VALOR ORIGINAL, JUROS, ALUNO,
// ASSESSOR), identifica cada aluno na carteira e cria/anexa a ficha de Recompra
// (Fundo) com uma parcela em aberto por linha. As fichas novas entram sozinhas
// em "Aguardando vínculo" para o revisor escolher o treinamento de origem.
// O parsing/matching mora em src/lib/recompraPlanilha.ts (puro e testado).

import { useMemo, useState } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Search,
  UserPlus,
  RotateCcw,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';
import { loadXLSX } from '@/lib/xlsxLoader';
import { ensureRecompraVinculoConciliacaoItems, isRecompraFicha } from '@/lib/recompraConciliacao';
import {
  matchAlunosRecompra,
  normalizeNome,
  parsePlanilhaRecompra,
  planejarImportRecompra,
  RECOMPRA_PRODUTO_PADRAO,
  valorParcelaRecompra,
  type RecompraImportPlan,
  type RecompraRowMatch,
  type RecompraValorBase,
} from '@/lib/recompraPlanilha';
import type { Student } from '@/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface ResultadoImport {
  fichasCriadas: number;
  fichasFalhas: number;
  parcelasAnexadas: number;
  fichasAnexadas: number;
  ignoradas: number;
  totalValor: number;
}

const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const fmtData = (iso: string | null) => {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export default function ImportRecompraModal({ isOpen, onClose }: Props) {
  const students = useAppStore((s) => s.students);
  const acs = useAppStore((s) => s.acs);
  const studentTags = useAppStore((s) => s.studentTags);
  const currentUser = useAppStore((s) => s.currentUser);
  const addStudentsBulk = useAppStore((s) => s.addStudentsBulk);
  const updateStudent = useAppStore((s) => s.updateStudent);

  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [matches, setMatches] = useState<RecompraRowMatch[] | null>(null);
  const [incluir, setIncluir] = useState<Record<number, boolean>>({});
  // Padrão "original": é o valor que as fichas de recompra vindas do Kamino já
  // usam (Valor a Receber = valor do boleto); os juros ficam na observação.
  const [valorBase, setValorBase] = useState<RecompraValorBase>('original');
  const [result, setResult] = useState<ResultadoImport | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const reset = () => {
    setParsing(false);
    setImporting(false);
    setFileName('');
    setMatches(null);
    setIncluir({});
    setValorBase('original');
    setResult(null);
    setErro(null);
  };

  const handleClose = () => {
    if (importing) return;
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setErro(null);
    setMatches(null);
    setResult(null);
    setFileName(file.name);
    try {
      const XLSX = await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
      // Prefere a aba chamada "RECOMPRA"; senão a primeira.
      const abaNome = wb.SheetNames.find((n) => /recompra/i.test(n)) ?? wb.SheetNames[0];
      const ws = wb.Sheets[abaNome];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
      const rows = parsePlanilhaRecompra(matrix);
      if (rows.length === 0) throw new Error('Nenhuma linha de recompra encontrada abaixo do cabeçalho.');
      const m = matchAlunosRecompra(rows, students);
      setMatches(m);
      const init: Record<number, boolean> = {};
      m.forEach((x, i) => {
        init[i] = x.status === 'ok';
      });
      setIncluir(init);
    } catch (e) {
      setErro((e as Error).message);
      setMatches(null);
    } finally {
      setParsing(false);
    }
  };

  // Tag "Recompra" do catálogo (se existir) marca cada parcela — é o que o
  // cálculo de Vencido usa para não contar recompra como atraso do treinamento.
  const recompraTagIds = useMemo(() => {
    const t =
      studentTags.find((tag) => normalizeNome(tag.name) === normalizeNome(RECOMPRA_PRODUTO_PADRAO)) ??
      studentTags.find((tag) => /recompra/i.test(tag.name));
    return t ? [t.id] : [];
  }, [studentTags]);

  const matchesEfetivos = useMemo(() => {
    if (!matches) return [];
    return matches.filter((m, i) => incluir[i] && (m.studentId || m.criarComNomePlanilha));
  }, [matches, incluir]);

  const plano: RecompraImportPlan | null = useMemo(() => {
    if (!matches) return null;
    return planejarImportRecompra(matchesEfetivos, students, {
      valorBase,
      tagIds: recompraTagIds,
      fileName,
      autorNome: currentUser?.name ?? 'Sistema',
      acs,
    });
  }, [matches, matchesEfetivos, students, valorBase, recompraTagIds, fileName, currentUser?.name, acs]);

  const resumo = useMemo(() => {
    if (!matches) return null;
    const total = matches.length;
    const ok = matches.filter((m) => m.status === 'ok').length;
    const revisar = matches.filter((m) => m.status !== 'ok' && m.status !== 'invalido' && !m.studentId && !m.criarComNomePlanilha).length;
    const invalidas = matches.filter((m) => m.status === 'invalido').length;
    return { total, ok, revisar, invalidas };
  }, [matches]);

  const setMatch = (idx: number, patch: Partial<RecompraRowMatch>) => {
    setMatches((prev) => (prev ? prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)) : prev));
  };

  const escolherAluno = (idx: number, student: Student) => {
    setMatch(idx, { studentId: student.id, criarComNomePlanilha: false });
    setIncluir((p) => ({ ...p, [idx]: true }));
  };

  const criarComPlanilha = (idx: number) => {
    setMatch(idx, { studentId: undefined, criarComNomePlanilha: true });
    setIncluir((p) => ({ ...p, [idx]: true }));
  };

  const limparEscolha = (idx: number) => {
    setMatch(idx, { studentId: undefined, criarComNomePlanilha: false });
    setIncluir((p) => ({ ...p, [idx]: false }));
  };

  const handleConfirm = async () => {
    if (!plano) return;
    setImporting(true);
    setErro(null);
    try {
      let fichasCriadas = 0;
      let fichasFalhas = 0;
      if (plano.novas.length > 0) {
        const r = await addStudentsBulk(plano.novas);
        fichasCriadas = r.inserted;
        fichasFalhas = r.failed;
      }
      let parcelasAnexadas = 0;
      for (const a of plano.anexos) {
        await updateStudent(a.studentId, a.patch);
        parcelasAnexadas += a.novasParcelas.length;
      }
      // Coloca as fichas novas na fila "Aguardando vínculo" já, sem esperar o próximo sync.
      try {
        const conc = useConciliacaoStore.getState();
        const itens = await ensureRecompraVinculoConciliacaoItems(useAppStore.getState().students, conc.items, true);
        if (itens !== conc.items) conc.setItems(itens);
      } catch (e) {
        console.error('[import recompra] falha ao atualizar fila de vínculo', e);
      }
      setResult({
        fichasCriadas,
        fichasFalhas,
        parcelasAnexadas,
        fichasAnexadas: plano.anexos.length,
        ignoradas: plano.ignoradas.length + (matches ? matches.filter((_, i) => !incluir[i]).length : 0),
        totalValor: plano.totalValor,
      });
    } catch (e) {
      setErro(`Falha ao importar: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  const podeConfirmar = !!plano && (plano.novas.length > 0 || plano.anexos.length > 0) && !importing;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="text-teal-600" size={20} />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Importar Planilha de Recompra</h2>
              <p className="text-xs text-muted-foreground">
                Cada linha vira uma parcela em aberto na ficha de Recompra do aluno. Fichas novas entram em "Aguardando vínculo".
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 rounded-lg hover:bg-muted" disabled={importing}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {erro && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="text-emerald-600" size={18} />
                <h3 className="font-semibold text-emerald-900">Importação concluída</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                <Stat label="Fichas de recompra criadas" value={String(result.fichasCriadas)} color="emerald" />
                <Stat label="Parcelas anexadas" value={String(result.parcelasAnexadas)} color="emerald" hint={result.fichasAnexadas > 0 ? `em ${result.fichasAnexadas} ficha${result.fichasAnexadas !== 1 ? 's' : ''} existente${result.fichasAnexadas !== 1 ? 's' : ''}` : undefined} />
                <Stat label="Valor importado" value={fmtBRL(result.totalValor)} color="slate" />
                <Stat label="Linhas ignoradas" value={String(result.ignoradas)} color={result.ignoradas > 0 ? 'amber' : 'slate'} />
                <Stat label="Falhas" value={String(result.fichasFalhas)} color={result.fichasFalhas > 0 ? 'rose' : 'slate'} />
              </div>
              <p className="text-xs text-emerald-900/80 mt-3">
                As fichas novas já estão em <strong>Aguardando vínculo</strong>: selecione o treinamento de origem de cada uma.
              </p>
              <div className="flex justify-end mt-4">
                <button onClick={handleClose} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
                  Fechar
                </button>
              </div>
            </div>
          )}

          {/* Upload */}
          {!result && !matches && (
            <div className="space-y-3">
              <label
                className={`block border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
                  parsing ? 'border-teal-500 bg-teal-50' : 'border-border hover:border-teal-400 hover:bg-muted/30'
                }`}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = '';
                  }}
                  disabled={parsing}
                />
                {parsing ? (
                  <div className="flex flex-col items-center gap-2 text-teal-700">
                    <Loader2 className="animate-spin" size={28} />
                    <p className="text-sm font-medium">Lendo planilha...</p>
                  </div>
                ) : (
                  <>
                    <Upload className="mx-auto text-muted-foreground mb-2" size={28} />
                    <p className="text-sm font-medium text-foreground">Clique ou arraste a planilha de recompra</p>
                    <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls ou .csv</p>
                  </>
                )}
              </label>

              <div className="text-xs text-muted-foreground bg-muted/30 rounded-xl p-3 space-y-1">
                <p><strong>Como funciona:</strong></p>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  <li>Colunas esperadas: <strong>DATA DO DÉBITO, DOCUMENTO, BANCO, VALOR DEBITADO, VENCIMENTO, VALOR ORIGINAL, JUROS, ALUNO, ASSESSOR</strong> (título e linha TOTAL são ignorados).</li>
                  <li>O aluno é localizado pelo nome (aceita nome truncado) e, em caso de homônimos, pelo assessor. Linhas sem match ficam para você escolher.</li>
                  <li>Aluno sem ficha de Recompra ganha uma nova (produto <em>Fundo - Receita (Recompra)</em>); quem já tem recebe as parcelas anexadas. Parcelas repetidas (mesmo documento ou mesmo vencimento + valor) são puladas.</li>
                </ul>
              </div>
            </div>
          )}

          {/* Preview */}
          {matches && !result && resumo && plano && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Arquivo: <strong className="text-foreground">{fileName}</strong>
                </p>
                <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" disabled={importing}>
                  <RotateCcw size={12} /> Trocar arquivo
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Stat label="Linhas" value={String(resumo.total)} color="slate" />
                <Stat label="Alunos identificados" value={String(resumo.ok)} color="emerald" />
                <Stat label="A revisar" value={String(resumo.revisar)} color={resumo.revisar > 0 ? 'amber' : 'slate'} />
                <Stat label="Inválidas" value={String(resumo.invalidas)} color={resumo.invalidas > 0 ? 'rose' : 'slate'} />
                <Stat label="Será importado" value={fmtBRL(plano.totalValor)} color="emerald" hint={`${plano.totalParcelas} parcela${plano.totalParcelas !== 1 ? 's' : ''} · ${plano.novas.length} ficha${plano.novas.length !== 1 ? 's' : ''} nova${plano.novas.length !== 1 ? 's' : ''} · ${plano.anexos.length} anexo${plano.anexos.length !== 1 ? 's' : ''}`} />
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Valor da parcela:</span>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="valorBase" checked={valorBase === 'original'} onChange={() => setValorBase('original')} />
                  <span>Valor original <span className="text-muted-foreground">(do boleto, como no Kamino — juros ficam na observação)</span></span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="valorBase" checked={valorBase === 'debitado'} onChange={() => setValorBase('debitado')} />
                  <span>Valor debitado <span className="text-muted-foreground">(original + juros)</span></span>
                </label>
              </div>

              {plano.ignoradas.some((ig) => /já existe/i.test(ig.motivo)) && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {plano.ignoradas.filter((ig) => /já existe/i.test(ig.motivo)).length} linha(s) já constam na ficha de recompra do aluno e serão puladas.
                </p>
              )}

              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left w-8"></th>
                      <th className="px-2 py-2 text-left">Aluno (planilha)</th>
                      <th className="px-2 py-2 text-left">Aluno no GC</th>
                      <th className="px-2 py-2 text-left">Assessor</th>
                      <th className="px-2 py-2 text-left">Venc.</th>
                      <th className="px-2 py-2 text-right">Parcela</th>
                      <th className="px-2 py-2 text-left">Doc.</th>
                      <th className="px-2 py-2 text-left">Destino</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m, idx) => {
                      const jaExiste = plano.ignoradas.find((ig) => ig.row.rowIndex === m.row.rowIndex && /já existe/i.test(ig.motivo));
                      const escolhido = m.studentId ? students.find((s) => s.id === m.studentId) : undefined;
                      const decidido = !!m.studentId || !!m.criarComNomePlanilha;
                      const desabilitado = m.status === 'invalido';
                      const rowBg =
                        m.status === 'invalido'
                          ? 'bg-rose-50/60'
                          : !decidido
                            ? 'bg-amber-50/60'
                            : jaExiste
                              ? 'bg-muted/40 text-muted-foreground'
                              : '';
                      return (
                        <tr key={m.row.rowIndex} className={`border-t border-border ${rowBg}`}>
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={!!incluir[idx] && decidido}
                              disabled={desabilitado || !decidido || importing}
                              onChange={(e) => setIncluir((p) => ({ ...p, [idx]: e.target.checked }))}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="font-medium text-foreground">{m.row.aluno}</div>
                            <div className="text-[10px] text-muted-foreground">linha {m.row.rowIndex}{m.row.extra ? ` · ${m.row.extra}` : ''}</div>
                          </td>
                          <td className="px-2 py-1.5 min-w-[220px]">
                            {m.status === 'invalido' ? (
                              <span className="text-rose-700">{m.motivo}</span>
                            ) : escolhido ? (
                              <div className="flex items-center gap-1.5">
                                <div>
                                  <div className="text-foreground">{escolhido.name}</div>
                                  <div className="text-[10px] text-muted-foreground">{escolhido.product} · AC {escolhido.ac || '—'}</div>
                                </div>
                                {m.status !== 'ok' && (
                                  <button onClick={() => limparEscolha(idx)} className="text-[10px] text-muted-foreground hover:text-foreground underline" disabled={importing}>
                                    trocar
                                  </button>
                                )}
                              </div>
                            ) : m.criarComNomePlanilha ? (
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 text-teal-800">
                                  <UserPlus size={12} /> Nova ficha com o nome da planilha
                                </span>
                                <button onClick={() => limparEscolha(idx)} className="text-[10px] text-muted-foreground hover:text-foreground underline" disabled={importing}>
                                  trocar
                                </button>
                              </div>
                            ) : m.status === 'ambiguo' ? (
                              <div className="space-y-1">
                                <div className="text-amber-800">{m.motivo}</div>
                                <select
                                  className="w-full border border-border rounded-lg px-2 py-1 bg-card text-xs"
                                  defaultValue=""
                                  onChange={(e) => {
                                    const s = m.candidatos.find((c) => c.id === e.target.value);
                                    if (s) escolherAluno(idx, s);
                                  }}
                                  disabled={importing}
                                >
                                  <option value="">Escolher aluno…</option>
                                  {m.candidatos.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name} — {c.product} (AC {c.ac || '—'})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <AlunoPicker
                                students={students}
                                assessor={m.row.assessor}
                                onPick={(s) => escolherAluno(idx, s)}
                                onCriar={() => criarComPlanilha(idx)}
                                disabled={importing}
                              />
                            )}
                          </td>
                          <td className="px-2 py-1.5">{m.row.assessor || '—'}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{fmtData(m.row.vencimento)}</td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap font-medium">
                            {m.status === 'invalido' ? '—' : fmtBRL(valorParcelaRecompra(m.row, valorBase))}
                            {m.row.juros != null && m.row.juros > 0 && (
                              <div className="text-[10px] text-muted-foreground font-normal">juros {fmtBRL(m.row.juros)}</div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{m.row.documento || '—'}{m.row.banco ? <div className="text-[10px] text-muted-foreground">{m.row.banco}</div> : null}</td>
                          <td className="px-2 py-1.5">
                            {m.status === 'invalido' || !decidido ? (
                              <span className="text-muted-foreground">—</span>
                            ) : jaExiste ? (
                              <span className="text-amber-800">Já existe — pulada</span>
                            ) : (
                              <DestinoLabel plano={plano} match={m} students={students} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <p className="text-xs text-muted-foreground">
                  Linhas amarelas precisam de decisão (escolha o aluno ou crie a ficha com o nome da planilha). Desmarque o que não deve subir.
                </p>
                <button
                  onClick={handleConfirm}
                  disabled={!podeConfirmar}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
                  {importing ? 'Importando…' : `Importar ${plano.totalParcelas} parcela${plano.totalParcelas !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Auxiliares de UI ────────────────────────────────────────────────────────

function DestinoLabel({ plano, match, students }: { plano: RecompraImportPlan; match: RecompraRowMatch; students: Student[] }) {
  const nome = match.studentId ? students.find((s) => s.id === match.studentId)?.name ?? '' : match.row.aluno;
  const chave = normalizeNome(nome);
  const anexo = plano.anexos.find((a) => normalizeNome(a.studentName) === chave);
  if (anexo) return <span className="text-sky-800">Anexa à ficha de recompra existente</span>;
  const nova = plano.novas.find((n) => normalizeNome(n.name) === chave);
  if (nova) return <span className="text-teal-800">Nova ficha ({nova.totalInstallments} parc. · AC {nova.ac || '—'})</span>;
  return <span className="text-muted-foreground">—</span>;
}

function AlunoPicker({
  students,
  assessor,
  onPick,
  onCriar,
  disabled,
}: {
  students: Student[];
  assessor: string;
  onPick: (s: Student) => void;
  onCriar: () => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const opcoes = useMemo(() => {
    const termo = normalizeNome(q);
    if (termo.length < 3) return [];
    const vistos = new Set<string>();
    const out: Student[] = [];
    const acAlvo = normalizeNome(assessor).split(' ')[0];
    const ordenados = [...students]
      .filter((s) => !isRecompraFicha(s) && normalizeNome(s.name).includes(termo))
      .sort((a, b) => {
        const aAc = acAlvo && normalizeNome(a.ac).startsWith(acAlvo) ? 0 : 1;
        const bAc = acAlvo && normalizeNome(b.ac).startsWith(acAlvo) ? 0 : 1;
        return aAc - bAc || a.name.localeCompare(b.name);
      });
    for (const s of ordenados) {
      const k = `${normalizeNome(s.name)}|${s.id}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push(s);
      if (out.length >= 8) break;
    }
    return out;
  }, [q, students, assessor]);

  return (
    <div className="space-y-1">
      <div className="text-amber-800">Aluno não encontrado no GC</div>
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar aluno na carteira…"
          className="w-full border border-border rounded-lg pl-6 pr-2 py-1 bg-card text-xs"
          disabled={disabled}
        />
      </div>
      {opcoes.length > 0 && (
        <div className="border border-border rounded-lg bg-card divide-y divide-border max-h-40 overflow-y-auto">
          {opcoes.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              className="w-full text-left px-2 py-1 hover:bg-muted text-xs"
              disabled={disabled}
            >
              <div className="text-foreground">{s.name}</div>
              <div className="text-[10px] text-muted-foreground">{s.product} · AC {s.ac || '—'}</div>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onCriar}
        className="inline-flex items-center gap-1 text-[11px] text-teal-800 hover:underline"
        disabled={disabled}
      >
        <UserPlus size={11} /> Criar ficha com o nome da planilha
      </button>
    </div>
  );
}

function Stat({ label, value, color, hint }: { label: string; value: string; color: 'emerald' | 'rose' | 'slate' | 'amber'; hint?: string }) {
  const map = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    rose: 'bg-rose-50 border-rose-200 text-rose-900',
    slate: 'bg-muted/50 border-border text-foreground',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
  };
  return (
    <div className={`rounded-xl border p-3 ${map[color]}`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      {hint && <div className="text-[10px] opacity-70 mt-0.5">{hint}</div>}
    </div>
  );
}
