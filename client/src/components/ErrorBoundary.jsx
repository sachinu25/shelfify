import { Component } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk .* failed/i;
const RELOAD_FLAG = 'sf_chunk_reload';

/**
 * Catches render/lazy-load errors so one broken view never blanks the whole app
 * (audit M3). After a new deployment, old lazily-loaded chunks disappear; that
 * case triggers a single automatic reload to pick up the new build.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
    if (CHUNK_ERROR.test(String(error?.message))) {
      try {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          window.location.reload();
        }
      } catch {
        /* storage unavailable: show the fallback instead */
      }
    }
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.reset();
  }

  reset = () => {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* ignore */
    }
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = CHUNK_ERROR.test(String(error?.message));
    return (
      <div role="alert" className="container-page flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
        <div className="grid size-16 place-items-center rounded-full bg-danger-soft">
          <AlertTriangle className="size-7 text-danger" strokeWidth={1.6} />
        </div>
        <h1 className="mt-6 text-4xl">{stale ? 'Shelfify was just updated' : 'Something went wrong on this page'}</h1>
        <p className="mt-3 max-w-md text-ink-soft">
          {stale
            ? 'A newer version is available. Reload to continue — your bag and account are safe.'
            : 'We hit an unexpected problem showing this page. Your bag and account are safe. Please try again.'}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {!stale && (
            <button onClick={this.reset} className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 font-semibold text-white hover:bg-accent-dark">
              Try again
            </button>
          )}
          <button
            onClick={() => window.location.reload()}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-white px-5 font-semibold text-ink hover:bg-cream"
          >
            <RefreshCw className="size-4" /> Reload page
          </button>
          <a href="/" className="inline-flex h-11 items-center gap-2 rounded-full px-5 font-semibold text-ink-soft hover:bg-cream">
            <Home className="size-4" /> Go home
          </a>
        </div>
      </div>
    );
  }
}
