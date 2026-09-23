import { Component, type ReactNode } from 'react';
import type { PrivyRuntime } from './runtime.js';

type Props = { runtime: PrivyRuntime; fallback: ReactNode; children?: ReactNode };
type State = { error: Error | null };

/**
 * Keeps the app running when `PrivyProvider` cannot start — it throws while rendering on a plain-http
 * origin, with a malformed app id, or inside another `PrivyProvider`. The children then render without
 * Privy and "Email (Privy)" rejects with the cause. Once Privy has started, errors pass through untouched.
 */
export class PrivyStartupGuard extends Component<Props, State> {
  override state: State = { error: null };
  private started = false;

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidMount() {
    this.started = this.state.error === null;
  }

  override componentDidCatch(error: unknown) {
    if (this.started) return;
    const cause = error instanceof Error ? error : new Error(String(error));
    this.props.runtime.fail(cause);
    console.error('[wallet-sdk-react/privy] Privy could not start; continuing without "Email (Privy)".', cause);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Not a start-up failure: the app's own error boundaries decide what happens.
    if (this.started) throw error;
    return this.props.fallback;
  }
}
