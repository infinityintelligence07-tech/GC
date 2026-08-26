import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { useAppStore } from '@/store/useAppStore';
import { TabKey, PermissionTab, canViewTab, canManageUsers } from '@/types';
import DashboardPage from '@/pages/DashboardPage';
import StudentsPage from '@/pages/StudentsPage';
import TeamPage from '@/pages/TeamPage';
import RendaExtraPage from '@/pages/RendaExtraPage';
import ConfigPage from '@/pages/ConfigPage';
import ConfigUsuariosPage from '@/pages/ConfigUsuariosPage';
import ACPortfolioPage from '@/pages/ACPortfolioPage';
import PerfilPage from '@/pages/PerfilPage';
import CancelamentosPage from '@/pages/CancelamentosPage';
import ConciliacaoPage from '@/pages/ConciliacaoPage';
import ComissoesPage from '@/pages/ComissoesPage';
import EstornosPage from '@/pages/EstornosPage';
import RegistrosPage from '@/pages/RegistrosPage';
import ReguaPage from '@/pages/ReguaPage';
import ExtratoConferenciaPage from '@/pages/ExtratoConferenciaPage';
import RankingPage from '@/pages/RankingPage';
import LoginPage from '@/pages/LoginPage';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseSync } from '@/hooks/useSupabaseSync';

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
  config: 'config',
  perfil: 'always',
  registros: 'admin',
};

const TAB_ORDER: TabKey[] = ['dashboard', 'alunos', 'equipe', 'ac', 'ranking', 'rendaExtra', 'cancelamentos', 'comissoes', 'estornos', 'conciliacao', 'extrato', 'config', 'configUsuarios', 'regua', 'perfil', 'registros'];


const Index = () => {
  const { activeTab, currentUser, setActiveTab } = useAppStore();
  const { session, loading } = useAuth();
  // Sync ACs/Products/Tags/Rules do Supabase pro store local (Fase 1)
  useSupabaseSync();

  const isAllowed = (tab: TabKey): boolean => {
    if (tab === 'configUsuarios') return canManageUsers(currentUser);
    const p = TAB_TO_PERMISSION[tab];
    if (p === 'always') return true;
    return canViewTab(currentUser, p);
  };

  // Primeira aba liberada para esse usuário (fallback de redirecionamento)
  const fallback: TabKey = TAB_ORDER.find(isAllowed) ?? 'perfil';

  // If active tab is not allowed for this user, redirect to first allowed
  useEffect(() => {
    if (currentUser && !isAllowed(activeTab)) {
      setActiveTab(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, activeTab]);

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

  const effectiveTab: TabKey = isAllowed(activeTab) ? activeTab : fallback;

  const renderPage = () => {
    switch (effectiveTab) {
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
      case 'registros': return <RegistrosPage />;
      default: return <PerfilPage />;

    }
  };

  return (
    <AppLayout>
      {renderPage()}
    </AppLayout>
  );
};

export default Index;
