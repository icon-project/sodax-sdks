---
"@sodax/types": minor
"@sodax/sdk": minor
---

Add a `radfi.signRequest` option to `new Sodax(...)` — a `RadfiSigner` hook the SDK calls once per outbound Bound Exchange (RadFi) request, merging the returned headers onto it. A server-side caller can now attach Bound's `x-api-signature` HMAC header without the SDK ever holding the credential: the consumer owns the secret and computes the signature. Callers that pass no signer are unaffected.
