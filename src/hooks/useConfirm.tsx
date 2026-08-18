import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmOptions = {
  title?: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  /** Destaca visualmente o botão de cancelar (revisar) em azul */
  highlightCancel?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({});
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((arg) => {
    const o: ConfirmOptions = typeof arg === "string" ? { description: arg } : arg;
    setOpts(o);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = (result: boolean) => {
    setOpen(false);
    resolverRef.current?.(result);
    resolverRef.current = null;
  };

  const isDestructive = opts.variant === "destructive";
  const highlightCancel = !!opts.highlightCancel;

  // Quebra a descrição: primeira frase/parágrafo em destaque, restante normal
  let lead: string | null = null;
  let rest: ReactNode = opts.description ?? null;
  if (typeof opts.description === "string") {
    const parts = opts.description.split(/\n{2,}/);
    lead = parts[0]?.trim() || null;
    rest = parts.slice(1).join("\n\n").trim() || null;
  }

  const Icon = isDestructive ? AlertTriangle : HelpCircle;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(v) => { if (!v) close(false); }}>
        <AlertDialogContent className="rounded-2xl p-0 overflow-hidden">
          <div className="flex gap-4 p-6 pb-4">
            <div
              className={
                "shrink-0 h-11 w-11 rounded-xl flex items-center justify-center " +
                (isDestructive ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")
              }
            >
              <Icon className="h-5 w-5" />
            </div>
            <AlertDialogHeader className="space-y-3 text-left flex-1">
              <AlertDialogTitle className="text-lg font-bold leading-snug">
                {opts.title ?? "Confirmar ação"}
              </AlertDialogTitle>
              {lead ? (
                <div
                  className={
                    "rounded-xl border px-3 py-2.5 text-sm font-semibold leading-snug " +
                    (isDestructive
                      ? "border-destructive/20 bg-destructive/5 text-destructive"
                      : "border-primary/20 bg-primary/5 text-primary")
                  }
                >
                  {lead}
                </div>
              ) : null}
              {rest ? (
                <AlertDialogDescription className="whitespace-pre-line text-sm">
                  {rest}
                </AlertDialogDescription>
              ) : null}
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter className="bg-muted/40 border-t px-6 py-4">
            <AlertDialogCancel
              onClick={() => close(false)}
              className={
                highlightCancel
                  ? "rounded-xl border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground font-semibold"
                  : "rounded-xl"
              }
            >
              {opts.cancelText ?? "Cancelar"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={
                "rounded-xl " +
                (isDestructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : highlightCancel
                    ? "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border"
                    : "")
              }
            >
              {opts.confirmText ?? "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
