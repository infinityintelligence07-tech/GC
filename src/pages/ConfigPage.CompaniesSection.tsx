// Seção "Configurações de Empresas" — CRUD básico para admins globais.
import { useRef, useState } from 'react';
import { Plus, Edit2, Check, X, Building2, Upload, Image as ImageIcon } from 'lucide-react';
import { useCompanyStore, Company } from '@/store/useCompanyStore';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

function slugify(s: string) {
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function uploadLogo(companyId: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'png';
  const path = `${companyId}/logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('company-logos').upload(path, file, {
    upsert: true,
    cacheControl: '3600',
  });
  if (error) {
    toast.error('Falha no upload: ' + error.message);
    return null;
  }
  const { data } = supabase.storage.from('company-logos').getPublicUrl(path);
  return data.publicUrl;
}

export default function CompaniesSection() {
  const { currentUser } = useAppStore();
  const { companies, activeCompanyId, createCompany, updateCompany, setActiveCompany } = useCompanyStore();
  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newSubtitle, setNewSubtitle] = useState('');
  const [newPrimary, setNewPrimary] = useState('#0022ff');
  const [newAccent, setNewAccent] = useState('#7c3aed');
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Company>>({});
  const [saving, setSaving] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);

  if (currentUser?.role !== 'admin') return null;

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error('Informe o nome da empresa.');
      return;
    }
    setSaving(true);
    const { error } = await createCompany({
      name: newName.trim(),
      slug: slugify(newName),
      active: true,
      color_primary: newPrimary,
      color_accent: newAccent,
      logo_url: null,
      title: newTitle.trim() || null,
      subtitle: newSubtitle.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error('Erro ao criar empresa: ' + error);
      return;
    }
    toast.success('Empresa criada. Edite-a para adicionar o logo.');
    setNewName(''); setNewTitle(''); setNewSubtitle('');
    setNewPrimary('#0022ff'); setNewAccent('#7c3aed');
  };

  const handleLogoUpload = async (companyId: string, file: File) => {
    const url = await uploadLogo(companyId, file);
    if (!url) return;
    setEditDraft((d) => ({ ...d, logo_url: url }));
    toast.success('Logo carregado. Clique em ✓ para salvar.');
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
      <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
        <Building2 size={14} /> Configurações de Empresas
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Cada empresa tem seu próprio banco de dados isolado, logo, paleta e textos exibidos na sidebar.
      </p>

      <div className="space-y-2 mb-5">
        {companies.map((c) => {
          const isEditing = editing === c.id;
          const draft = isEditing ? { ...c, ...editDraft } : c;
          return (
            <div key={c.id} className="flex flex-col gap-2 p-3 bg-muted/30 rounded-xl">
              <div className="flex items-center gap-3 flex-wrap">
                {draft.logo_url ? (
                  <img src={draft.logo_url} alt={draft.name} className="w-8 h-8 rounded-md object-contain bg-background border border-border shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-md bg-background border border-border flex items-center justify-center text-muted-foreground shrink-0">
                    <ImageIcon size={14} />
                  </div>
                )}
                <span
                  className="w-3.5 h-3.5 rounded-full border border-border shrink-0"
                  style={{ background: draft.color_primary }}
                />
                {isEditing ? (
                  <>
                    <input
                      className="input-field flex-1 min-w-[140px]"
                      placeholder="Nome interno"
                      value={draft.name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                    <input
                      type="color"
                      value={draft.color_primary}
                      onChange={(e) => setEditDraft((d) => ({ ...d, color_primary: e.target.value }))}
                      className="w-8 h-8 rounded border border-border cursor-pointer"
                      title="Cor primária"
                    />
                    <input
                      type="color"
                      value={draft.color_accent}
                      onChange={(e) => setEditDraft((d) => ({ ...d, color_accent: e.target.value }))}
                      className="w-8 h-8 rounded border border-border cursor-pointer"
                      title="Cor de acento"
                    />
                    <input
                      ref={editFileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleLogoUpload(c.id, f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => editFileRef.current?.click()}
                      className="action-btn"
                      title="Upload de logo"
                    >
                      <Upload size={12} />
                    </button>
                    <button
                      onClick={async () => {
                        await updateCompany(c.id, editDraft);
                        setEditing(null); setEditDraft({});
                        toast.success('Empresa atualizada.');
                      }}
                      className="action-btn text-emerald-600"
                    >
                      <Check size={12} />
                    </button>
                    <button onClick={() => { setEditing(null); setEditDraft({}); }} className="action-btn">
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-foreground font-medium truncate">{c.name}</span>
                    <span className="text-[10px] text-muted-foreground/70 font-mono">{c.slug}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-md ${c.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                      {c.active ? 'Ativada' : 'Desativada'}
                    </span>
                    <button onClick={() => { setEditing(c.id); setEditDraft({}); }} className="action-btn">
                      <Edit2 size={12} />
                    </button>
                    <button
                      onClick={() => updateCompany(c.id, { active: !c.active })}
                      className="action-btn text-primary"
                      title={c.active ? 'Desativar' : 'Ativar'}
                    >
                      {c.active ? '⏸' : '▶'}
                    </button>
                    {c.id !== activeCompanyId && c.active && (
                      <button onClick={() => setActiveCompany(c.id)} className="action-btn text-blue-600" title="Selecionar">→</button>
                    )}
                  </>
                )}
              </div>
              {isEditing && (
                <div className="flex gap-2 flex-wrap pl-11">
                  <input
                    className="input-field flex-1 min-w-[140px]"
                    placeholder="Título na sidebar (ex: IAM - GC)"
                    value={draft.title ?? ''}
                    onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                  />
                  <input
                    className="input-field flex-1 min-w-[140px]"
                    placeholder="Subtítulo (ex: Sistema IAM)"
                    value={draft.subtitle ?? ''}
                    onChange={(e) => setEditDraft((d) => ({ ...d, subtitle: e.target.value }))}
                  />
                  {draft.logo_url && (
                    <button
                      onClick={() => setEditDraft((d) => ({ ...d, logo_url: null }))}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      Remover logo
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-xs font-semibold text-foreground mb-2">Criar nova empresa</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input-field flex-1 min-w-[180px]"
            placeholder="Nome da empresa"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="input-field flex-1 min-w-[160px]"
            placeholder="Título sidebar (opcional)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <input
            className="input-field flex-1 min-w-[160px]"
            placeholder="Subtítulo (opcional)"
            value={newSubtitle}
            onChange={(e) => setNewSubtitle(e.target.value)}
          />
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Primária
            <input type="color" value={newPrimary} onChange={(e) => setNewPrimary(e.target.value)} className="w-8 h-8 rounded border border-border cursor-pointer" />
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Acento
            <input type="color" value={newAccent} onChange={(e) => setNewAccent(e.target.value)} className="w-8 h-8 rounded border border-border cursor-pointer" />
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-all disabled:opacity-50"
          >
            <Plus size={13} /> Criar
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-2">
          Após criar, clique em <Edit2 size={10} className="inline" /> para fazer upload do logo da empresa.
        </p>
      </div>
    </div>
  );
}
