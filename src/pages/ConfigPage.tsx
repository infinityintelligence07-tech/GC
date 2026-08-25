import { useState } from 'react';
import CompaniesSection from './ConfigPage.CompaniesSection';
import EstornosGoalsSection from '@/components/EstornosGoalsSection';
import IamControlSyncSection from '@/components/IamControlSyncSection';
import { createAC } from '@/lib/supabaseMutations';
import { useAppStore } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { supabase } from '@/integrations/supabase/client';
import { useAntecipacaoStore } from '@/store/useAntecipacaoStore';
import { useCommissionsStore } from '@/store/useCommissionsStore';
import { withSyncSuspended } from '@/hooks/useSupabaseSync';
import { toast } from 'sonner';
import TransferModal from '@/components/modals/TransferModal';
import DeleteModal from '@/components/modals/DeleteModal';
import DivisaoCarteiraModal from '@/components/modals/DivisaoCarteiraModal';
import { Plus, Trash2, Edit2, Check, X, Upload, SplitSquareHorizontal, ShieldCheck, Tag, AlertTriangle, Target } from 'lucide-react';
import { AC, AppUser } from '@/types';
import { getTagCSSColor } from '@/lib/tagColors';
import EsteiraAssessoresBlock from '@/components/ui/EsteiraAssessoresBlock';

export default function ConfigPage() {
  const { rules, setRules, acs, addAC, updateAC, deleteAC, students, products, addProduct, updateProduct, deleteProduct,
    appUsers, currentUser, updateUser,
    studentTags, addStudentTag, updateStudentTag, deleteStudentTag } = useAppStore();
  const { activeCompanyId } = useCompanyStore();
  const { rates: commissionRates, setRates: setCommissionRates } = useCommissionsStore();
  const [newACName, setNewACName] = useState('');
  const [editingAC, setEditingAC] = useState<string | null>(null);
  const [editACName, setEditACName] = useState('');
  const [metasACId, setMetasACId] = useState<string | null>(null);
  const [metasDraft, setMetasDraft] = useState<{ meta1: string; meta2: string; meta3: string }>({ meta1: '', meta2: '', meta3: '' });
  const [transferAC, setTransferAC] = useState<AC | null>(null);
  const [divisaoAC, setDivisaoAC] = useState<AC | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'product' | 'tag'; id: string } | null>(null);
  const [newACFromUserId, setNewACFromUserId] = useState('');
  const [acCreateError, setAcCreateError] = useState('');

  const [newProductName, setNewProductName] = useState('');

  // ── Tag management state ───────────────────────────────────────────────────
  const TAG_COLORS = ['blue', 'red', 'green', 'purple', 'orange', 'pink', 'yellow', 'slate', 'cyan', 'indigo'];
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('blue');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState('blue');

  const handleAddTag = () => {
    if (!newTagName.trim()) return;
    addStudentTag({ name: newTagName.trim(), color: newTagColor });
    setNewTagName('');
    setNewTagColor('blue');
  };
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editProductName, setEditProductName] = useState('');

  // ── Zerar sistema (Zona de Perigo) ────────────────────────────────────────
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);

  // ── Limpar TODOS os dados de alunos (Zona de Perigo) ──────────────────────
  // Apaga: alunos (origem Kamino ou manual), cancelamentos, antecipações,
  // itens e erros de conciliação. Preserva: assessores, usuários, permissões,
  // produtos, regras financeiras e tags.
  const [cleanAllModalOpen, setCleanAllModalOpen] = useState(false);
  const [cleanAllConfirmText, setCleanAllConfirmText] = useState('');
  const [cleaningAll, setCleaningAll] = useState(false);

  // ── Apagar alunos de UM AC específico (Zona de Perigo) ────────────────────
  const [cleanACModalOpen, setCleanACModalOpen] = useState(false);
  const [cleanACId, setCleanACId] = useState('');
  const [cleanACConfirmText, setCleanACConfirmText] = useState('');
  const [cleaningAC, setCleaningAC] = useState(false);

  const selectedACForClean = acs.find((a) => a.id === cleanACId) || null;
  const selectedACName = selectedACForClean?.name ?? '';
  const studentsOfSelectedAC = selectedACName
    ? students.filter((s) => s.ac === selectedACName || s.rendaExtraAC === selectedACName)
    : [];

  const handleCleanACData = async () => {
    if (!selectedACName || cleanACConfirmText !== 'APAGAR' || cleaningAC) return;
    setCleaningAC(true);
    try {
      const acName = selectedACName;
      const studentIds = studentsOfSelectedAC.map((s) => s.id);

      const ops: Array<PromiseLike<any>> = [
        // Cancelamentos vinculados ao AC (por nome ou pelos student_ids)
        supabase.from('cancellation_cases').delete().eq('ac', acName),
        // Antecipações pelo ac_id
        supabase.from('antecipacao_items').delete().eq('ac_id', cleanACId),
        // Conciliação por nome do AC
        supabase.from('conciliacao_items').delete().eq('ac', acName),
        // Alunos cuja carteira/renda extra é deste AC
        supabase.from('students').delete().or(`ac.eq.${acName},renda_extra_ac.eq.${acName}`),
      ];
      if (studentIds.length > 0) {
        ops.push(supabase.from('cancellation_cases').delete().in('student_id', studentIds));
        ops.push(supabase.from('conciliacao_items').delete().in('student_id', studentIds));
        ops.push(supabase.from('conciliacao_import_errors').delete().in('student_id', studentIds));
      }

      const results = await withSyncSuspended(() => Promise.all(ops));
      for (const r of results) {
        if (r.error) throw r.error;
      }

      // Atualiza estados locais
      useAppStore.setState((s) => ({
        students: s.students.filter((st) => st.ac !== acName && st.rendaExtraAC !== acName),
        cancellationCases: s.cancellationCases.filter(
          (c) => c.ac !== acName && !studentIds.includes(c.studentId || '')
        ),
      }));
      useAntecipacaoStore.setState((s) => ({ items: s.items.filter((i) => i.acId !== cleanACId) }));
      const conciliacaoStore = await import('@/store/useConciliacaoStore');
      conciliacaoStore.useConciliacaoStore.setState((s) => ({
        items: s.items.filter((i) => i.ac !== acName && !studentIds.includes(i.studentId || '')),
        importErrors: s.importErrors.filter((e) => !studentIds.includes(e.studentId || '')),
      }));

      toast.success(`Todos os dados do assessor "${acName}" foram removidos.`);
      setCleanACModalOpen(false);
      setCleanACConfirmText('');
      setCleanACId('');
    } catch (e: any) {
      console.error('Erro ao limpar dados do AC:', e);
      toast.error(`Erro ao limpar dados: ${e?.message ?? 'desconhecido'}`);
    } finally {
      setCleaningAC(false);
    }
  };

  const handleCleanAllData = async () => {
    if (cleanAllConfirmText !== 'LIMPAR' || cleaningAll) return;
    setCleaningAll(true);
    try {
      // Preservar cancelamentos que sustentam lançamentos de Estornos e Comissões:
      // - Cases com refundPlan (linhas visíveis na aba Estornos)
      // - Cases referenciados por comissões salvas (localStorage) para manter os cards
      // Também preservamos os students vinculados a esses cases para não quebrar a UI.
      const { data: preserveByRefund } = await supabase
        .from('cancellation_cases')
        .select('id, student_id')
        .not('refund_plan', 'is', null);

      let commissionCaseIds: string[] = [];
      try {
        const raw = localStorage.getItem('iam-comissoes-v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          const list = parsed?.state?.commissions ?? [];
          commissionCaseIds = list
            .map((c: any) => String(c?.cancellationCaseId ?? '').split('#')[0])
            .filter(Boolean);
        }
      } catch { /* noop */ }

      const preserveCaseIds = new Set<string>([
        ...(preserveByRefund ?? []).map((r: any) => r.id),
        ...commissionCaseIds,
      ]);

      // Para os cases preservados, precisamos buscar seus student_ids também
      let preserveStudentIds = new Set<string>(
        (preserveByRefund ?? []).map((r: any) => r.student_id).filter(Boolean),
      );
      if (commissionCaseIds.length > 0) {
        const { data: extraCases } = await supabase
          .from('cancellation_cases')
          .select('student_id')
          .in('id', commissionCaseIds);
        (extraCases ?? []).forEach((r: any) => { if (r.student_id) preserveStudentIds.add(r.student_id); });
      }

      // Apaga em paralelo todas as tabelas operacionais (estrutura/config preservada).
      const preserveCaseArr = Array.from(preserveCaseIds);
      const preserveStudentArr = Array.from(preserveStudentIds);

      const casesDelete = supabase.from('cancellation_cases').delete().not('id', 'is', null);
      const studentsDelete = supabase.from('students').delete().not('id', 'is', null);

      const results = await withSyncSuspended(() => Promise.all([
        preserveCaseArr.length > 0
          ? casesDelete.not('id', 'in', `(${preserveCaseArr.map((id) => `"${id}"`).join(',')})`)
          : casesDelete,
        supabase.from('antecipacao_items').delete().not('id', 'is', null),
        supabase.from('conciliacao_items').delete().not('id', 'is', null),
        supabase.from('conciliacao_import_errors').delete().not('id', 'is', null),
        preserveStudentArr.length > 0
          ? studentsDelete.not('id', 'in', `(${preserveStudentArr.map((id) => `"${id}"`).join(',')})`)
          : studentsDelete,
        supabase.from('notifications').delete().not('id', 'is', null),
      ]));
      for (const r of results) {
        if (r.error) throw r.error;
      }

      // Atualiza estados locais imediatamente, preservando o que foi mantido no banco
      useAppStore.setState((s) => ({
        students: s.students.filter((st) => preserveStudentIds.has(st.id)),
        cancellationCases: s.cancellationCases.filter((c) => preserveCaseIds.has(c.id)),
      }));
      useAntecipacaoStore.setState({ items: [] });
      const conciliacaoStore = await import('@/store/useConciliacaoStore');
      conciliacaoStore.useConciliacaoStore.setState({ items: [], importErrors: [] });
      const { useNotificationsStore } = await import('@/store/useNotificationsStore');
      useNotificationsStore.setState({ notifications: [] });

      toast.success('Dados removidos. Lançamentos de Estornos e Comissões foram preservados.');
      setCleanAllModalOpen(false);
      setCleanAllConfirmText('');
    } catch (e: any) {
      console.error('Erro ao limpar dados:', e);
      toast.error(`Erro ao limpar dados: ${e?.message ?? 'desconhecido'}`);
    } finally {
      setCleaningAll(false);
    }
  };


  // ── Zerar sistema (mantido para compatibilidade) ──────────────────────────
  const handleResetSystem = async () => {
    if (resetConfirmText !== 'ZERAR' || resetting) return;
    setResetting(true);
    try {
      const results = await withSyncSuspended(() => Promise.all([
        supabase.from('cancellation_cases').delete().not('id', 'is', null),
        supabase.from('antecipacao_items').delete().not('id', 'is', null),
        supabase.from('conciliacao_items').delete().not('id', 'is', null),
        supabase.from('conciliacao_import_errors').delete().not('id', 'is', null),
        supabase.from('students').delete().not('id', 'is', null),
        supabase.from('notifications').delete().not('id', 'is', null),
      ]));
      for (const r of results) {
        if (r.error) throw r.error;
      }

      useAppStore.setState({ students: [], cancellationCases: [] });
      useAntecipacaoStore.setState({ items: [] });
      const conciliacaoStore = await import('@/store/useConciliacaoStore');
      conciliacaoStore.useConciliacaoStore.setState({ items: [], importErrors: [] });
      const { useNotificationsStore } = await import('@/store/useNotificationsStore');
      useNotificationsStore.setState({ notifications: [] });

      toast.success('Sistema zerado com sucesso.');
      setResetModalOpen(false);
      setResetConfirmText('');
    } catch (e: any) {
      console.error('Erro ao zerar sistema:', e);
      toast.error(`Erro ao zerar sistema: ${e?.message ?? 'desconhecido'}`);
    } finally {
      setResetting(false);
    }
  };


  const handleAddAC = () => {
    if (!newACName.trim()) return;
    addAC({ id: '', name: newACName, active: true });
    setNewACName('');
  };

  // Cria um AC a partir de um usuário já cadastrado (AC ou AC N2) e vincula
  const handleCreateACFromUser = async () => {
    setAcCreateError('');
    if (!newACFromUserId) return;
    const user = appUsers.find((u) => u.id === newACFromUserId);
    if (!user) return;
    try {
      // Reaproveita a foto: usa a do usuário (perfil) ou, em fallback,
      // a foto de um AC com mesmo nome já existente em outra empresa.
      const fallbackPhoto =
        user.photo ||
        acs.find((a) => a.name.trim().toLowerCase() === user.name.trim().toLowerCase() && a.photo)?.photo ||
        undefined;
      const row = await createAC({ name: user.name, active: true, photo: fallbackPhoto });
      useAppStore.setState((s) => ({
        acs: [...s.acs, { id: row.id, name: row.name, active: row.active, photo: row.photo ?? undefined }],
      }));

      // vincula o usuário ao AC recém-criado
      await updateUser(user.id, {
        ...(!user.acId ? { acId: row.id } : {}),
        perCompanyAcIds: activeCompanyId ? { ...(user.perCompanyAcIds ?? {}), [activeCompanyId]: row.id } : user.perCompanyAcIds,
      });
      setNewACFromUserId('');
    } catch (e) {
      console.error('Falha ao criar AC a partir do usuário:', e);
      setAcCreateError('Não foi possível criar o Assessor. Tente novamente.');
    }
  };

  const handleDeleteAC = (ac: AC) => {
    const hasStudents = students.some((s) => s.ac === ac.name);
    if (hasStudents) {
      setTransferAC(ac);
    } else {
      deleteAC(ac.id);
    }
  };

  const handlePhotoUpload = (acId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateAC(acId, { photo: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const handleAddProduct = () => {
    if (!newProductName.trim()) return;
    addProduct({ id: '', name: newProductName });
    setNewProductName('');
  };

  const getUserACIdForActiveCompany = (u: AppUser) =>
    (activeCompanyId ? u.perCompanyAcIds?.[activeCompanyId] : undefined) ??
    (acs.some((ac) => ac.id === u.acId) ? u.acId : '') ?? '';

  return (
    <div className="max-w-3xl space-y-6">
      <CompaniesSection />
      {/* AC Management */}
      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <h3 className="text-sm font-semibold text-foreground mb-1">Assessores de Conta</h3>
        <p className="text-xs text-muted-foreground mb-4">Criação, edição e exclusão de assessores.</p>

        <EsteiraAssessoresBlock acs={acs} />

        <div className="space-y-2 mb-4">
          {acs.map((ac) => (
            <div key={ac.id} className="bg-muted/30 rounded-xl">
              <div className="flex items-center gap-3 p-3">
                {/* Photo */}
                <div className="relative group">
                  {ac.photo ? (
                    <img src={ac.photo} alt="" className="w-9 h-9 rounded-full object-cover" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {ac.name.charAt(0)}
                    </div>
                  )}
                  <label className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                    <Upload size={12} className="text-white" />
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhotoUpload(ac.id, e)} />
                  </label>
                </div>

                {editingAC === ac.id ? (
                  <>
                    <input className="input-field flex-1" value={editACName} onChange={(e) => setEditACName(e.target.value)} />
                    <button onClick={() => { updateAC(ac.id, { name: editACName }); setEditingAC(null); }} className="action-btn text-emerald-600"><Check size={12} /></button>
                    <button onClick={() => setEditingAC(null)} className="action-btn"><X size={12} /></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-foreground">{ac.name}</span>
                    <span className="hidden md:inline text-[10px] text-muted-foreground tabular-nums">
                      Metas: {ac.meta1 ?? rules.meta1}/{ac.meta2 ?? rules.meta2}/{ac.meta3 ?? rules.meta3}%
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-md ${ac.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                      {ac.active ? 'Ativo' : 'Inativo'}
                    </span>
                    <button
                      onClick={() => {
                        if (metasACId === ac.id) { setMetasACId(null); return; }
                        setMetasACId(ac.id);
                        setMetasDraft({
                          meta1: String(ac.meta1 ?? rules.meta1),
                          meta2: String(ac.meta2 ?? rules.meta2),
                          meta3: String(ac.meta3 ?? rules.meta3),
                        });
                      }}
                      className="action-btn text-amber-600"
                      title="Definir metas de reversão"
                    >
                      <Target size={12} />
                    </button>
                    <button onClick={() => { setEditingAC(ac.id); setEditACName(ac.name); }} className="action-btn"><Edit2 size={12} /></button>
                    <button onClick={() => updateAC(ac.id, { active: !ac.active })} className="action-btn text-primary">
                      {ac.active ? '⏸' : '▶'}
                    </button>
                    <button
                      onClick={() => setDivisaoAC(ac)}
                      className="action-btn !border-blue-300 !text-blue-600 hover:!bg-blue-50"
                      title="Dividir carteira"
                    >
                      <SplitSquareHorizontal size={12} />
                    </button>
                    <button onClick={() => handleDeleteAC(ac)} className="action-btn text-destructive"><Trash2 size={12} /></button>
                  </>
                )}
              </div>
              {metasACId === ac.id && (
                <div className="border-t border-border/60 px-3 py-3 bg-background/60 rounded-b-xl">
                  <p className="text-[11px] text-muted-foreground mb-2">
                    Metas de <strong>reversão (%)</strong> deste assessor — % de inscrições revertidas sobre o total de inscrições pedidas p/ cancelamento.
                    Deixe em branco para usar o padrão global ({rules.meta1}/{rules.meta2}/{rules.meta3}%).
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {(['meta1', 'meta2', 'meta3'] as const).map((k, i) => (
                      <label key={k} className="text-[10px] text-muted-foreground">
                        Meta {i + 1} (%)
                        <input
                          type="number" step="0.1" min={0} max={100}
                          className="input-field w-full mt-1"
                          value={metasDraft[k]}
                          placeholder={String(rules[k])}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => setMetasDraft((d) => ({ ...d, [k]: e.target.value }))}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2 mt-3">
                    <button
                      onClick={() => {
                        updateAC(ac.id, { meta1: undefined, meta2: undefined, meta3: undefined });
                        setMetasACId(null);
                      }}
                      className="px-3 py-1.5 rounded-lg text-[11px] bg-muted hover:bg-muted/70"
                    >
                      Usar padrão global
                    </button>
                    <button
                      onClick={() => {
                        const parse = (v: string) => {
                          const t = v.trim();
                          if (!t) return undefined;
                          const n = Number(t);
                          return Number.isFinite(n) ? n : undefined;
                        };
                        updateAC(ac.id, {
                          meta1: parse(metasDraft.meta1),
                          meta2: parse(metasDraft.meta2),
                          meta3: parse(metasDraft.meta3),
                        });
                        setMetasACId(null);
                        toast.success('Metas atualizadas');
                      }}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold iam-gradient text-primary-foreground"
                    >
                      Salvar metas
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {(() => {
          const eligibleUsers = appUsers.filter(
            (u) => (u.role === 'ac' || u.role === 'acn2') &&
              !getUserACIdForActiveCompany(u) &&
              (!activeCompanyId || (u.companyIds ?? []).includes(activeCompanyId)),
          );
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/30 border border-dashed border-border">
                <ShieldCheck size={14} className="text-primary shrink-0" />
                <select
                  className="input-field flex-1 text-xs"
                  value={newACFromUserId}
                  onChange={(e) => { setNewACFromUserId(e.target.value); setAcCreateError(''); }}
                  disabled={eligibleUsers.length === 0}
                >
                  <option value="">
                    {eligibleUsers.length === 0
                      ? 'Nenhum usuário AC disponível — cadastre primeiro em Configurações → Usuários'
                      : '— Selecione um usuário (AC ou AC N2) sem vínculo —'}
                  </option>
                  {eligibleUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} (@{u.login}) · {u.role === 'acn2' ? 'AC N2' : 'AC'}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCreateACFromUser}
                  disabled={!newACFromUserId}
                  className="px-3 py-2 rounded-lg text-xs font-medium iam-gradient text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <Plus size={13} /> Criar
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/80 px-1">
                Apenas usuários cadastrados como <strong>Assessor de Conta</strong> ou <strong>AC N2</strong> e ainda
                sem vínculo aparecem aqui. O AC também é criado automaticamente quando você cadastra o usuário.
              </p>
              {acCreateError && (
                <p className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-1.5">
                  {acCreateError}
                </p>
              )}
            </div>
          );
        })()}
      </div>

      {/* Products */}
      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <h3 className="text-sm font-semibold text-foreground mb-1">Treinamentos / Produtos</h3>
        <p className="text-xs text-muted-foreground mb-4">Produtos disponíveis para matrícula.</p>
        <div className="space-y-2 mb-4">
          {products.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
              {editingProduct === p.id ? (
                <>
                  <input className="input-field flex-1" value={editProductName} onChange={(e) => setEditProductName(e.target.value)} />
                  <button onClick={() => { updateProduct(p.id, { name: editProductName }); setEditingProduct(null); }} className="action-btn text-emerald-600"><Check size={12} /></button>
                  <button onClick={() => setEditingProduct(null)} className="action-btn"><X size={12} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-foreground">{p.name}</span>
                  <button onClick={() => { setEditingProduct(p.id); setEditProductName(p.name); }} className="action-btn"><Edit2 size={12} /></button>
                  <button onClick={() => setDeleteTarget({ type: 'product', id: p.id })} className="action-btn text-destructive"><Trash2 size={12} /></button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input-field flex-1" placeholder="Nome do Produto / Treinamento" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddProduct()} />
          <button onClick={handleAddProduct} className="px-3 py-2 rounded-lg text-xs font-medium iam-gradient text-primary-foreground">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Financial Rules */}
      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <h3 className="text-sm font-semibold text-foreground mb-1">Regras Financeiras</h3>
        <p className="text-xs text-muted-foreground mb-4">Configurações globais de multas, juros e descontos.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Multa por Atraso (%)</label>
            <input className="input-field w-full mt-1" type="number" step="0.1" value={rules.multaPercent} onChange={(e) => setRules({ multaPercent: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Juros Mensal (%)</label>
            <input className="input-field w-full mt-1" type="number" step="0.1" value={rules.jurosPercent} onChange={(e) => setRules({ jurosPercent: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Desconto Renda Extra (%)</label>
            <input className="input-field w-full mt-1" type="number" step="1" value={rules.descontoRendaExtra} onChange={(e) => setRules({ descontoRendaExtra: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Máx. Parcelas Renegociação</label>
            <input className="input-field w-full mt-1" type="number" step="1" min="1" value={rules.maxParcelasRenegociacao} onChange={(e) => {
              const v = Number(e.target.value);
              setRules({ maxParcelasRenegociacao: v, maxParcelasCadastro: v });
            }} />
          </div>
        </div>

        {/* Multas de Cancelamento */}
        <div className="mt-6 pt-5 border-t border-border/60">
          <h4 className="text-sm font-semibold text-foreground mb-1">Multas de Cancelamento</h4>
          <p className="text-xs text-muted-foreground mb-4">
            Percentuais aplicados automaticamente ao valor do contrato quando o aluno abre um pedido de cancelamento.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Com &gt; 30 dias de antecedência do evento (%)
              </label>
              <input
                className="input-field w-full mt-1"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={rules.multaCancelamentoComAntecedencia}
                onChange={(e) => setRules({ multaCancelamentoComAntecedencia: Number(e.target.value) })}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Padrão: 30%</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Com &lt; 30 dias de antecedência do evento (%)
              </label>
              <input
                className="input-field w-full mt-1"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={rules.multaCancelamentoSemAntecedencia}
                onChange={(e) => setRules({ multaCancelamentoSemAntecedencia: Number(e.target.value) })}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Padrão: 40%</p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-border/60">
          <h4 className="text-sm font-semibold text-foreground mb-1">Metas dos Assessores (Liquidez %)</h4>
          <p className="text-xs text-muted-foreground mb-4">
            Definem as 3 etapas do velocímetro de meta exibido no Ranking, na Dashboard e na carteira de cada AC.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Meta 1 (%)</label>
              <input className="input-field w-full mt-1" type="number" step="0.1" min="1" max="99" value={rules.meta1}
                onChange={(e) => setRules({ meta1: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Meta 2 (%)</label>
              <input className="input-field w-full mt-1" type="number" step="0.1" min="1" max="99" value={rules.meta2}
                onChange={(e) => setRules({ meta2: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Meta 3 (%)</label>
              <input className="input-field w-full mt-1" type="number" step="0.1" min="1" max="100" value={rules.meta3}
                onChange={(e) => setRules({ meta3: Number(e.target.value) })} />
            </div>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-border/60">
          <h4 className="text-sm font-semibold text-foreground mb-1">Metas de Reversão dos Assessores&nbsp;(%)</h4>
          <p className="text-xs text-muted-foreground mb-4">
            Definem as 3 etapas do gauge de reversão exibido na aba Comissões (baseado em inscrições revertidas / inscrições p/ cancelamento). Deixe em branco para usar as metas de liquidez acima.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Meta 1 (%)</label>
              <input className="input-field w-full mt-1" type="number" step="0.1" min="1" max="99"
                value={rules.metaReversao1 ?? ''}
                placeholder={String(rules.meta1)}
                onChange={(e) => setRules({ metaReversao1: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Meta 2 (%)</label>
              <input className="input-field w-full mt-1" type="number" step="0.1" min="1" max="99"
                value={rules.metaReversao2 ?? ''}
                placeholder={String(rules.meta2)}
                onChange={(e) => setRules({ metaReversao2: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Meta 3 (%)</label>
              <input className="input-field w-full mt-1" type="number" step="0.1" min="1" max="100"
                value={rules.metaReversao3 ?? ''}
                placeholder={String(rules.meta3)}
                onChange={(e) => setRules({ metaReversao3: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </div>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-border/60">
          <h4 className="text-sm font-semibold text-foreground mb-1">Percentuais de Comissão dos Assessores</h4>
          <p className="text-xs text-muted-foreground mb-4">
            Aplicado sobre o <b>valor revertido</b> do contrato. Padrão da casa: Boleto 0,5% · Pix 1% · Cartão 1%.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2">
            <label htmlFor="rate-boleto" className="text-xs font-medium text-muted-foreground leading-tight self-end">
              Boleto parcelado (%)
            </label>
            <label htmlFor="rate-pix" className="text-xs font-medium text-muted-foreground leading-tight self-end">
              Pix (%)
            </label>
            <label htmlFor="rate-cartao" className="text-xs font-medium text-muted-foreground leading-tight self-end">
              Cartão de Crédito (%)
            </label>

            <input id="rate-boleto" className="input-field w-full" type="number" step="0.1" min="0" max="100"
              value={commissionRates.boleto}
              onChange={(e) => setCommissionRates({ boleto: Number(e.target.value) })} />
            <input id="rate-pix" className="input-field w-full" type="number" step="0.1" min="0" max="100"
              value={commissionRates.pix}
              onChange={(e) => setCommissionRates({ pix: Number(e.target.value) })} />
            <input id="rate-cartao" className="input-field w-full" type="number" step="0.1" min="0" max="100"
              value={commissionRates.cartao}
              onChange={(e) => setCommissionRates({ cartao: Number(e.target.value) })} />
          </div>
        </div>

        <EstornosGoalsSection />
      </div>

      {/* Tags de Alunos */}
      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <div className="flex items-center gap-2 mb-1">
          <Tag size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Tags de Alunos</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Crie tags para categorizar alunos. Elas podem ser atribuídas e filtradas nas listas.</p>
        <div className="space-y-2 mb-4">
          {studentTags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
              {editingTag === tag.id ? (
                <>
                  <input className="input-field flex-1 text-xs" value={editTagName} onChange={(e) => setEditTagName(e.target.value)} />
                  <div className="flex gap-1">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditTagColor(c)}
                        className={`w-5 h-5 rounded-full border-2 transition-all bg-${c}-400 ${editTagColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: `var(--color-${c}-400, ${c})` }}
                      />
                    ))}
                  </div>
                  <button onClick={() => { updateStudentTag(tag.id, { name: editTagName, color: editTagColor }); setEditingTag(null); }} className="action-btn text-emerald-600"><Check size={12} /></button>
                  <button onClick={() => setEditingTag(null)} className="action-btn"><X size={12} /></button>
                </>
              ) : (
                <>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-lg bg-${tag.color}-100 text-${tag.color}-700 border border-${tag.color}-300`}
                    style={{
                      backgroundColor: `color-mix(in srgb, ${getTagCSSColor(tag.color)} 15%, white)`,
                      color: getTagCSSColor(tag.color),
                      borderColor: `color-mix(in srgb, ${getTagCSSColor(tag.color)} 40%, white)`,
                    }}
                  >
                    {tag.name}
                  </span>
                  <span className="flex-1" />
                  <button onClick={() => { setEditingTag(tag.id); setEditTagName(tag.name); setEditTagColor(tag.color); }} className="action-btn"><Edit2 size={12} /></button>
                  <button onClick={() => setDeleteTarget({ type: 'tag', id: tag.id })} className="action-btn text-destructive"><Trash2 size={12} /></button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <input className="input-field w-full" placeholder="Nome da Tag" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddTag()} />
          </div>
          <div className="flex gap-1 items-center">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewTagColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-all`}
                style={{
                  backgroundColor: getTagCSSColor(c),
                  borderColor: newTagColor === c ? '#1f2937' : 'transparent',
                  transform: newTagColor === c ? 'scale(1.15)' : 'scale(1)',
                }}
              />
            ))}
          </div>
          <button onClick={handleAddTag} className="px-3 py-2 rounded-lg text-xs font-medium iam-gradient text-primary-foreground">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <IamControlSyncSection />

      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <h3 className="text-sm font-semibold text-foreground mb-1">Sobre o Sistema</h3>
        <p className="text-xs text-muted-foreground">IAM - GC v1.0</p>
      </div>

      {transferAC && <TransferModal ac={transferAC} onClose={() => setTransferAC(null)} />}
      {divisaoAC && <DivisaoCarteiraModal ac={divisaoAC} onClose={() => setDivisaoAC(null)} />}
      {deleteTarget && (
        <DeleteModal
          onConfirm={() => {
            if (deleteTarget.type === 'product') deleteProduct(deleteTarget.id);
            if (deleteTarget.type === 'tag') deleteStudentTag(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* ── Zona de Perigo (admin only) ───────────────────────────────────── */}
      {currentUser?.role === 'admin' && (
        <section className="bg-card border border-destructive/40 rounded-2xl p-6 saas-shadow">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-destructive" />
            <h2 className="text-sm font-semibold text-destructive uppercase tracking-wider">Zona de Perigo</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            Apaga <strong>todos os alunos importados</strong>, casos de cancelamento e itens de Renda Extra/Antecipação.
            Indicadores do Dashboard, Equipe (carteira de cada AC), Renda Extra e Cancelamentos serão zerados.
            Assessores, usuários, produtos, tags e regras financeiras <strong>não</strong> são afetados.
            Esta ação é irreversível.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setResetConfirmText(''); setResetModalOpen(true); }}
              className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold inline-flex items-center gap-2 hover:opacity-90 transition"
            >
              <Trash2 size={13} />
              Zerar o Sistema
            </button>
            <button
              type="button"
              onClick={() => { setCleanAllConfirmText(''); setCleanAllModalOpen(true); }}
              className="px-4 py-2 rounded-lg border border-destructive/40 text-destructive text-xs font-semibold inline-flex items-center gap-2 hover:bg-destructive/5 transition"
              title="Apaga todos os alunos, cancelamentos, renda extra e itens de conciliação"
            >
              <Trash2 size={13} />
              Limpar todos os Dados
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-destructive/10 text-[10px] font-bold">
                {students.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setCleanACConfirmText(''); setCleanACId(''); setCleanACModalOpen(true); }}
              className="px-4 py-2 rounded-lg border border-destructive/40 text-destructive text-xs font-semibold inline-flex items-center gap-2 hover:bg-destructive/5 transition"
              title="Apaga todos os alunos, cancelamentos, renda extra e conciliação de UM assessor específico"
            >
              <Trash2 size={13} />
              Apagar Alunos de um Assessor
            </button>
          </div>
        </section>
      )}

      {/* Modal de confirmação dupla — Zerar Sistema */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={18} className="text-destructive" />
              <h3 className="text-base font-semibold text-foreground">Confirmar Zerar Sistema</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Esta ação irá apagar <strong>permanentemente</strong>:
            </p>
            <ul className="text-xs text-muted-foreground list-disc pl-5 mb-4 space-y-1">
              <li>Todos os alunos (e suas parcelas, históricos, tags)</li>
              <li>Todos os casos de cancelamento</li>
              <li>Todos os itens de Renda Extra / Antecipação</li>
              <li>Todos os indicadores derivados (Dashboard, Equipe)</li>
            </ul>
            <p className="text-xs text-foreground mb-2">
              Para confirmar, digite <span className="font-mono font-bold text-destructive">ZERAR</span> abaixo:
            </p>
            <input
              type="text"
              autoFocus
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value.toUpperCase())}
              className="input-field w-full text-sm mb-4"
              placeholder="Digite ZERAR"
              disabled={resetting}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setResetModalOpen(false); setResetConfirmText(''); }}
                disabled={resetting}
                className="px-4 py-2 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-muted/70 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleResetSystem}
                disabled={resetConfirmText !== 'ZERAR' || resetting}
                className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
              >
                <Trash2 size={13} />
                {resetting ? 'Zerando...' : 'Confirmar e Zerar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação — Limpar todos os Dados */}
      {cleanAllModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={18} className="text-destructive" />
              <h3 className="text-base font-semibold text-foreground">Limpar todos os Dados</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              Esta ação irá excluir <strong>permanentemente</strong>:
            </p>
            <ul className="text-xs text-muted-foreground list-disc pl-5 mb-3 space-y-1">
              <li>Todos os alunos (importados via Kamino ou cadastrados manualmente)</li>
              <li>Parcelas, históricos e tags vinculadas aos alunos</li>
              <li>Carteira de cada Assessor de Conta (aba Equipe)</li>
              <li>Todos os itens de Renda Extra</li>
              <li>Todos os casos de Cancelamento</li>
              <li>Todos os itens e erros de Conciliação</li>
              <li>Itens de Antecipação</li>
            </ul>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              <strong>Serão preservados:</strong> assessores, usuários, permissões, treinamentos/produtos, regras financeiras, tags e <strong>lançamentos de Estornos e Comissões</strong> (incluindo os cases e alunos vinculados a esses lançamentos).
            </p>

            <p className="text-xs text-foreground mb-2">
              Para confirmar, digite <span className="font-mono font-bold text-destructive">LIMPAR</span> abaixo:
            </p>
            <input
              type="text"
              autoFocus
              value={cleanAllConfirmText}
              onChange={(e) => setCleanAllConfirmText(e.target.value.toUpperCase())}
              className="input-field w-full text-sm mb-4"
              placeholder="Digite LIMPAR"
              disabled={cleaningAll}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setCleanAllModalOpen(false); setCleanAllConfirmText(''); }}
                disabled={cleaningAll}
                className="px-4 py-2 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-muted/70 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCleanAllData}
                disabled={cleanAllConfirmText !== 'LIMPAR' || cleaningAll}
                className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
              >
                <Trash2 size={13} />
                {cleaningAll ? 'Limpando...' : 'Confirmar e Limpar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — Apagar alunos de UM Assessor específico */}
      {cleanACModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={18} className="text-destructive" />
              <h3 className="text-base font-semibold text-foreground">Apagar Alunos de um Assessor</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              Selecione o assessor e <strong>todos os dados vinculados a ele</strong> serão excluídos permanentemente:
              alunos da carteira, parcelas, históricos, casos de cancelamento, itens de Renda Extra, antecipações e
              registros de conciliação. O assessor (cadastro), usuários, produtos e tags <strong>não</strong> são afetados.
            </p>

            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Assessor</label>
            <select
              value={cleanACId}
              onChange={(e) => { setCleanACId(e.target.value); setCleanACConfirmText(''); }}
              className="input-field w-full text-sm mb-3 mt-1"
              disabled={cleaningAC}
            >
              <option value="">— Selecione um assessor —</option>
              {acs.slice().sort((a, b) => a.name.localeCompare(b.name)).map((a) => {
                const count = students.filter((s) => s.ac === a.name || s.rendaExtraAC === a.name).length;
                return (
                  <option key={a.id} value={a.id}>{a.name} ({count} alunos)</option>
                );
              })}
            </select>

            {selectedACName && (
              <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3 mb-3">
                <p className="text-xs text-foreground">
                  Serão apagados <strong className="text-destructive">{studentsOfSelectedAC.length} alunos</strong> vinculados a <strong>{selectedACName}</strong>,
                  além de todos os cancelamentos, itens de Renda Extra, antecipações e conciliações deste assessor.
                </p>
              </div>
            )}

            <p className="text-xs text-foreground mb-2">
              Para confirmar, digite <span className="font-mono font-bold text-destructive">APAGAR</span> abaixo:
            </p>
            <input
              type="text"
              value={cleanACConfirmText}
              onChange={(e) => setCleanACConfirmText(e.target.value.toUpperCase())}
              className="input-field w-full text-sm mb-4"
              placeholder="Digite APAGAR"
              disabled={cleaningAC || !selectedACName}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setCleanACModalOpen(false); setCleanACConfirmText(''); setCleanACId(''); }}
                disabled={cleaningAC}
                className="px-4 py-2 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-muted/70 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCleanACData}
                disabled={!selectedACName || cleanACConfirmText !== 'APAGAR' || cleaningAC}
                className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
              >
                <Trash2 size={13} />
                {cleaningAC ? 'Apagando...' : 'Confirmar e Apagar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

