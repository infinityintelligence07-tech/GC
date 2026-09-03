// Nem todo card é uma fatia da carteira: alguns recortam por tag, outros
// repetem cards vizinhos e outros contam pedidos em vez de alunos. Somar todos
// dá um total inflado, então os que não entram na conta vêm marcados.
export function NaoSomaBadge({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="shrink-0 rounded border border-border bg-muted px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
    >
      não soma
    </span>
  );
}
