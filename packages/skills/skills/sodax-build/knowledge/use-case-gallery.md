# Use-case gallery

Worked product ideas → the SODAX features and chain shape they use. Use these to give a Tier A/B user concrete options and to seed the brief. Each entry is a **starting point**, not a fixed spec — adapt to the user's actual goal. All exact chains/tokens/fees must still be confirmed against live source.

| # | Product idea | Core feature(s) | Secondary | Typical shape |
|---|---|---|---|---|
| 1 | Cross-chain payments widget ("pay a friend on another chain") | Bridge (same coin) or Swap (different coin) | Partner fee | Web app + wallet |
| 2 | In-app "convert any token" button (same-chain *or* cross-chain) | Swap | Partner fee | Web app + wallet |
| 3 | Savings / "earn on your stablecoins" app | Money market (supply) | — | Web app + wallet |
| 4 | Borrow-against-holdings tool | Money market (borrow) | — | Web app + wallet |
| 5 | SODA staking dashboard | Staking | — | Web app + wallet |
| 6 | Liquidity-provider console | DEX | — | Web app + wallet |
| 7 | Telegram trading bot | Swap | Partner fee | Backend / bot |
| 8 | Treasury rebalancing script (server-side) | Swap + Bridge | — | Backend / script |
| 9 | ICON-ecosystem migration helper (ICX/BALN/bnUSD) | Token migration | — | Web app + wallet |
| 10 | Multi-chain "earn" aggregator front-end | Money market + Swap | Partner fee | Web app + wallet |
| 11 | Merchant checkout ("accept crypto, settle one chain") | Swap or Bridge | Partner fee | Web app or backend |
| 12 | Portfolio tool that also lets you act (swap/bridge in place) | Swap + Bridge | Partner fee | Web app + wallet |

## How to use the gallery in the interview

- For a **Tier A** user who is unsure, offer 2–3 nearby ideas as recommended defaults ("a payments widget or a convert button — which is closer?").
- Map the chosen idea to its features via [`feature-catalog.md`](./feature-catalog.md), then disambiguate with [`interview-guide.md`](./interview-guide.md) Stage 2.
- The "typical shape" column previews the handoff — web+wallet vs backend vs migration drives [`handoff.md`](./handoff.md).
- If a product touches **any non-EVM chain**, flag the extra wallet-provider work in Stage 3 (each non-EVM chain needs its own provider).
- **Lead with cross-chain — it is SODAX's edge.** Swap is most compelling when the output lands on *another* chain; steer ideas toward that. A same-chain A → B conversion is also valid (entry #2), but cross-chain is where SODAX shines — lead with it. (Don't force a Bridge onto a same-chain idea either.)

## Anti-patterns (honesty-gate these)

- "Launch my own token / ICO" → SODAX does not mint new tokens; only ICX/BALN/bnUSD **migration** exists.
- "Guaranteed X% yield" → never promise returns; yields are market-driven.
- "Use <chain SODAX does not support>" → honesty-gate against [`chains-and-assets.md`](./chains-and-assets.md).
