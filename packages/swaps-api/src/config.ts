/** Configuration for a `SwapsApi` client instance. */
export interface SwapsApiConfig {
  /**
   * Base URL of the Swaps API host, including any version prefix. The package never hardcodes
   * environment URLs. Example: `https://canary-api.sodax.com/v1`.
   */
  baseUrl: string;
  /**
   * `fetch` implementation to use. Defaults to the global `fetch`. Inject a custom one for tests,
   * non-standard runtimes, or to add a timeout/cancellation via `AbortSignal`.
   */
  fetch?: typeof globalThis.fetch;
  /** Extra headers merged over the defaults on every request. */
  headers?: Record<string, string>;
}
