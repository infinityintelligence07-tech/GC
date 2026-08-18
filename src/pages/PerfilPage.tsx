import { useState } from 'react';
import { User, Mail, Phone, Save, Lock, Eye, EyeOff } from 'lucide-react';
import ProfilePhotoUpload from '@/components/ui/ProfilePhotoUpload';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { updateAppUserDb } from '@/lib/supabaseMutations';
import { toast } from '@/hooks/use-toast';
import { loginToEmail } from '@/lib/loginToEmail';

export default function PerfilPage() {
  const { currentUser, updateUser, setCurrentUser } = useAppStore();
  const { user: authUser } = useAuth();
  const [name, setName] = useState(currentUser?.name ?? '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saved, setSaved] = useState(false);

  // ── Trocar senha ────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  const photo = currentUser?.photo ?? null;

  const handlePhotoChange = (newPhoto: string | null) => {
    if (!currentUser) return;
    updateUser(currentUser.id, { photo: newPhoto ?? undefined });
    setCurrentUser({ ...currentUser, photo: newPhoto ?? undefined });
  };

  const handleSave = () => {
    if (currentUser && name.trim() && name !== currentUser.name) {
      updateUser(currentUser.id, { name: name.trim() });
      setCurrentUser({ ...currentUser, name: name.trim() });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleChangePassword = async () => {
    if (!currentUser) return;
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: 'Preencha todos os campos', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 4) {
      toast({ title: 'A nova senha deve ter ao menos 4 caracteres', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'A confirmação não confere com a nova senha', variant: 'destructive' });
      return;
    }
    if (newPassword === currentPassword) {
      toast({ title: 'A nova senha deve ser diferente da atual', variant: 'destructive' });
      return;
    }

    setPwdLoading(true);
    try {
      // 1. Confere senha atual re-autenticando
      const email = authUser?.email || loginToEmail(currentUser.login);
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signErr) {
        toast({ title: 'Senha atual incorreta', variant: 'destructive' });
        setPwdLoading(false);
        return;
      }
      // 2. Atualiza via Supabase Auth (faz hash bcrypt)
      const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updErr) throw updErr;
      toast({ title: '✓ Senha alterada com sucesso' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      toast({ title: 'Erro ao alterar senha', description: e?.message ?? '', variant: 'destructive' });
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <div className="flex items-center gap-3 mb-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">Perfil</h2>
            <p className="text-xs text-muted-foreground">Informações da conta</p>
          </div>
        </div>

        <ProfilePhotoUpload photo={photo} onPhotoChange={handlePhotoChange} userName={name || currentUser?.name} />

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
              Nome completo
            </label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                className="input-field pl-8 w-full"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
              E-mail
            </label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                className="input-field pl-8 w-full"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
              Telefone
            </label>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                className="input-field pl-8 w-full"
                placeholder="(00) 00000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all"
          >
            <Save size={14} />
            Salvar alterações
          </button>
          {saved && (
            <span className="text-xs text-emerald-600 font-medium fade-in">
              ✓ Salvo com sucesso
            </span>
          )}
        </div>
      </div>

      {/* ── Card: Trocar senha ──────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Lock size={16} className="text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Trocar senha</h2>
            <p className="text-xs text-muted-foreground">Confirme sua senha atual e defina uma nova</p>
          </div>
        </div>

        <div className="space-y-4">
          <PasswordField
            label="Senha atual"
            value={currentPassword}
            onChange={setCurrentPassword}
            show={showCurrent}
            toggle={() => setShowCurrent((v) => !v)}
            placeholder="Digite sua senha atual"
          />
          <PasswordField
            label="Nova senha"
            value={newPassword}
            onChange={setNewPassword}
            show={showNew}
            toggle={() => setShowNew((v) => !v)}
            placeholder="Mínimo 4 caracteres"
          />
          <PasswordField
            label="Confirmar nova senha"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showConfirm}
            toggle={() => setShowConfirm((v) => !v)}
            placeholder="Repita a nova senha"
          />
        </div>

        <div className="mt-6">
          <button
            onClick={handleChangePassword}
            disabled={pwdLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all disabled:opacity-60"
          >
            <Lock size={14} />
            {pwdLoading ? 'Alterando…' : 'Alterar senha'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PwdFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  toggle: () => void;
  placeholder?: string;
}

function PasswordField({ label, value, onChange, show, toggle, placeholder }: PwdFieldProps) {
  return (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
        {label}
      </label>
      <div className="relative">
        <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type={show ? 'text' : 'password'}
          className="input-field pl-8 pr-9 w-full"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={toggle}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
          tabIndex={-1}
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}
