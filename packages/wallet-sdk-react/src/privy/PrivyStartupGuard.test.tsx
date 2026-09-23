import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Component, type ReactNode, useState } from 'react';
import { PrivyStartupGuard } from './PrivyStartupGuard.js';
import { createPrivyRuntime } from './runtime.js';

class AppBoundary extends Component<{ children?: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? <span>app boundary: {this.state.error.message}</span> : this.props.children;
  }
}

function FailsToStart(): ReactNode {
  throw new Error('Embedded wallet is only available over HTTPS');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PrivyStartupGuard', () => {
  it('renders the app without Privy when PrivyProvider throws while starting, and reports the cause', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = createPrivyRuntime();
    const fail = vi.spyOn(runtime, 'fail');

    const { getByText } = render(
      <PrivyStartupGuard runtime={runtime} fallback={<span>app</span>}>
        <FailsToStart />
      </PrivyStartupGuard>,
    );

    expect(getByText('app')).toBeTruthy();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Embedded wallet is only available over HTTPS' }),
    );
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('Privy could not start'), expect.any(Error));
  });

  it("hands errors thrown after a successful start to the app's own boundaries", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = createPrivyRuntime();
    const fail = vi.spyOn(runtime, 'fail');
    let breakChild: () => void = () => undefined;
    function Child() {
      const [broken, setBroken] = useState(false);
      breakChild = () => setBroken(true);
      if (broken) throw new Error('partner bug');
      return <span>running</span>;
    }

    const { getByText } = render(
      <AppBoundary>
        <PrivyStartupGuard runtime={runtime} fallback={<span>fallback</span>}>
          <Child />
        </PrivyStartupGuard>
      </AppBoundary>,
    );
    expect(getByText('running')).toBeTruthy();
    act(() => breakChild());

    expect(getByText('app boundary: partner bug')).toBeTruthy();
    expect(fail).not.toHaveBeenCalled();
  });
});
