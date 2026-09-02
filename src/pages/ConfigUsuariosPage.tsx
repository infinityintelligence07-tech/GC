import { useState } from 'react';
import { createAC } from '@/lib/supabaseMutations';
import { useAppStore } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import DeleteModal from '@/components/modals/DeleteModal';
import {
  Plus, Trash2, Edit2, Check, X, ShieldCheck, User, Lock, Eye, EyeOff, Save, Info, Building2,
} from 'lucide-react';
import {
  AppUser, UserRole, UserPermissions, PermissionLevel, PERMISSION_TABS,
  getEffectivePermissions, canConfirmarPagamento, canManageUsers,
} from '@/types';

const EMPTY_PERMS: UserPermissions = {
  dashboard: 'none', alunos: 'none', equipe: 'none', rendaExtra: 'none', cancelamentos: 'none',
  comissoes: 'none', estornos: 'none', conciliacao: 'none', documentos: 'none', config: 'none',
};

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'ac', label: 'Assessor de Conta' },
  { value: 'acn2', label: 'Assessor de Conta N2' },
  { value: 'juridico', label: 'Jurídico' },
  { value: 'conciliacao', label: 'Conciliação' },
];

const PROTECTED_USER_IDS = new Set(['admin-default', '00000000-0000-0000-0000-000000000001']);

export default function ConfigUsuariosPage() {
  const { appUsers, currentUser, addUser, updateUser, deleteUser, acs } = useAppStore();
  const { companies, activeCompanyId } = useCompanyStore();

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

  if (!canManageUsers(currentUser)) {
    return (
      <div className="max-w-3xl">
        <p className="text-sm text-muted-foreground">Você não tem permissão para gerenciar usuários.</p>
      </div>
    );
  }

  const derivedRoleFrom = (perms: UserPermissions): UserRole => {
    const all = PERMISSION_TABS.filter(({ key }) => key !== 'admin').every(({ key }) => perms[key] === 'edit');
    return all ? 'admin' : 'ac';
  };

  const getUserACIdForActiveCompany = (u: AppUser) =>
    (activeCompanyId ? u.perCompanyAcIds?.[activeCompanyId] : undefined) ??
    (acs.some((ac) => ac.id === u.acId) ? u.acId : '') ?? '';

  const handleAddUser = async () => {
    if (!newUserName.trim() || !newUserLogin.trim() || !newUserPassword.trim() || savingUser) return;
    setSavingUser(true);
    setUserSaveError('');
    const effectiveRole = (newUserRole || derivedRoleFrom(newUserPermissions)) as UserRole;
    let acIdToLink: string | undefined = newUserACId || undefined;
    try {
      const shouldAutoCreateAC =
        (effectiveRole === 'ac' || effectiveRole === 'acn2') &&
        (!newUserACId || newUserACId === '__new__');

      if (shouldAutoCreateAC) {
        const fallbackPhoto =
          acs.find((a) => a.name.trim().toLowerCase() === newUserName.trim().toLowerCase() && a.photo)?.photo ||
          undefined;
        const row = await createAC({ name: newUserName.trim(), active: true, photo: fallbackPhoto });
        acIdToLink = row.id;
        useAppStore.setState((s) => ({
          acs: [...s.acs, { id: row.id, name: row.name, active: row.active, photo: row.photo ?? undefined }],
        }));
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
    const patch: Partial<AppUser> = {
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
    if (editUserPassword.trim().length > 0) {
      patch.password = editUserPassword;
    }
    updateUser(editingUser.id, patch);
    setEditingUser(null);
  };

  const startEditUser = (u: AppUser) => {
    setEditingUser(u);
    setEditUserName(u.name);
    setEditUserLogin(u.login);
    setEditUserPassword('');
    setShowEditUserPwd(false);
    setEditUserACId((activeCompanyId ? u.perCompanyAcIds?.[activeCompanyId] : undefined) ?? u.acId ?? '');
    setEditUserRole(u.role);
    const current = getEffectivePermissions(u);
    setEditUserPermissions({ ...EMPTY_PERMS, ...current });
    setEditUserCanConfirmar(u.canConfirmarPagamento === true);
    setEditUserCompanyIds(u.companyIds ?? (activeCompanyId ? [activeCompanyId] : []));
  };

  const resetAddForm = () => {
    setShowAddUserForm(false);
    setUserSaveError('');
    setNewUserName(''); setNewUserLogin(''); setNewUserPassword('');
    setNewUserACId(''); setNewUserRole(''); setNewUserPermissions(EMPTY_PERMS);
    setNewUserCanConfirmar(false);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Controle de Acesso — Usuários</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Gerencie quem pode acessar o sistema e com qual nível de permissão.
        </p>

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
                    canToggleAdmin={canManageUsers(currentUser)}
                  />
                  <ConfirmarPagamentoToggle value={editUserCanConfirmar} onChange={setEditUserCanConfirmar} />
                  <CompanyAccessGrid companies={companies} value={editUserCompanyIds} onChange={setEditUserCompanyIds} />
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
                      @{u.login}
                      {getUserACIdForActiveCompany(u)
                        ? ` · ${acs.find((g) => g.id === getUserACIdForActiveCompany(u))?.name ?? getUserACIdForActiveCompany(u)}`
                        : ''}
                    </p>
                    <PermissionsSummary user={u} />
                  </div>
                  <button onClick={() => startEditUser(u)} className="action-btn" title="Editar"><Edit2 size={12} /></button>
                  {!PROTECTED_USER_IDS.has(u.id) && (
                    <button onClick={() => setDeleteUserId(u.id)} className="action-btn text-destructive" title="Excluir"><Trash2 size={12} /></button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

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
                <button onClick={resetAddForm} className="action-btn" title="Fechar"><X size={12} /></button>
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
                  {newUserACId && (
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
                    canToggleAdmin={canManageUsers(currentUser)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <ConfirmarPagamentoToggle value={newUserCanConfirmar} onChange={setNewUserCanConfirmar} />
                </div>
                <div className="sm:col-span-2">
                  <CompanyAccessGrid companies={companies} value={newUserCompanyIds} onChange={setNewUserCompanyIds} />
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

      {deleteUserId && (
        <DeleteModal
          onConfirm={() => { deleteUser(deleteUserId); setDeleteUserId(null); }}
          onClose={() => setDeleteUserId(null)}
        />
      )}
    </div>
  );
}

function PermissionGrid({ value, onChange, canToggleAdmin = false }: { value: UserPermissions; onChange: (v: UserPermissions) => void; canToggleAdmin?: boolean }) {
  const setLevel = (key: string, level: PermissionLevel) => {
    onChange({ ...value, [key]: level });
  };

  const setAll = (level: PermissionLevel) => {
    const next: UserPermissions = {};
    PERMISSION_TABS.forEach(({ key }) => {
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
                title={isLocked ? 'Apenas usuários master podem alterar esta permissão' : undefined}
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
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700" title="Conciliação (confirmar pagamentos, quitações e acordos)">
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
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${value ? 'bg-emerald-500' : 'bg-muted'}`}
        aria-pressed={value}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
      <div className="flex-1">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">💰 Conciliação</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
          Permite ao usuário <strong>marcar parcelas como pagas</strong>, confirmar quitação e
          confirmar acordo de Renda Extra. Admin sempre pode.
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
        botão de troca de empresa no topo.
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
              <span className="w-3 h-3 rounded-full border border-border/50" style={{ background: c.color_primary }} />
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
