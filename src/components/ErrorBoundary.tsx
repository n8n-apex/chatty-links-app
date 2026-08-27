import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Compact inline variant for per-message boundaries. */
  variant?: 'page' | 'inline';
  /** Changing this value resets the boundary (e.g. conversation id). */
  resetKey?: string | number;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.variant === 'inline') {
      return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Diese Antwort konnte nicht dargestellt werden.
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Der Rest des Gesprächs ist weiterhin nutzbar. Technische Meldung: {error.message}
          </p>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-border bg-background/60 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 text-lg font-semibold text-foreground">Etwas ist schiefgelaufen</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Die Ansicht konnte nicht geladen werden. Ihre Gespräche sind gespeichert.
          </p>
          <p className="mt-2 break-words text-xs text-muted-foreground/80">{error.message}</p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <RotateCw className="h-4 w-4" /> Erneut versuchen
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
