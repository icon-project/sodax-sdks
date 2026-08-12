import * as v from 'valibot';
import { FillEventSchema } from './backendApiSchemas.js';

export type FillEvent = v.InferOutput<typeof FillEventSchema>;

/** Narrows an `IntentResponse.events` entry, which is typed `unknown[]`. */
export const isFillEvent = (value: unknown): value is FillEvent => v.is(FillEventSchema, value);
