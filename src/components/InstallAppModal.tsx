import { useEffect, useMemo, useState } from 'react';
import { X, Smartphone, Tablet, Laptop, Apple, Share, Plus, MoreVertical, Monitor } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Device = 'iphone' | 'android' | 'ipad' | 'mac' | 'windows';

function detectDevice(): Device {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = navigator.userAgent;
  const isTouchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || isTouchMac) return 'ipad';
  if (/Android/.test(ua)) return 'android';
  if (/Mac OS X/.test(ua)) return 'mac';
  return 'windows';
}

const DEVICES: { id: Device; label: string; icon: any }[] = [
  { id: 'iphone', label: 'iPhone', icon: Smartphone },
  { id: 'android', label: 'Android', icon: Smartphone },
  { id: 'ipad', label: 'iPad', icon: Tablet },
  { id: 'mac', label: 'MacBook', icon: Apple },
  { id: 'windows', label: 'Notebook', icon: Laptop },
];

export default function InstallAppModal({ open, onClose }: Props) {
  const [active, setActive] = useState<Device>('iphone');

  useEffect(() => {
    if (open) setActive(detectDevice());
  }, [open]);

  const steps = useMemo(() => {
    switch (active) {
      case 'iphone':
        return [
          { icon: Share, text: 'Abra o site no Safari e toque no botão Compartilhar.' },
          { icon: Plus, text: 'Toque em "Adicionar à Tela de Início".' },
          { icon: Smartphone, text: 'Confirme. O app aparecerá na sua tela inicial.' },
        ];
      case 'ipad':
        return [
          { icon: Share, text: 'Abra o site no Safari e toque em Compartilhar.' },
          { icon: Plus, text: 'Selecione "Adicionar à Tela de Início".' },
          { icon: Tablet, text: 'Pronto, o ícone do app fica na tela inicial do iPad.' },
        ];
      case 'android':
        return [
          { icon: MoreVertical, text: 'Abra o Chrome e toque no menu (⋮) no canto superior direito.' },
          { icon: Plus, text: 'Toque em "Instalar app" ou "Adicionar à tela inicial".' },
          { icon: Smartphone, text: 'Confirme. O app será instalado como um aplicativo nativo.' },
        ];
      case 'mac':
        return [
          { icon: Apple, text: 'Abra no Safari ou Chrome.' },
          { icon: Share, text: 'No Safari: menu Arquivo → "Adicionar ao Dock". No Chrome: ícone de instalar na barra de endereço.' },
          { icon: Laptop, text: 'O app abrirá em janela própria, como um aplicativo nativo do macOS.' },
        ];
      case 'windows':
        return [
          { icon: Monitor, text: 'Abra no Chrome, Edge ou navegador compatível.' },
          { icon: Plus, text: 'Clique no ícone de instalar (⊕) na barra de endereço, ou no menu → "Instalar app".' },
          { icon: Laptop, text: 'O app ficará disponível no menu Iniciar e na barra de tarefas.' },
        ];
    }
  }, [active]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/40 backdrop-blur-sm fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-border/60 rounded-2xl saas-shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <div>
            <h2 className="text-sm font-bold text-foreground tracking-tight">Baixar aplicativo</h2>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">Instale o app no seu dispositivo</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
            aria-label="Fechar"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Device tabs */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-5 gap-1.5">
            {DEVICES.map((d) => {
              const Icon = d.icon;
              const isActive = d.id === active;
              return (
                <button
                  key={d.id}
                  onClick={() => setActive(d.id)}
                  className={`flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-[10px] font-medium transition-all duration-200 border ${
                    isActive
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-background text-muted-foreground border-border/60 hover:border-border hover:text-foreground'
                  }`}
                >
                  <Icon size={16} strokeWidth={1.8} />
                  <span>{d.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Steps */}
        <div className="px-5 py-5 space-y-3">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border/40">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon size={15} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-0.5">
                    Passo {i + 1}
                  </p>
                  <p className="text-xs text-foreground leading-relaxed">{s.text}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/60 bg-muted/20">
          <p className="text-[10px] text-muted-foreground/60 text-center leading-relaxed">
            O app funciona em qualquer dispositivo, tanto na versão instalada quanto direto no navegador.
          </p>
        </div>
      </div>
    </div>
  );
}
