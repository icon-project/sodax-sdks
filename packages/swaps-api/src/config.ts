/** Configuration for a `SwapsApi` client instance. */
export interface SwapsApiConfig {
  /** Base URL of the Swaps API host. Required; the package never hardcodes environment URLs. */
  baseUrl: string;
  /**
   * `fetch` implementation to use. Defaults to the global `fetch`. Inject a custom one for tests
   * or non-standard runtimes.
   */
  fetch?: typeof globalThis.fetch;
  /** Extra headers merged over the defaults on every request. */
  headers?: Record<string, string>;
  /**
   * Validate request bodies at runtime before sending. Off by default — request types are already
   * enforced at compile time. Responses are always validated regardless of this flag.
   */
  validateRequests?: boolean;
}
