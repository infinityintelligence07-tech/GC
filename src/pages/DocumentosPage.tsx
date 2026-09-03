import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  Plus,
  Search,
  Eye,
  Pencil,
  Copy,
  Trash2,
  Download,
  Upload,
  X,
  RotateCcw,
  FileSignature,
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import DocumentRelationMultiSelect from '@/components/ui/DocumentRelationMultiSelect';
import { useAppStore } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { canEditTab, canViewTab } from '@/types';
import {
  DOCUMENT_KIND_LABELS,
  createManagedDocument,
  deleteManagedDocument,
  downloadBlob,
  duplicateManagedDocument,
  exportDocumentTxt,
  exportDocumentsJson,
  extractTemplateVariables,
  listManagedDocuments,
  parseImportPayload,
  readFileAsText,
  resetBuiltInDocument,
  subscribeManagedDocuments,
  updateManagedDocument,
  type ManagedDocument,
  type ManagedDocumentKind,
  type DocumentRelation,
} from '@/lib/managedDocuments';

type EditorMode = 'create' | 'edit' | 'preview';

function formatDateTimeBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR');
}

function formatDateBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

const KIND_BADGE: Record<ManagedDocumentKind, string> = {
  contrato: 'bg-blue-50 text-blue-700 border-blue-200',
  termo: 'bg-violet-50 text-violet-700 border-violet-200',
  aditivo: 'bg-amber-50 text-amber-800 border-amber-200',
  outro: 'bg-slate-100 text-slate-700 border-slate-200',
};

export default function DocumentosPage() {
  const { currentUser } = useAppStore();
  const { activeCompanyId } = useCompanyStore();
  const companyId = activeCompanyId || 'default';

  const canView = canViewTab(currentUser, 'documentos');
  const canEdit = canEditTab(currentUser, 'documentos');

  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<ManagedDocumentKind | 'all'>('all');
  const [showList, setShowList] = useState(true);
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [editing, setEditing] = useState<ManagedDocument | null>(null);
  const [formName, setFormName] = useState('');
  const [formKind, setFormKind] = useState<ManagedDocumentKind>('termo');
  const [formContent, setFormContent] = useState('');
  const [formRelatedTo, setFormRelatedTo] = useState<DocumentRelation[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeManagedDocuments(() => setTick((t) => t + 1)), []);

  const docs = useMemo(() => listManagedDocuments(companyId), [companyId, tick]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (kindFilter !== 'all' && d.kind !== kindFilter) return false;
      if (q && !d.name.toLowerCase().includes(q) && !d.content.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [docs, search, kindFilter]);

  if (!canView) {
    return (
      <div className="max-w-3xl">
        <p className="text-sm text-muted-foreground">Você não tem permissão para acessar Documentos.</p>
      </div>
    );
  }

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormKind('termo');
    setFormContent('');
    setFormRelatedTo([]);
    setEditorMode('create');
    setShowList(true);
  };

  const openEdit = (doc: ManagedDocument) => {
    setEditing(doc);
    setFormName(doc.name);
    setFormKind(doc.kind);
    setFormContent(doc.content);
    setFormRelatedTo(doc.relatedTo ?? []);
    setEditorMode('edit');
  };

  const openPreview = (doc: ManagedDocument) => {
    setEditing(doc);
    setFormName(doc.name);
    setFormKind(doc.kind);
    setFormContent(doc.content);
    setFormRelatedTo(doc.relatedTo ?? []);
    setEditorMode('preview');
  };

  const closeEditor = () => {
    setEditorMode(null);
    setEditing(null);
  };

  const saveEditor = () => {
    if (!canEdit) return;
    const name = formName.trim();
    if (!name) {
      toast.error('Informe o nome do documento.');
      return;
    }
    if (!formContent.trim()) {
      toast.error('O conteúdo não pode ficar vazio.');
      return;
    }
    const by = currentUser?.name;
    if (editorMode === 'create') {
      createManagedDocument(companyId, {
        name,
        kind: formKind,
        content: formContent,
        relatedTo: formRelatedTo,
        updatedByName: by,
      });
      toast.success('Documento criado.');
    } else if (editing) {
      updateManagedDocument(companyId, editing.id, {
        name,
        kind: formKind,
        content: formContent,
        relatedTo: formRelatedTo,
        updatedByName: by,
      });
      toast.success('Documento atualizado.');
    }
    setTick((t) => t + 1);
    closeEditor();
  };

  const handleDuplicate = (doc: ManagedDocument) => {
    if (!canEdit) return;
    duplicateManagedDocument(companyId, doc.id, currentUser?.name);
    setTick((t) => t + 1);
    toast.success('Documento duplicado.');
  };

  const handleDelete = () => {
    if (!canEdit || !deleteId) return;
    deleteManagedDocument(companyId, deleteId);
    setDeleteId(null);
    setTick((t) => t + 1);
    toast.success('Documento removido.');
  };

  const handleReset = (doc: ManagedDocument) => {
    if (!canEdit || !doc.builtInKey) return;
    resetBuiltInDocument(companyId, doc.id, currentUser?.name);
    setTick((t) => t + 1);
    toast.success('Modelo restaurado ao padrão.');
  };

  const exportOne = (doc: ManagedDocument, as: 'txt' | 'json') => {
    const safe = doc.name.replace(/[^\w\-]+/g, '_').slice(0, 60);
    if (as === 'txt') {
      downloadBlob(`${safe}.txt`, exportDocumentTxt(doc), 'text/plain;charset=utf-8');
    } else {
      downloadBlob(`${safe}.json`, exportDocumentsJson([doc]), 'application/json;charset=utf-8');
    }
  };

  const exportAll = () => {
    downloadBlob(
      `documentos-gc-${new Date().toISOString().slice(0, 10)}.json`,
      exportDocumentsJson(filtered.length ? filtered : docs),
      'application/json;charset=utf-8',
    );
    toast.success('Exportação gerada.');
  };

  const handleImportFiles = async (files: FileList | null) => {
    if (!canEdit || !files?.length) return;
    let imported = 0;
    for (const file of Array.from(files)) {
      try {
        const text = await readFileAsText(file);
        const { docs: parsed, error } = parseImportPayload(text, file.name);
        if (error) {
          toast.error(`${file.name}: ${error}`);
          continue;
        }
        for (const item of parsed) {
          createManagedDocument(companyId, {
            ...item,
            updatedByName: currentUser?.name,
          });
          imported += 1;
        }
      } catch (err: unknown) {
        toast.error(
          `${file.name}: ${err instanceof Error ? err.message : 'Falha ao importar.'}`,
        );
      }
    }
    if (imported > 0) {
      setTick((t) => t + 1);
      setShowList(true);
      toast.success(`${imported} documento(s) importado(s).`);
    }
    if (importRef.current) importRef.current.value = '';
  };

  const vars = extractTemplateVariables(formContent);

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Gerenciar Documentos</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie modelos de contratos, termos e documentos. Importe, exporte e edite o conteúdo usado no GC.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
          >
            <Plus size={16} /> Novo Documento
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
        <div className="flex gap-4 items-start">
          <div className="shrink-0 size-11 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center border border-violet-200">
            <FileSignature size={20} />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Contratos e termos com assinatura digital</h2>
              <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                Crie e mantenha modelos (termos de cancelamento, renegociação, contratos e outros) que podem ser
                exportados, importados e usados nas rotinas do GC. A integração ZapSign continua disponível nas
                telas de cancelamento e renegociação.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors"
                >
                  <FileSignature size={13} /> Criar Novo Contrato/Termo
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowList(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                <Eye size={13} /> Ver Contratos/Termos Existentes
              </button>
            </div>
          </div>
        </div>
      </div>

      {showList && (
        <div className="rounded-2xl border border-border bg-card saas-shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex flex-col lg:flex-row gap-3 lg:items-center">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome do documento..."
                className="input-field text-sm w-full pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Filter size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <select
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value as ManagedDocumentKind | 'all')}
                  className="input-field text-xs pl-8 pr-8"
                >
                  <option value="all">Todos os tipos</option>
                  {(Object.keys(DOCUMENT_KIND_LABELS) as ManagedDocumentKind[]).map((k) => (
                    <option key={k} value={k}>
                      {DOCUMENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={exportAll}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted transition-colors"
                title="Exportar lista filtrada (JSON)"
              >
                <Download size={13} /> Exportar
              </button>
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => importRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted transition-colors"
                  >
                    <Upload size={13} /> Importar
                  </button>
                  <input
                    ref={importRef}
                    type="file"
                    accept=".json,.txt,.docx,application/json,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleImportFiles(e.target.files)}
                  />
                </>
              )}
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Documentos ({filtered.length})</h3>
          </div>

          {filtered.length === 0 ? (
            <p className="p-8 text-sm text-muted-foreground text-center">Nenhum documento encontrado.</p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((doc) => {
                const fieldCount = extractTemplateVariables(doc.content).length;
                return (
                  <li key={doc.id} className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-muted/30 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">{doc.name}</p>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${KIND_BADGE[doc.kind]}`}>
                          <FileText size={10} />
                          {DOCUMENT_KIND_LABELS[doc.kind]}
                        </span>
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                          v{doc.version}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {fieldCount} campo{fieldCount === 1 ? '' : 's'} · Criado em {formatDateBR(doc.createdAt)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Última alteração: {formatDateTimeBR(doc.updatedAt)}
                        {doc.updatedByName ? ` por ${doc.updatedByName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openPreview(doc)}
                        className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Visualizar"
                      >
                        <Eye size={15} />
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => openEdit(doc)}
                          className="p-2 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
                          title="Editar"
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDuplicate(doc)}
                          className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                          title="Duplicar"
                        >
                          <Copy size={15} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => exportOne(doc, 'txt')}
                        className="p-2 rounded-lg text-violet-600 hover:bg-violet-50 transition-colors"
                        title="Exportar TXT"
                      >
                        <Download size={15} />
                      </button>
                      {canEdit && doc.builtInKey && (
                        <button
                          type="button"
                          onClick={() => handleReset(doc)}
                          className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                          title="Restaurar modelo padrão"
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setDeleteId(doc.id)}
                          className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {editorMode && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={closeEditor}>
          <div
            className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-card border border-border saas-shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {editorMode === 'create' ? 'Novo documento' : editorMode === 'edit' ? 'Editar documento' : 'Visualizar'}
                </p>
                <h3 className="text-sm font-semibold text-foreground">{formName || 'Sem título'}</h3>
              </div>
              <button type="button" onClick={closeEditor} className="text-muted-foreground hover:text-foreground" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">Nome</label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    disabled={editorMode === 'preview'}
                    className="input-field text-sm w-full mt-1"
                    placeholder="Ex.: Contrato Master, Termo de Quitação…"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">Tipo</label>
                  <select
                    value={formKind}
                    onChange={(e) => setFormKind(e.target.value as ManagedDocumentKind)}
                    disabled={editorMode === 'preview'}
                    className="input-field text-sm w-full mt-1"
                  >
                    {(Object.keys(DOCUMENT_KIND_LABELS) as ManagedDocumentKind[]).map((k) => (
                      <option key={k} value={k}>
                        {DOCUMENT_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <DocumentRelationMultiSelect
                selected={formRelatedTo}
                onChange={setFormRelatedTo}
                disabled={editorMode === 'preview'}
              />

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">Conteúdo</label>
                  <span className="text-[10px] text-muted-foreground">{vars.length} campos detectados</span>
                </div>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  disabled={editorMode === 'preview'}
                  className="input-field text-[12px] w-full min-h-[320px] font-mono leading-relaxed"
                  placeholder="Cole ou escreva o texto do documento. Use {{CAMPO}} para variáveis."
                />
                {vars.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {vars.map((v) => (
                      <span key={v} className="px-2 py-0.5 rounded-md text-[10px] bg-muted border border-border text-muted-foreground">
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {editing && editorMode !== 'create' && (
                  <>
                    <button
                      type="button"
                      onClick={() => exportOne(editing, 'txt')}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted"
                    >
                      Exportar TXT
                    </button>
                    <button
                      type="button"
                      onClick={() => exportOne(editing, 'json')}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted"
                    >
                      Exportar JSON
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={closeEditor}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted"
                >
                  {editorMode === 'preview' ? 'Fechar' : 'Cancelar'}
                </button>
                {editorMode !== 'preview' && canEdit && (
                  <button
                    type="button"
                    onClick={saveEditor}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Salvar
                  </button>
                )}
                {editorMode === 'preview' && canEdit && editing && (
                  <button
                    type="button"
                    onClick={() => setEditorMode('edit')}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Editar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground">Excluir documento?</h3>
            <p className="text-xs text-muted-foreground">
              Esta ação remove o modelo desta empresa. Você pode importar novamente depois.
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setDeleteId(null)} className="px-3 py-1.5 rounded-lg text-xs border border-border">
                Cancelar
              </button>
              <button type="button" onClick={handleDelete} className="px-3 py-1.5 rounded-lg text-xs bg-destructive text-destructive-foreground">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
