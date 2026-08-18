import { useState } from 'react';
import { Lock, Mail, Eye, EyeOff, Loader2, Download } from 'lucide-react';
import logoIamBlue from '@/assets/logo-iam-blue.png';
import { useAuth } from '@/hooks/useAuth';
import InstallAppModal from '@/components/InstallAppModal';

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await signIn(email.trim(), password);
    if (err) {
      // Mensagens amigáveis
      const msg = /invalid login/i.test(err)
        ? 'E-mail ou senha incorretos.'
        : /email not confirmed/i.test(err)
          ? 'E-mail ainda não confirmado.'
          : err;
      setError(msg);
      setLoading(false);
    }
    // Em caso de sucesso, o AuthProvider redireciona automaticamente
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[380px]">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <img
            src={logoIamBlue}
            alt="IAM"
            className="h-12 w-auto mb-5 select-none"
            draggable={false}
          />
          <h1 className="text-xl font-bold text-foreground tracking-tight">IAM - GC</h1>
          <p className="text-xs text-muted-foreground/60 mt-1.5 font-medium">Acesse com suas credenciais</p>
        </div>

        {/* Form */}
        <div className="bg-card border border-border/60 rounded-2xl p-7 saas-shadow-lg space-y-5">
          <form onSubmit={handleLogin} className="space-y-5">
            {/* Login */}
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-2">
                E-mail
              </label>
              <div className="relative">
                <Mail size={14} strokeWidth={1.8} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                <input
                  type="text"
                  className="input-field pl-9 w-full h-11"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-2">
                Senha
              </label>
              <div className="relative">
                <Lock size={14} strokeWidth={1.8} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                <input
                  className="input-field pl-9 pr-10 w-full h-11"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors duration-200"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-destructive bg-destructive/6 px-3.5 py-2.5 rounded-xl font-medium">{error}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold iam-gradient text-primary-foreground shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {loading ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" /> Entrando...
                </>
              ) : (
                <>
                  <Lock size={14} strokeWidth={2} /> Entrar
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border/60" />
            <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">ou</span>
            <div className="flex-1 h-px bg-border/60" />
          </div>

          {/* Install app */}
          <button
            type="button"
            onClick={() => setInstallOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-background border border-border/60 text-foreground hover:border-primary/40 hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-200"
          >
            <Download size={14} strokeWidth={2} /> Baixar aplicativo
          </button>
        </div>

        <p className="text-center text-[10px] text-muted-foreground/40 mt-8 font-medium">
          Sistema IAM v1.0 • Acesso restrito
        </p>
      </div>

      <InstallAppModal open={installOpen} onClose={() => setInstallOpen(false)} />
    </div>
  );
}
