import { lazy, memo, Suspense, useEffect, useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { useAppStore } from '@/store/useAppStore';
import { TabKey, PermissionTab, canViewTab, canManageUsers } from '@/types';
import LoginPage from '@/pages/LoginPage';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';

const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const StudentsPage = lazy(() => import('@/pages/StudentsPage'));
const TeamPage = lazy(() => import('@/pages/TeamPage'));
const RendaExtraPage = lazy(() => import('@/pages/RendaExtraPage'));
const ConfigPage = lazy(() => import('@/pages/ConfigPage'));
const ConfigUsuariosPage = lazy(() => import('@/pages/ConfigUsuariosPage'));
const ACPortfolioPage = lazy(() => import('@/pages/ACPortfolioPage'));
const PerfilPage = lazy(() => import('@/pages/PerfilPage'));
const CancelamentosPage = lazy(() => import('@/pages/CancelamentosPage'));
const ConciliacaoPage = lazy(() => import('@/pages/ConciliacaoPage'));
const ComissoesPage = lazy(() => import('@/pages/ComissoesPage'));
const EstornosPage = lazy(() => import('@/pages/EstornosPage'));
const DocumentosPage = lazy(() => import('@/pages/DocumentosPage'));
const RegistrosPage = lazy(() => import('@/pages/RegistrosPage'));
const ReguaPage = lazy(() => import('@/pages/ReguaPage'));
const ExtratoConferenciaPage = lazy(() => import('@/pages/ExtratoConferenciaPage'));
const RankingPage = lazy(() => import('@/pages/RankingPage'));

function PageFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const PageSlot = memo(function PageSlot({ tab }: { tab: TabKey }) {
  switch (tab) {
    case 'dashboard': return <DashboardPage />;
    case 'alunos': return <StudentsPage />;
    case 'regua': return <ReguaPage />;
    case 'equipe': return <TeamPage />;
    case 'ac': return <ACPortfolioPage />;
    case 'ranking': return <RankingPage />;
    case 'rendaExtra': return <RendaExtraPage />;
    case 'config': return <ConfigPage />;
    case 'configUsuarios': return <ConfigUsuariosPage />;
    case 'perfil': return <PerfilPage />;
    case 'cancelamentos': return <CancelamentosPage />;
    case 'comissoes': return <ComissoesPage />;
    case 'estornos': return <EstornosPage />;
    case 'conciliacao': return <ConciliacaoPage />;
    case 'extrato': return <ExtratoConferenciaPage />;
    case 'documentos': return <DocumentosPage />;
    case 'registros': return <RegistrosPage />;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
});

// Mapeia cada aba para a permissão que a controla. 'ac' (sub-aba) compartilha 'equipe'.
const TAB_TO_PERMISSION: Record<TabKey, PermissionTab | 'always'> = {
  dashboard: 'dashboard',
  alunos: 'alunos',
  regua: 'config',
  configUsuarios: 'admin',
  equipe: 'equipe',
  ac: 'equipe',
  ranking: 'always',
  rendaExtra: 'rendaExtra',
  cancelamentos: 'cancelamentos',
  comissoes: 'comissoes',
  estornos: 'estornos',
  conciliacao: 'conciliacao',
  extrato: 'conciliacao',
  documentos: 'documentos',
  config: 'config',
  perfil: 'always',
  registros: 'admin',
};

const TAB_ORDER: TabKey[] = ['dashboard', 'alunos', 'equipe', 'ac', 'ranking', 'rendaExtra', 'cancelamentos', 'comissoes', 'estornos', 'conciliacao', 'extrato', 'documentos', 'config', 'configUsuarios', 'regua', 'perfil', 'registros'];


const Index = () => {
  const { activeTab, currentUser, setActiveTab } = useAppStore();
  const { session, loading } = useAuth();
  // Sync ACs/Products/Tags/Rules do Supabase pro store local (Fase 1)
  useSupabaseSync();
  const [shownTab, setShownTab] = useState<TabKey>(activeTab);
  const [pending, startTransition] = useTransition();

  const isAllowed = (tab: TabKey): boolean => {
    if (tab === 'configUsuarios') return canManageUsers(currentUser);
    const p = TAB_TO_PERMISSION[tab];
    if (p === 'always') return true;
    return canViewTab(currentUser, p);
  };

  // Primeira aba liberada para esse usuário (fallback de redirecionamento)
  const fallback: TabKey = TAB_ORDER.find(isAllowed) ?? 'perfil';
  const effectiveTab: TabKey = isAllowed(activeTab) ? activeTab : fallback;

  // If active tab is not allowed for this user, redirect to first allowed
  useEffect(() => {
    if (currentUser && !isAllowed(activeTab)) {
      setActiveTab(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, activeTab]);

  // A aba do menu muda na hora. A página pesada entra em transição, então o
  // clique não espera o Dashboard ou a carteira terminarem de calcular.
  useEffect(() => {
    if (!currentUser) return;
    if (shownTab === effectiveTab) return;
    startTransition(() => setShownTab(effectiveTab));
  }, [currentUser, effectiveTab, shownTab]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Login gate ────────────────────────────────────────────────────────────
  if (!session || !currentUser) {
    return <LoginPage />;
  }

  return (
    <AppLayout>
      {pending && <div className="h-0.5 mb-2 rounded-full bg-primary/70 animate-pulse" />}
      <Suspense fallback={<PageFallback />}>
        <PageSlot tab={shownTab} />
      </Suspense>
    </AppLayout>
  );
};

export default Index;
