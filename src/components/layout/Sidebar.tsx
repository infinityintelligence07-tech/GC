import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { useAuth } from '@/hooks/useAuth';
import { TabKey, PermissionTab, canViewTab, canManageUsers } from '@/types';
import logoIamWhite from '@/assets/logo-iam-white.png';
import { BarChart3, GraduationCap, Users, DollarSign, Settings, User, ChevronDown, XCircle, LogOut, Trophy, ClipboardCheck, X, ScrollText, Award, Wallet, MessageSquareText, Landmark, ShieldCheck, Cloud } from 'lucide-react';

interface SidebarProps {
  /** Quando true, mostra a sidebar em mobile (drawer). Em desktop é sempre visível. */
  mobileOpen?: boolean;
  /** Chamada quando o usuário pede para fechar (overlay click, item click, X). */
  onMobileClose?: () => void;
}

interface NavItem {
  key: TabKey | 'sair';
  label: string;
  icon: React.ReactNode;
  separator?: boolean;
  // Aba que controla a visibilidade. 'always' = sempre visível (perfil/sair).
  permissionTab: PermissionTab | 'always';
}

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={17} strokeWidth={1.8} />, permissionTab: 'dashboard' },
  { key: 'alunos', label: 'Alunos', icon: <GraduationCap size={17} strokeWidth={1.8} />, separator: true, permissionTab: 'alunos' },
  { key: 'equipe', label: 'Equipe', icon: <Users size={17} strokeWidth={1.8} />, permissionTab: 'equipe' },
  { key: 'rendaExtra', label: 'Renda Extra', icon: <DollarSign size={17} strokeWidth={1.8} />, separator: true, permissionTab: 'rendaExtra' },
  { key: 'cancelamentos', label: 'Cancelamentos', icon: <XCircle size={17} strokeWidth={1.8} />, separator: true, permissionTab: 'cancelamentos' },
  { key: 'estornos', label: 'Estornos', icon: <Wallet size={17} strokeWidth={1.8} />, permissionTab: 'estornos' },
  { key: 'comissoes', label: 'Comissões', icon: <Award size={17} strokeWidth={1.8} />, permissionTab: 'comissoes' },
  { key: 'conciliacao', label: 'Conciliação', icon: <ClipboardCheck size={17} strokeWidth={1.8} />, permissionTab: 'conciliacao' },
  { key: 'extrato', label: 'Extrato de Conferência', icon: <Landmark size={17} strokeWidth={1.8} />, permissionTab: 'conciliacao' },
  { key: 'iamControl', label: 'IAM Control', icon: <Cloud size={17} strokeWidth={1.8} />, permissionTab: 'admin' },
  { key: 'config', label: 'Configurações', icon: <Settings size={17} strokeWidth={1.8} />, separator: true, permissionTab: 'config' },
  { key: 'perfil', label: 'Perfil', icon: <User size={17} strokeWidth={1.8} />, permissionTab: 'always' },
  { key: 'sair', label: 'Sair', icon: <LogOut size={17} strokeWidth={1.8} />, permissionTab: 'always' },
];

export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps = {}) {
  const { activeTab, setActiveTab, acs, setSelectedACId, selectedACId, currentUser, cancellationCases } = useAppStore();
  const conciliacaoItems = useConciliacaoStore((s) => s.items);
  const conciliacaoErrors = useConciliacaoStore((s) => s.importErrors);
  // Conta alunos distintos com ajustes pendentes (não número de ajustes)
  // Separa Renda Extra (badge cinza) do restante Kamino↔GC (badge âmbar)
  const conciliacaoPendingItems = conciliacaoItems.filter((i) => i.status === 'pendente' && i.tipo !== 'baixa_kamino');
  const isRendaExtraTipo = (t: string) => t === 'renda_extra_exclusao' || t === 'renda_extra_acordo';
  const rendaExtraItems = conciliacaoPendingItems.filter((i) => isRendaExtraTipo(i.tipo));
  const kaminoItems = conciliacaoPendingItems.filter((i) => !isRendaExtraTipo(i.tipo));
  const distinctStudentsKamino = new Set(kaminoItems.map((i) => i.studentId).filter(Boolean)).size;
  const distinctStudentsRE = new Set(rendaExtraItems.map((i) => i.studentId).filter(Boolean)).size;
  const errorCount = conciliacaoErrors.filter((e) => e.status === 'pendente').length;
  const conciliacaoCount = distinctStudentsKamino + errorCount;
  const rendaExtraCount = distinctStudentsRE;
  // Cancelamentos: contagem de casos com ação "Aguardando Contato"
  const cancelamentosCount = cancellationCases.filter(
    (c) => c.acao === 'Aguardando Contato'
  ).length;

  // Estornos: alunos (casos) com ao menos uma parcela de estorno não lançada
  const estornosPendentesCount = useMemo(() => {
    const pendingCaseIds = new Set<string>();
    cancellationCases.forEach((c) => {
      const plan = (c as any).refundPlan;
      if (!plan?.installments?.length) return;
      const hasPending = plan.installments.some((p: any) => !p.lancadoParaPagamento);
      if (hasPending) pendingCaseIds.add(c.id);
    });
    return pendingCaseIds.size;
  }, [cancellationCases]);
  const { signOut } = useAuth();
  const { companies, activeCompanyId } = useCompanyStore();
  const activeCompany = companies.find((c) => c.id === activeCompanyId);
  const sidebarLogo = activeCompany?.logo_url || logoIamWhite;
  const sidebarTitle = activeCompany?.title || activeCompany?.name || 'IAM - GC';
  const companyShortName = (activeCompany?.name || 'IAM').replace(/\s*-\s*GC\s*$/i, '').trim();
  const sidebarSubtitle = activeCompany?.subtitle || `Sistema ${companyShortName}`;
  const [equipeOpen, setEquipeOpen] = useState(activeTab === 'equipe' || activeTab === 'ac' || activeTab === 'ranking');
  const [configOpen, setConfigOpen] = useState(activeTab === 'config' || activeTab === 'regua' || activeTab === 'configUsuarios');

  const visibleItems = navItems.filter((item) =>
    item.permissionTab === 'always' ? true : canViewTab(currentUser, item.permissionTab)
  );

  // Vínculo opcional com AC: se o usuário tem acId, restringe Equipe à carteira dele.
  const isACScoped = !!currentUser?.acId;
  const activeACs = acs
    .filter((g) => g.active)
    .filter((g) => !isACScoped || g.id === currentUser?.acId);

  const handleNavClick = (key: TabKey | 'sair') => {
    if (key === 'sair') {
      signOut();
      return;
    }
    if (key === 'config') {
      setConfigOpen(!configOpen);
      if (!configOpen) {
        setActiveTab('config');
        onMobileClose?.();
      }
      return;
    }
    if (key === 'equipe') {
      setEquipeOpen(!equipeOpen);
      if (!equipeOpen) {
        // For ac/acn2, jumping to "equipe" should land on their own carteira
        if (isACScoped && currentUser?.acId) {
          setSelectedACId(currentUser.acId);
          setActiveTab('ac');
        } else {
          setActiveTab('equipe');
        }
        onMobileClose?.();
      }
    } else {
      setActiveTab(key as TabKey);
      onMobileClose?.();
    }
  };

  const handleACClick = (acId: string) => {
    setSelectedACId(acId);
    setActiveTab('ac');
    onMobileClose?.();
  };

  // Fecha o drawer mobile com ESC
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {/* Overlay mobile (fecha ao clicar fora) — escondido em desktop/tablet */}
      <div
        onClick={onMobileClose}
        aria-hidden
        className={`md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      <aside
        className={`fixed left-0 top-0 h-screen w-[260px] max-w-[85vw] bg-sidebar flex flex-col z-50 transform transition-transform duration-300 ease-out md:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
        }`}
        role="navigation"
        aria-label="Menu principal"
      >
        {/* Botão fechar — visível só em mobile */}
        <button
          onClick={onMobileClose}
          className="md:hidden absolute top-3 right-3 p-1.5 rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-colors"
          aria-label="Fechar menu"
        >
          <X size={18} />
        </button>
      {/* Logo */}
      <div className="px-6 py-7 flex items-center gap-3">
        <img src={sidebarLogo} alt={sidebarTitle} className="h-12 max-w-[68px] w-auto object-contain select-none" draggable={false} />
        <div className="pl-3 border-l border-sidebar-border/20 min-w-0">
          <h1 className="text-[13px] font-bold text-sidebar-primary-foreground tracking-tight leading-tight truncate">{sidebarTitle}</h1>
          <p className="text-[9px] text-sidebar-foreground/40 font-medium truncate">{sidebarSubtitle}</p>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto no-scrollbar pt-1">
        {visibleItems.map((item, idx) => {
          const isEquipe = item.key === 'equipe';
          const isConfig = item.key === 'config';
          const isSair = item.key === 'sair';
          const isActive = isEquipe
            ? activeTab === 'equipe' || activeTab === 'ac' || activeTab === 'ranking'
            : isConfig
              ? activeTab === 'config' || activeTab === 'regua' || activeTab === 'configUsuarios'
              : activeTab === item.key;

          const prevItem = visibleItems[idx - 1];
          const showSeparator = idx > 0 && (prevItem?.separator || isSair);

          return (
            <div key={item.key}>
              {showSeparator && (
                <div className="my-3 mx-3 border-t border-sidebar-border/20" />
              )}

              <button
                onClick={() => handleNavClick(item.key)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group ${
                  isSair
                    ? 'text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10'
                    : isActive
                      ? 'bg-sidebar-accent text-sidebar-primary-foreground shadow-sm'
                      : 'text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-sidebar-accent/40'
                }`}
              >
                <span className={`transition-colors duration-200 ${
                  isSair
                    ? 'text-sidebar-foreground/40 group-hover:text-destructive'
                    : isActive ? 'text-primary' : 'text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60'
                }`}>
                  {item.icon}
                </span>
                <span className="flex-1 text-left">{item.label}</span>
                {item.key === 'conciliacao' && conciliacaoCount > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums tracking-tight transition-all ring-1 ${
                      isActive
                        ? 'bg-amber-400/95 text-amber-950 ring-amber-300/40 shadow-[0_0_0_2px_rgba(251,191,36,0.15)]'
                        : 'bg-amber-400/90 text-amber-950 ring-amber-300/30 shadow-sm group-hover:bg-amber-300'
                    }`}
                    title={`${conciliacaoCount} pendência${conciliacaoCount !== 1 ? 's' : ''} de conciliação (Kamino ↔ GC)`}
                  >
                    {conciliacaoCount > 99 ? '99+' : conciliacaoCount}
                  </span>
                )}
                {item.key === 'conciliacao' && rendaExtraCount > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-medium tabular-nums tracking-tight transition-all ring-1 ${
                      isActive
                        ? 'bg-slate-300/90 text-slate-700 ring-slate-400/30'
                        : 'bg-slate-200/80 text-slate-600 ring-slate-300/40 group-hover:bg-slate-200'
                    }`}
                    title={`${rendaExtraCount} pendência${rendaExtraCount !== 1 ? 's' : ''} de Renda Extra`}
                  >
                    {rendaExtraCount > 99 ? '99+' : rendaExtraCount}
                  </span>
                )}
                {item.key === 'cancelamentos' && cancelamentosCount > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums tracking-tight transition-all ring-1 ${
                      isActive
                        ? 'bg-amber-400/95 text-amber-950 ring-amber-300/40 shadow-[0_0_0_2px_rgba(251,191,36,0.15)]'
                        : 'bg-amber-400/90 text-amber-950 ring-amber-300/30 shadow-sm group-hover:bg-amber-300'
                    }`}
                    title={`${cancelamentosCount} aluno${cancelamentosCount !== 1 ? 's' : ''} aguardando contato`}
                  >
                    {cancelamentosCount > 99 ? '99+' : cancelamentosCount}
                  </span>
                )}
                {item.key === 'estornos' && estornosPendentesCount > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums tracking-tight transition-all ring-1 ${
                      isActive
                        ? 'bg-amber-400/95 text-amber-950 ring-amber-300/40 shadow-[0_0_0_2px_rgba(251,191,36,0.15)]'
                        : 'bg-amber-400/90 text-amber-950 ring-amber-300/30 shadow-sm group-hover:bg-amber-300'
                    }`}
                    title={`${estornosPendentesCount} aluno${estornosPendentesCount !== 1 ? 's' : ''} com estorno pendente de lançamento`}
                  >
                    {estornosPendentesCount > 99 ? '99+' : estornosPendentesCount}
                  </span>
                )}
                {isEquipe && (
                  <span className={`transition-transform duration-200 ${equipeOpen ? 'rotate-0' : '-rotate-90'}`}>
                    <ChevronDown size={13} className="opacity-40" />
                  </span>
                )}
                {isConfig && (
                  <span className={`transition-transform duration-200 ${configOpen ? 'rotate-0' : '-rotate-90'}`}>
                    <ChevronDown size={13} className="opacity-40" />
                  </span>
                )}
              </button>

              {/* Configurações sub-items: Controle de Acesso + Régua */}
              {isConfig && configOpen && (
                <div className="ml-4 mt-1 space-y-0.5 slide-in">
                  {canManageUsers(currentUser) && (
                    <button
                      onClick={() => { setActiveTab('configUsuarios'); onMobileClose?.(); }}
                      className={`w-full flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                        activeTab === 'configUsuarios'
                          ? 'bg-sidebar-accent/70 text-sidebar-primary-foreground'
                          : 'text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/25'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                        activeTab === 'configUsuarios' ? 'bg-primary/25 text-primary-foreground' : 'bg-sidebar-accent/50 text-sidebar-foreground/50'
                      }`}>
                        <ShieldCheck size={11} strokeWidth={2} />
                      </div>
                      <span className="truncate">Usuários</span>
                    </button>
                  )}
                  <button
                    onClick={() => { setActiveTab('regua'); onMobileClose?.(); }}
                    className={`w-full flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                      activeTab === 'regua'
                        ? 'bg-sidebar-accent/70 text-sidebar-primary-foreground'
                        : 'text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/25'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                      activeTab === 'regua' ? 'bg-primary/25 text-primary-foreground' : 'bg-sidebar-accent/50 text-sidebar-foreground/50'
                    }`}>
                      <MessageSquareText size={11} strokeWidth={2} />
                    </div>
                    <span className="truncate">Régua</span>
                  </button>
                </div>
              )}

              {/* Equipe sub-items: Ranking (todos) + ACs */}
              {isEquipe && equipeOpen && (
                <div className="ml-4 mt-1 space-y-0.5 slide-in">
                  {/* Ranking — visível para todos */}
                  <button
                    onClick={() => setActiveTab('ranking')}
                    className={`w-full flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                      activeTab === 'ranking'
                        ? 'bg-sidebar-accent/70 text-sidebar-primary-foreground'
                        : 'text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/25'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                      activeTab === 'ranking' ? 'bg-amber-500/25 text-amber-400' : 'bg-sidebar-accent/50 text-sidebar-foreground/50'
                    }`}>
                      <Trophy size={11} strokeWidth={2} />
                    </div>
                    <span className="truncate">Ranking</span>
                  </button>
                </div>
              )}

              {/* AC Sub-items */}
              {isEquipe && equipeOpen && activeACs.length > 0 && (
                <div className="ml-4 mt-1 space-y-0.5 slide-in">
                  {activeACs.map((ac) => {
                    const isACActive = activeTab === 'ac' && selectedACId === ac.id;
                    return (
                      <button
                        key={ac.id}
                        onClick={() => handleACClick(ac.id)}
                        className={`w-full flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                          isACActive
                            ? 'bg-sidebar-accent/70 text-sidebar-primary-foreground'
                            : 'text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/25'
                        }`}
                      >
                        {ac.photo ? (
                          <img src={ac.photo} alt="" className="w-5 h-5 rounded-full object-cover ring-1 ring-sidebar-border/30" />
                        ) : (
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-colors ${
                            isACActive ? 'bg-primary/25 text-primary-foreground' : 'bg-sidebar-accent/50 text-sidebar-foreground/50'
                          }`}>
                            {ac.name.charAt(0)}
                          </div>
                        )}
                        <span className="truncate">{ac.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-3 pt-2 pb-3 border-t border-sidebar-border/20">
        {canViewTab(currentUser, 'admin') && (
          <button
            onClick={() => { setActiveTab('registros'); onMobileClose?.(); }}
            className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-lg text-[12px] font-medium transition-colors mb-2 ${
              activeTab === 'registros'
                ? 'bg-sidebar-accent/60 text-sidebar-foreground/80'
                : 'text-sidebar-foreground/35 hover:text-sidebar-foreground/60 hover:bg-sidebar-accent/30'
            }`}
            title="Registros de ações do sistema (últimos 7 dias)"
          >
            <ScrollText size={14} strokeWidth={1.8} className="opacity-70" />
            <span>Registros</span>
          </button>
        )}
        <div className="text-[10px] text-sidebar-foreground/20 font-medium px-4">© 2026 Sistema IAM</div>
      </div>

    </aside>
    </>
  );
}
