---
"@sodax/sdk": patch
---

Fixed `api` config resolution discarding top-level flat fields whenever a per-service slice was present.
`new Sodax({ api: { baseURL, swapsApiConfig | sponsoringApiConfig } })` merges into the flat default, so
the slice arrived beside the surviving `baseURL`/`timeout`/`headers` — and the base and swaps clients then
fell back to the packaged endpoint, silently ignoring the configured one. Flat fields now layer underneath
the slices (defaults → flat fields → `baseApiConfig` → `swapsApiConfig`), so adding a slice to an existing
flat config no longer re-routes the other services, and sponsoring inherits a flat `timeout` as documented
(its `baseURL` and `headers` still never inherit).

A config whose flat fields match the packaged defaults — including every slice-only config — resolves
exactly as before. The change is visible only when flat fields and a slice were combined: those flat
`headers` now also reach the swaps client, which is the documented flat behavior (a flat `BaseApiConfig`
is shared by the base API and the swaps client) and matches how `baseApiConfig` headers have always
propagated to swaps.
