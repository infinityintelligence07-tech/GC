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
import { Plus, Trash2, Edit2, Check, X, Upload, SplitSquareHorizontal, ShieldCheck, User, Lock, Eye, EyeOff, Tag, Save, Info, AlertTriangle, Building2, Target } from 'lucide-react';
import { AC, AppUser, UserRole, UserPermissions, PermissionLevel, PERMISSION_TABS, getEffectivePermissions, canConfirmarPagamento } from '@/types';
import { getTagCSSColor } from '@/lib/tagColors';

export default function ConfigPage() {
  const { rules, setRules, acs, addAC, updateAC, deleteAC, students, products, addProduct, updateProduct, deleteProduct,
    appUsers, currentUser, addUser, updateUser, deleteUser,
    studentTags, addStudentTag, updateStudentTag, deleteStudentTag } = useAppStore();
  const { companies, activeCompanyId } = useCompanyStore();
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

  // ── User management state ─────────────────────────────────────────────────
  const EMPTY_PERMS: UserPermissions = {
    dashboard: 'none', alunos: 'none', equipe: 'none', rendaExtra: 'none', cancelamentos: 'none', comissoes: 'none', estornos: 'none', conciliacao: 'none', config: 'none',
  };

  // Tipos de usuário disponíveis (rótulo só — o controle real é via Permissões)
  const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
    { value: 'admin', label: 'Admin' },
    { value: 'ac', label: 'Assessor de Conta' },
    { value: 'acn2', label: 'Assessor de Conta N2' },
    { value: 'juridico', label: 'Jurídico' },
    { value: 'conciliacao', label: 'Conciliação' },
  ];

  const [newUserName, setNewUserName] = useState('');
  const [newUserLogin, setNewUserLogin] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserACId, setNewUserACId] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole | ''>('');
  const [newUserPermissions, setNewUserPermissions] = useState<UserPermissions>(EMPTY_PERMS);
  const [newUserCanConfirmar, setNewUserCanConfirmar] = useState(false);
  const [newUserCompanyIds, setNewUserCompanyIds] = useState<string[]>(activeCompanyId ? [activeCompanyId] : []);
  const [showNewUserPwd, setShowNewUserPwd] = useState(false);
  const [showEditUserPwd, setShowEditUserPwd] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserLogin, setEditUserLogin] = useState('');
  const [editUserPassword, setEditUserPassword] = useState('');
  const [editUserACId, setEditUserACId] = useState('');
  const [editUserRole, setEditUserRole] = useState<UserRole>('ac');
  const [editUserPermissions, setEditUserPermissions] = useState<UserPermissions>(EMPTY_PERMS);
  const [editUserCanConfirmar, setEditUserCanConfirmar] = useState(false);
  const [editUserCompanyIds, setEditUserCompanyIds] = useState<string[]>([]);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [userSaveError, setUserSaveError] = useState('');



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


  // Fallback: deriva role pelas permissões (caso o admin não escolha o tipo manualmente).
  const derivedRoleFrom = (perms: UserPermissions): UserRole => {
    const all = PERMISSION_TABS.filter(({ key }) => key !== 'admin').every(({ key }) => perms[key] === 'edit');
    return all ? 'admin' : 'ac';
  };

  const handleAddUser = async () => {
    if (!newUserName.trim() || !newUserLogin.trim() || !newUserPassword.trim() || savingUser) return;
    setSavingUser(true);
    setUserSaveError('');
    const effectiveRole = (newUserRole || derivedRoleFrom(newUserPermissions)) as UserRole;
    let acIdToLink: string | undefined = newUserACId || undefined;
    try {
      // Auto-criação: se o usuário é AC/AC N2 e não tem AC vinculado, cria automaticamente
      const shouldAutoCreateAC =
        (effectiveRole === 'ac' || effectiveRole === 'acn2') &&
        (!newUserACId || newUserACId === '__new__');

      if (shouldAutoCreateAC) {
        const fallbackPhoto =
          acs.find((a) => a.name.trim().toLowerCase() === newUserName.trim().toLowerCase() && a.photo)?.photo ||
          undefined;
        const row = await createAC({ name: newUserName.trim(), active: true, photo: fallbackPhoto });
        acIdToLink = row.id;
        useAppStore.setState((s) => ({ acs: [...s.acs, { id: row.id, name: row.name, active: row.active, photo: row.photo ?? undefined }] }));
      }

      const perCompanyAcIds = activeCompanyId && acIdToLink ? { [activeCompanyId]: acIdToLink } : undefined;
      await addUser({
        name: newUserName.trim(),
        login: newUserLogin.trim(),
        password: newUserPassword,
        role: effectiveRole,
        acId: acIdToLink,
        perCompanyAcIds,
        permissions: newUserPermissions,
        canConfirmarPagamento: newUserCanConfirmar,
        companyIds: newUserCompanyIds.length > 0 ? newUserCompanyIds : (activeCompanyId ? [activeCompanyId] : []),
      });
      setNewUserName(''); setNewUserLogin(''); setNewUserPassword('');
      setNewUserACId(''); setNewUserRole(''); setNewUserPermissions(EMPTY_PERMS);
      setNewUserCanConfirmar(false);
      setNewUserCompanyIds(activeCompanyId ? [activeCompanyId] : []);
      setShowAddUserForm(false);
    } catch (e: any) {
      console.error('Falha ao criar usuário:', e);
      setUserSaveError(e?.code === '23505' ? 'Este login já existe. Use outro login.' : 'Não foi possível salvar o usuário. Tente novamente.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleSaveUser = () => {
    if (!editingUser) return;
    const patch: any = {
      name: editUserName.trim(),
      login: editUserLogin.trim(),
      role: editUserRole,
      permissions: editUserPermissions,
      canConfirmarPagamento: editUserCanConfirmar,
      companyIds: editUserCompanyIds,
      perCompanyAcIds: activeCompanyId
        ? { ...(editingUser.perCompanyAcIds ?? {}), [activeCompanyId]: editUserACId || null }
        : editingUser.perCompanyAcIds,
    };
    // Só envia senha se admin digitou uma nova (campo vazio = mantém atual)
    if (editUserPassword && editUserPassword.trim().length > 0) {
      patch.password = editUserPassword;
    }
    updateUser(editingUser.id, patch);
    setEditingUser(null);
  };

  const startEditUser = (u: AppUser) => {
    setEditingUser(u);
    setEditUserName(u.name);
    setEditUserLogin(u.login);
    setEditUserPassword(''); // não pré-preenchido — admin digita só se quiser trocar
    setShowEditUserPwd(false);
    setEditUserACId((activeCompanyId ? u.perCompanyAcIds?.[activeCompanyId] : undefined) ?? u.acId ?? '');
    setEditUserRole(u.role);
    const current = getEffectivePermissions(u);
    setEditUserPermissions({ ...EMPTY_PERMS, ...current });
    setEditUserCanConfirmar(u.canConfirmarPagamento === true);
    setEditUserCompanyIds(u.companyIds ?? (activeCompanyId ? [activeCompanyId] : []));
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
                      ? 'Nenhum usuário AC disponível — cadastre primeiro em Controle de Acesso'
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
            <input className="input-field w-full mt-1" type="number" step="1" min="1" value={rules.maxParcelasRenegociacao} onChange={(e) => setRules({ maxParcelasRenegociacao: Number(e.target.value) })} />
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

      {/* ── Usuários (admin only) ──────────────────────────────────────────────── */}
      {currentUser?.role === 'admin' && (
        <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Controle de Acesso — Usuários</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Gerencie quem pode acessar o sistema e com qual nível de permissão.</p>

          {/* User list */}
          <div className="space-y-2 mb-5">
            {appUsers.map((u) => (
              <div key={u.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                  {u.name.charAt(0)}
                </div>
                {editingUser?.id === u.id ? (
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input className="input-field text-xs py-1" placeholder="Nome" value={editUserName} onChange={(e) => setEditUserName(e.target.value)} />
                    <input className="input-field text-xs py-1" placeholder="Login" value={editUserLogin} onChange={(e) => setEditUserLogin(e.target.value)} />
                    <div className="col-span-2 relative">
                      <input
                        className="input-field text-xs py-1 pr-8 w-full"
                        placeholder="Senha"
                        type={showEditUserPwd ? 'text' : 'password'}
                        value={editUserPassword}
                        onChange={(e) => setEditUserPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditUserPwd((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                        title={showEditUserPwd ? 'Ocultar senha' : 'Ver senha'}
                      >
                        {showEditUserPwd ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">Tipo</label>
                      <select className="input-field w-full text-xs py-1" value={editUserRole} onChange={(e) => setEditUserRole(e.target.value as UserRole)}>
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">Vincular a um AC (opcional)</label>
                      <select className="input-field w-full text-xs py-1" value={editUserACId} onChange={(e) => setEditUserACId(e.target.value)}>
                        <option value="">— Sem vínculo —</option>
                        {acs.filter((g) => g.active).map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>

                    <PermissionGrid
                      value={editUserPermissions}
                      onChange={setEditUserPermissions}
                      canToggleAdmin={currentUser?.permissions?.admin === 'edit'}
                    />


                    <ConfirmarPagamentoToggle
                      value={editUserCanConfirmar}
                      onChange={setEditUserCanConfirmar}
                    />

                    <CompanyAccessGrid
                      companies={companies}
                      value={editUserCompanyIds}
                      onChange={setEditUserCompanyIds}
                    />



                    <div className="col-span-2 flex gap-2 justify-end pt-1">
                      <button
                        onClick={() => setEditingUser(null)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-border bg-background hover:bg-muted text-muted-foreground transition-colors"
                      >
                        <X size={12} /> Cancelar
                      </button>
                      <button
                        onClick={handleSaveUser}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold iam-gradient text-primary-foreground hover:opacity-90 transition-opacity"
                      >
                        <Save size={12} /> Salvar alterações
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{u.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        @{u.login}{getUserACIdForActiveCompany(u) ? ` · ${acs.find((g) => g.id === getUserACIdForActiveCompany(u))?.name ?? getUserACIdForActiveCompany(u)}` : ''}
                      </p>
                      <PermissionsSummary user={u} />
                    </div>
                    <button onClick={() => startEditUser(u)} className="action-btn" title="Editar"><Edit2 size={12} /></button>
                    {u.id !== 'admin-default' && (
                      <button onClick={() => setDeleteUserId(u.id)} className="action-btn text-destructive" title="Excluir"><Trash2 size={12} /></button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Add new user form */}
          <div className="border-t border-border pt-4">
            {!showAddUserForm ? (
              <button
                onClick={() => setShowAddUserForm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold iam-gradient text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Plus size={14} /> Adicionar Usuário
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Adicionar Usuário</p>
                  <button
                    onClick={() => {
                      setShowAddUserForm(false);
                      setUserSaveError('');
                      setNewUserName(''); setNewUserLogin(''); setNewUserPassword('');
                      setNewUserACId(''); setNewUserRole(''); setNewUserPermissions(EMPTY_PERMS);
                      setNewUserCanConfirmar(false);
                    }}
                    className="action-btn"
                    title="Fechar"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1"><User size={11} className="inline mr-1" />Nome</label>
                    <input className="input-field w-full text-xs" placeholder="Nome completo" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1"><User size={11} className="inline mr-1" />Login</label>
                    <input className="input-field w-full text-xs" placeholder="Login de acesso" value={newUserLogin} onChange={(e) => setNewUserLogin(e.target.value)} />
                  </div>
                  <div className="relative">
                    <label className="block text-[11px] text-muted-foreground mb-1"><Lock size={11} className="inline mr-1" />Senha</label>
                    <input
                      className="input-field w-full text-xs pr-8"
                      type={showNewUserPwd ? 'text' : 'password'}
                      placeholder="Senha"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                    />
                    <button type="button" onClick={() => setShowNewUserPwd((v) => !v)} className="absolute right-2 top-7 text-muted-foreground hover:text-foreground">
                      {showNewUserPwd ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1"><ShieldCheck size={11} className="inline mr-1" />Tipo</label>
                    <select className="input-field w-full text-xs" value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as UserRole | '')}>
                      <option value="">— Selecione (opcional) —</option>
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">
                      Vincular a um AC <span className="text-muted-foreground/70">(opcional)</span>
                    </label>
                    <select className="input-field w-full text-xs" value={newUserACId} onChange={(e) => setNewUserACId(e.target.value)}>
                      <option value="">— Sem vínculo —</option>
                      <option value="__new__">+ Criar novo AC com o nome do usuário</option>
                      {acs.filter((g) => g.active).map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                    {newUserACId && newUserACId !== '' && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-sky-700 bg-sky-500/5 border border-sky-300/40 rounded-md px-2 py-1.5">
                        <Info size={11} className="shrink-0 mt-0.5" />
                        <span>
                          Vinculado a um AC: ao acessar <strong>Equipe</strong>, o usuário verá apenas a própria carteira
                          {newUserACId === '__new__' ? ' (criada com o nome dele).' : `: ${acs.find((g) => g.id === newUserACId)?.name ?? ''}.`}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-muted-foreground mb-2 flex items-center gap-1">
                      <ShieldCheck size={11} className="inline" /> Permissões
                      <span className="text-muted-foreground/70 font-normal">— escolha o que ele pode visualizar e editar em cada aba</span>
                    </label>
                    <PermissionGrid
                      value={newUserPermissions}
                      onChange={setNewUserPermissions}
                      canToggleAdmin={currentUser?.permissions?.admin === 'edit'}
                    />

                  </div>

                  <div className="sm:col-span-2">
                    <ConfirmarPagamentoToggle
                      value={newUserCanConfirmar}
                      onChange={setNewUserCanConfirmar}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <CompanyAccessGrid
                      companies={companies}
                      value={newUserCompanyIds}
                      onChange={setNewUserCompanyIds}
                    />
                  </div>

                </div>
                {userSaveError && (
                  <p className="mt-3 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                    {userSaveError}
                  </p>
                )}
                <button
                  onClick={handleAddUser}
                  disabled={!newUserName.trim() || !newUserLogin.trim() || !newUserPassword.trim() || savingUser}
                  className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold iam-gradient text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={13} /> {savingUser ? 'Salvando...' : 'Salvar Usuário'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

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
      {deleteUserId && (
        <DeleteModal
          onConfirm={() => { deleteUser(deleteUserId); setDeleteUserId(null); }}
          onClose={() => setDeleteUserId(null)}
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

// ─── Componentes auxiliares ──────────────────────────────────────────────────

function PermissionGrid({ value, onChange, canToggleAdmin = false }: { value: UserPermissions; onChange: (v: UserPermissions) => void; canToggleAdmin?: boolean }) {
  const setLevel = (key: string, level: PermissionLevel) => {
    onChange({ ...value, [key]: level });
  };

  const setAll = (level: PermissionLevel) => {
    const next: UserPermissions = {};
    PERMISSION_TABS.forEach(({ key }) => {
      // 'admin' só é tocado pelos masters; demais usuários nunca alteram esse campo
      if (key === 'admin') {
        next[key] = canToggleAdmin ? level : (value[key] ?? 'none');
      } else {
        next[key] = level;
      }
    });
    onChange(next);
  };

  return (
    <div className="col-span-2 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-end gap-2 mb-2 text-[10px]">
        <span className="text-muted-foreground mr-auto">Defina o nível de acesso para cada aba:</span>
        <button type="button" onClick={() => setAll('none')} className="px-2 py-0.5 rounded-md bg-background border border-border hover:bg-muted">Limpar tudo</button>
        <button type="button" onClick={() => setAll('view')} className="px-2 py-0.5 rounded-md bg-background border border-border hover:bg-muted">Só visualizar</button>
        <button type="button" onClick={() => setAll('edit')} className="px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20">Acesso total</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {PERMISSION_TABS.map(({ key, label }) => {
          const lvl = (value[key] ?? 'none') as PermissionLevel;
          const isAdminRow = key === 'admin';
          const isComissoesRow = key === 'comissoes';
          const isLocked = isAdminRow && !canToggleAdmin;
          const isAdminActive = isAdminRow && lvl === 'edit';
          const accent = isLocked
            ? (isAdminActive
                ? 'border-primary/40 bg-primary/5 text-primary cursor-not-allowed opacity-90'
                : 'border-dashed border-border bg-muted/40 text-muted-foreground cursor-not-allowed opacity-70')
            : lvl === 'edit'
              ? 'border-primary/40 bg-primary/5 text-primary'
              : lvl === 'view'
                ? 'border-sky-300 bg-sky-500/5 text-sky-700'
                : lvl === 'own'
                  ? 'border-violet-300 bg-violet-500/5 text-violet-700'
                  : 'border-border bg-background text-muted-foreground';
          return (
            <div key={key} className="flex items-center gap-2 py-1">
              <span className="flex-1 text-xs font-medium text-foreground truncate flex items-center gap-1.5">
                {label}
                {isAdminRow && !isAdminActive && isLocked && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border uppercase tracking-wide">Restrito</span>
                )}
                {isAdminActive && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 uppercase tracking-wide">Master</span>
                )}
              </span>
              <select
                value={lvl}
                disabled={isLocked}
                onChange={(e) => setLevel(key, e.target.value as PermissionLevel)}
                title={isLocked ? 'Apenas usuários master (Admin, Tiago Fiel, Marcos Fiel) podem alterar esta permissão' : undefined}
                className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-colors w-[140px] focus:outline-none focus:ring-2 focus:ring-primary/30 ${accent}`}
              >
                <option value="none">Sem acesso</option>
                <option value="view">Só visualizar</option>
                <option value="edit">Ver e editar</option>
                {isComissoesRow && <option value="own">Apenas visualizar sua comissão</option>}
              </select>
            </div>

          );
        })}
      </div>
    </div>
  );

}


function PermissionsSummary({ user }: { user: AppUser }) {
  const perms = getEffectivePermissions(user);
  const allowed = PERMISSION_TABS.filter(({ key }) => perms[key] === 'view' || perms[key] === 'edit' || perms[key] === 'own');
  const podeConfirmar = canConfirmarPagamento(user);

  if (allowed.length === 0 && !podeConfirmar) {
    return <p className="text-[10px] text-muted-foreground/70 mt-1">Sem permissões atribuídas</p>;
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {allowed.map(({ key, label }) => {
        const lvl = perms[key] as PermissionLevel;
        const isEdit = lvl === 'edit';
        const isOwn = lvl === 'own';
        const cls = isEdit
          ? 'bg-primary/10 text-primary'
          : isOwn
            ? 'bg-violet-500/10 text-violet-700'
            : 'bg-sky-500/10 text-sky-700';
        const title = isEdit ? 'Ver e editar' : isOwn ? 'Apenas visualizar sua comissão' : 'Só visualizar';
        const suffix = isEdit ? '' : isOwn ? ' 👤' : ' 👁';
        return (
          <span key={key} className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${cls}`} title={title}>
            {label}{suffix}
          </span>
        );
      })}
      {podeConfirmar && (
        <span
          className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700"
          title="Conciliação (confirmar pagamentos, quitações e acordos)"
        >
          💰 Conciliação
        </span>
      )}
    </div>
  );
}

function ConfirmarPagamentoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="col-span-2 rounded-xl border border-border bg-emerald-500/5 p-3 flex items-start gap-3">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-emerald-500' : 'bg-muted'
        }`}
        aria-pressed={value}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="flex-1">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          💰 Conciliação
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
          Permite ao usuário <strong>marcar parcelas como pagas</strong>, confirmar quitação e
          confirmar acordo de Renda Extra. Renegociar e ajustar parcelas continuam liberados pela
          permissão da aba Alunos. Admin sempre pode.
        </p>
      </div>
    </div>
  );
}

function CompanyAccessGrid({
  companies,
  value,
  onChange,
}: {
  companies: Array<{ id: string; name: string; color_primary: string; active: boolean }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <div className="col-span-2 rounded-xl border border-border bg-muted/20 p-3">
      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-1">
        <Building2 size={12} /> Empresas que pode acessar
      </p>
      <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed">
        Marque as empresas que este usuário poderá visualizar. Se marcar mais de uma, ele verá o
        botão de troca de empresa no topo. Se marcar apenas uma, o botão fica oculto.
      </p>
      <div className="flex flex-wrap gap-2">
        {companies.map((c) => {
          const checked = value.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                checked
                  ? 'bg-primary/10 border-primary/40 text-foreground'
                  : 'bg-background border-border text-muted-foreground hover:border-border/80'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full border border-border/50"
                style={{ background: c.color_primary }}
              />
              {c.name}
              {checked && <Check size={12} className="text-primary" />}
            </button>
          );
        })}
        {companies.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">Nenhuma empresa cadastrada.</p>
        )}
      </div>
    </div>
  );
}
