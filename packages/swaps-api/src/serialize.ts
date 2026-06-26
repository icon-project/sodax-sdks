import type { IntentRequestV2 } from '@sodax/types';
import { SwapsApiError } from './errors.js';

/**
 * The only fields of {@link IntentRequestV2} that carry `bigint`; they serialize to decimal
 * strings on the wire. Everything else in the request surface is already a string/boolean.
 */
const INTENT_BIGINT_FIELDS = [
  'intentId',
  'inputAmount',
  'minOutputAmount',
  'deadline',
  'srcChain',
  'dstChain',
] as const;

type IntentBigintField = (typeof INTENT_BIGINT_FIELDS)[number];

/** Wire form of {@link IntentRequestV2}: its bigint fields become decimal strings. */
type SerializedIntentRequest = Omit<IntentRequestV2, IntentBigintField> & Record<IntentBigintField, string>;

const isIntentBigintField = (key: string): key is IntentBigintField =>
  (INTENT_BIGINT_FIELDS as readonly string[]).includes(key);

/**
 * Convert an {@link IntentRequestV2} to its JSON-safe wire form: the six bigint fields become
 * decimal strings; every other field is passed through. Throws `VALIDATION_ERROR` if a `bigint`
 * shows up in any other field — a caller bug we surface rather than silently coerce.
 */
export function serializeIntentRequest(intent: IntentRequestV2): SerializedIntentRequest {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(intent)) {
    if (typeof value === 'bigint') {
      if (!isIntentBigintField(key)) {
        throw new SwapsApiError('VALIDATION_ERROR', `Unexpected bigint in IntentRequestV2 field "${key}"`, {
          endpoint: 'serializeIntentRequest',
        });
      }
      out[key] = value.toString();
    } else {
      out[key] = value;
    }
  }
  return out as SerializedIntentRequest;
}

/**
 * `JSON.stringify` replacer that THROWS on any `bigint`. Used as the request-body boundary so a
 * bigint that was not explicitly serialized (e.g. a forgotten `serializeIntentRequest`) fails
 * loudly instead of crashing `JSON.stringify` or being silently dropped.
 */
export function rejectBigint(key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    throw new SwapsApiError('VALIDATION_ERROR', `Unexpected bigint at "${key || '<root>'}" in request body`);
  }
  return value;
}
