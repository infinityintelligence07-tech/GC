import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global ErrorBoundary — evita "tela branca" quando algum componente
 * lança erro durante render (ex.: filtros, modais, dados inesperados).
 * Mostra uma mensagem amigável com opção de recarregar.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-[50vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-card border border-border rounded-2xl p-6 shadow-md text-center space-y-4">
            <h2 className="text-base font-semibold text-foreground">
              Ops! Algo deu errado ao carregar esta tela.
            </h2>
            <p className="text-xs text-muted-foreground">
              {this.state.error?.message || 'Erro inesperado.'} Tente novamente ou recarregue a página.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={this.reset}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
              >
                Tentar novamente
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all"
              >
                Recarregar página
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
