import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { SessionScreen } from './SessionScreen';

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

/**
 * The last line under the whole app (main.tsx). A render crash would otherwise
 * blank the page; here it shows a plain Romanian message and a way back. The
 * error itself — message and stack — is shown only in development
 * (`import.meta.env.DEV`, a compile-time constant), never to a Member.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('Unhandled render error', error, info.componentStack);
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <SessionScreen>
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
          Ceva nu a funcționat
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Aplicația a întâmpinat o eroare neașteptată. Reîncarcă pagina; dacă se
          repetă, anunță echipa IT OSUBB.
        </p>
        <Button
          type="button"
          className="w-full"
          onClick={() => window.location.reload()}
        >
          Reîncarcă pagina
        </Button>
        {import.meta.env.DEV && (
          <pre
            data-testid="error-details"
            className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap"
          >
            {error.message}
            {'\n'}
            {error.stack}
          </pre>
        )}
      </SessionScreen>
    );
  }
}
