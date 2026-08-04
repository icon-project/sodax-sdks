---
"@sodax/wallet-sdk-react": patch
"@sodax/dapp-kit": patch
"@sodax/skills": patch
"@sodax/types": patch
"@sodax/sdk": patch
---

Published the docs that were reachable only on GitHub: logging, DEX, the Swaps API reference, the architecture reference, the chain-ID table, `@sodax/types`, the dapp-kit backend hooks and twelve wallet-sdk-react guides. Rewrote the logging page around what the SDK actually emits and added a runnable Node example, and corrected the DEX error contract, which documented types and codes that no longer exist in source.

Gave the rest of the modules the same doc + example + code treatment: fourteen guides now link the runnable example that already existed in `apps/`, `RecoveryService` has a page instead of one table row, and the node and demo READMEs are rewritten — the demo's was still Create React App boilerplate for a Vite app, and the node one told readers to run a script that does not exist. Also fixes `pnpm dev:demo`, whose turbo filter matched no package.
