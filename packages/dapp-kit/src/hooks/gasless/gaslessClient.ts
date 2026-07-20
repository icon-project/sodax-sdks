import type { ResultifiedGaslessApi, Sodax } from '@sodax/sdk';

/** Which gasless implementation to drive: `'brain'` (in-process `sodax.gasless`, needs a Pimlico key) or `'api'` (HTTP `sodax.api.gasless`, via the backend, no key). */
export type GaslessSource = 'brain' | 'api';

/** Resolve the `getCapabilities`/`prepare`/`submit` implementation; both satisfy {@link ResultifiedGaslessApi}, so a hook can drive either without a shape change. */
export function resolveGaslessClient(sodax: Sodax, source: GaslessSource = 'brain'): ResultifiedGaslessApi {
  return source === 'api' ? sodax.api.gasless : sodax.gasless;
}
