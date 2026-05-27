import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useConfig } from 'wagmi';
import { mock } from 'wagmi/connectors';
import type { EvmTypeConfig } from '@/types/config.js';

// Keep the real WagmiProvider + createWagmiConfig (so the connector-merge logic
// under test runs for real); stub the hydrator/actions so we don't drag in the
// store + XService singletons that those children touch.
vi.mock('./EvmHydrator.js', () => ({ EvmHydrator: () => null }));
vi.mock('./EvmActions.js', () => ({ EvmActions: () => null }));

import { EvmProvider } from './EvmProvider.js';

// Probe child reads the live wagmi config and renders the connector ids.
const Probe = () => {
  const config = useConfig();
  return <div data-testid="ids">{config.connectors.map(c => c.id).join(',')}</div>;
};

const renderWith = (config: EvmTypeConfig) =>
  render(
    <EvmProvider config={config}>
      <Probe />
    </EvmProvider>,
  );

describe('EvmProvider — wagmiConnectors wiring', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('merges wagmiConnectors into the wagmi config', () => {
    renderWith({ wagmiConnectors: [mock({ accounts: ['0x0000000000000000000000000000000000000001'] })] });
    expect(screen.getByTestId('ids').textContent).toContain('mock');
  });

  it('adds no connectors when neither walletConnect nor wagmiConnectors is provided', () => {
    renderWith({});
    expect(screen.getByTestId('ids').textContent).toBe('');
  });
});
