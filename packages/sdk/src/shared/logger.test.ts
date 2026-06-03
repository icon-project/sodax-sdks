import { describe, expect, it, vi } from 'vitest';
import type { SodaxLogger } from '@sodax/types';
import { consoleLogger, resolveLogger, silentLogger } from './logger.js';
import { Sodax } from './entities/Sodax.js';

describe('resolveLogger', () => {
  it('defaults to the console logger when the option is undefined', () => {
    expect(resolveLogger(undefined)).toBe(consoleLogger);
  });

  it("returns the console logger for the 'console' preset", () => {
    expect(resolveLogger('console')).toBe(consoleLogger);
  });

  it("returns the silent logger for the 'silent' preset", () => {
    expect(resolveLogger('silent')).toBe(silentLogger);
  });

  it('returns a custom logger instance unchanged', () => {
    const custom: SodaxLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(resolveLogger(custom)).toBe(custom);
  });
});

describe('silentLogger', () => {
  it('drops every level without throwing', () => {
    expect(() => {
      silentLogger.debug('d');
      silentLogger.info('i');
      silentLogger.warn('w');
      silentLogger.error('e', new Error('boom'), { k: 'v' });
    }).not.toThrow();
  });
});

describe('consoleLogger', () => {
  it('forwards error(message, error) to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('boom');
    consoleLogger.error('failed', cause);
    expect(spy).toHaveBeenCalledWith('failed', cause);
    spy.mockRestore();
  });

  it('omits the second console.error argument when no error value is passed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogger.error('just a message');
    expect(spy).toHaveBeenCalledWith('just a message');
    spy.mockRestore();
  });
});

describe('Sodax logger wiring', () => {
  it('defaults to the console logger', () => {
    expect(new Sodax().config.logger).toBe(consoleLogger);
  });

  it("selects the silent logger via { logger: 'silent' }", () => {
    expect(new Sodax({ logger: 'silent' }).config.logger).toBe(silentLogger);
  });

  it('uses a custom logger and keeps it after a failed dynamic-config initialize()', async () => {
    const custom: SodaxLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const sodax = new Sodax({ logger: custom });
    expect(sodax.config.logger).toBe(custom);

    // A dynamic-config fetch that fails must not replace the resolved logger. Stub fetch to reject
    // fast so this doesn't wait on the real backend timeout.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await sodax.config.initialize().catch(() => undefined);
    expect(sodax.config.logger).toBe(custom);
    fetchSpy.mockRestore();
  });
});
