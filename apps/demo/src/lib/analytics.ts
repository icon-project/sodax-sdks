import type { AnalyticsConfig, AnalyticsEvent } from '@sodax/dapp-kit';

// Demo analytics sink. Receives the structured user-action events the SDK emits (issue #175) and,
// for the showcase, logs each one to the console and re-dispatches it as a `sodax:analytics` window
// CustomEvent so any UI panel can subscribe and render a live feed. A real integrator would forward
// `event` to their product-analytics backend (Segment, Amplitude, PostHog, …) instead.

const PREFIX = '[Sodax Analytics]';

/** Window CustomEvent name a UI can listen on: `window.addEventListener('sodax:analytics', …)`. */
export const ANALYTICS_EVENT_NAME = 'sodax:analytics';

/**
 * JSON-friendly view of an event (coerces any `bigint` in `data` to a decimal string) so it can be
 * logged / serialized without throwing.
 */
function toSerializable(event: AnalyticsEvent): AnalyticsEvent {
  if (!event.data) return event;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.data)) {
    data[key] = typeof value === 'bigint' ? value.toString() : value;
  }
  return { ...event, data };
}

/**
 * Build the demo's `analytics` option for `new Sodax({ analytics })`.
 *
 * Enabled by default so the demo tracks out of the box; pass `{ enabled: false }` (or set
 * `VITE_ENABLE_ANALYTICS=false`) to return `undefined`, which leaves the SDK on its disabled default.
 * `level: 'detailed'` so the showcase surfaces full event payloads.
 */
export function createDemoAnalytics(options: { enabled?: boolean } = {}): AnalyticsConfig | undefined {
  const enabled = options.enabled ?? import.meta.env.VITE_ENABLE_ANALYTICS !== 'false';
  if (!enabled) return undefined;

  return {
    level: 'detailed',
    sink: {
      track(event) {
        const serializable = toSerializable(event);
        console.info(`${PREFIX} ${event.feature}.${event.action}:${event.phase}`, serializable.data ?? {});
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(ANALYTICS_EVENT_NAME, { detail: serializable }));
        }
      },
    },
  };
}
