import { ReactNode, useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import CompanySwitcher from './CompanySwitcher';
import { useAppStore } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { RefreshCw, ShieldCheck, Users, Scale, Sun, Moon, Menu } from 'lucide-react';
import { useTheme } from 'next-themes';
import { getFormattedDateBrasilia, getFormattedTimeBrasilia } from '@/lib/brasiliaDate';
import { UserRole } from '@/types';
import TutorialCancelamentoButton from '@/components/TutorialCancelamentoButton';

// Converte #RRGGBB para "h s% l%" (sem 'hsl()'), formato esperado pelas CSS vars do shadcn.
function hexToHslTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const tabTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  alunos: 'Gestão de Alunos',
  equipe: 'Equipe & Configurações',
  ac: 'Carteira do Assessor',
  rendaExtra: 'Renda Extra',
  config: 'Configurações',
  perfil: 'Perfil',
  cancelamentos: 'Cancelamentos',
  conciliacao: 'Conciliação',
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  ac: 'Assessor de Conta',
  acn2: 'Assessor de Conta N2',
  juridico: 'Jurídico',
  conciliacao: 'Conciliação',
};

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  admin: <ShieldCheck size={11} strokeWidth={2} />,
  ac: <Users size={11} strokeWidth={2} />,
  acn2: <Users size={11} strokeWidth={2} />,
  juridico: <Scale size={11} strokeWidth={2} />,
  conciliacao: <ShieldCheck size={11} strokeWidth={2} />,
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-primary/8 text-primary border-primary/15',
  ac: 'bg-emerald-500/8 text-emerald-700 border-emerald-200/60',
  acn2: 'bg-sky-500/8 text-sky-700 border-sky-200/60',
  juridico: 'bg-amber-500/8 text-amber-700 border-amber-200/60',
  conciliacao: 'bg-violet-500/8 text-violet-700 border-violet-200/60',
};

export default function AppLayout({ children }: { children: ReactNode }) {
  const { activeTab, currentUser, acs, selectedACId } = useAppStore();
  const { companies, activeCompanyId } = useCompanyStore();
  const { theme, setTheme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Aplica paleta da empresa ativa nas CSS vars (--primary / --accent)
  useEffect(() => {
    const company = companies.find((c) => c.id === activeCompanyId);
    if (!company) return;
    const root = document.documentElement;
    const primary = hexToHslTriplet(company.color_primary);
    const accent = hexToHslTriplet(company.color_accent);
    if (primary) root.style.setProperty('--primary', primary);
    if (accent) root.style.setProperty('--accent', accent);
    return () => {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--accent');
    };
  }, [activeCompanyId, companies]);

  const selectedAC = acs.find((a) => a.id === selectedACId);
  const headerTitle =
    activeTab === 'ac' && selectedAC
      ? `Carteira do Assessor - ${selectedAC.name}`
      : tabTitles[activeTab] ?? 'IAM';

  // Relógio Brasília (atualiza a cada 30s)
  const [dateBR, setDateBR] = useState(getFormattedDateBrasilia());
  const [timeBR, setTimeBR] = useState(getFormattedTimeBrasilia());
  useEffect(() => {
    const id = setInterval(() => {
      setDateBR(getFormattedDateBrasilia());
      setTimeBR(getFormattedTimeBrasilia());
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const isDark = theme === 'dark';

  return (
    <div className="min-h-screen bg-background">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <main className="md:ml-[260px] min-h-screen">
        <header className="sticky top-0 z-30 bg-background/70 backdrop-blur-2xl border-b border-border/60 px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-2">
          {/* Hamburger — só em telas <md (mobile) */}
          <button
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden p-2 rounded-xl hover:bg-muted/60 transition-all text-foreground"
            aria-label="Abrir menu"
          >
            <Menu size={20} strokeWidth={1.8} />
          </button>
          <div className="flex-1 md:flex-none min-w-0 flex items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-[1rem] sm:text-[1.2rem] font-bold text-foreground tracking-tight truncate leading-tight">
                Faça um bom dia
              </h1>
              <p className="text-[11px] text-muted-foreground/70 font-light leading-tight mt-0.5">
                {dateBR} {timeBR} (Brasília)
              </p>
            </div>
            <div className="hidden sm:block">
              <CompanySwitcher />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {currentUser && (
              <div className="flex items-center gap-2.5">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-semibold text-foreground leading-none">{currentUser.name}</p>
                </div>
                {currentUser.photo ? (
                  <img
                    src={currentUser.photo}
                    alt={currentUser.name}
                    className="w-7 h-7 rounded-full object-cover border border-border"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-primary/10 border border-border flex items-center justify-center text-[10px] font-semibold text-primary">
                    {currentUser.name.split(' ').map((n) => n.charAt(0)).join('').toUpperCase().slice(0, 2)}
                  </div>
                )}
                <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border ${ROLE_COLORS[currentUser.role]}`}>
                  {ROLE_ICONS[currentUser.role]}
                  {ROLE_LABELS[currentUser.role]}
                </span>
              </div>
            )}

            <div className="w-px h-5 bg-border/50" />

            <button
              className="p-2 rounded-xl hover:bg-muted/60 transition-all duration-200 text-muted-foreground/60 hover:text-foreground"
              title="Recarregar"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={15} strokeWidth={1.8} />
            </button>

            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="p-2 rounded-xl hover:bg-muted/60 transition-all duration-200 text-muted-foreground/60 hover:text-foreground border border-border/50"
              title={isDark ? 'Modo Claro' : 'Modo Escuro'}
            >
              {isDark ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
            </button>
          </div>
        </header>
        <div className={`px-4 sm:px-6 lg:px-8 ${activeTab === 'ac' ? 'pt-3' : 'pt-4 sm:pt-6 lg:pt-8'} pb-4 sm:pb-6 lg:pb-8 fade-in`}>
          {activeTab !== 'ac' && (
            <div className="mb-5 pb-3 border-b border-border/50 flex items-center gap-3">
              <h2 className="text-sm font-semibold text-foreground tracking-tight">{headerTitle}</h2>
              {activeTab === 'cancelamentos' && <TutorialCancelamentoButton />}
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
