# Joins the SODAX solver price oracles to the SDK swap-supported token lists and
# produces both a GitBook-ready markdown document and a sync report.
#
# Input (.) : the SDK dump from dump-swap-tokens.mts
#             { relayChainIdMap, chains, production, stagingOnly }
# Args      : --slurpfile prod   <prod-oracle.json>      (array of oracle entries)
#             --slurpfile staging <staging-oracle.json>  (array of oracle entries)
#             --arg prodUrl / stagingUrl / date
#
# Output    : a single object { markdown, report, drift } where `drift` is the count of
#             EVM SDK tokens missing from their environment's oracle (used for the exit code).

def lc: ascii_downcase;

# Tokens the SDK considers supported for an environment at a chain.
# Staging = production list + staging-only extras (the two lists are disjoint per chain).
def envTokens($sdk; $ck; $env):
  ($sdk.production[$ck] // [])
  + (if $env == "staging" then ($sdk.stagingOnly[$ck] // []) else [] end);

# Per-chain analysis for one environment.
def analyze($sdk; $oracle; $env):
  [ $sdk.production
    | keys_unsorted[] as $ck
    | ($sdk.chains[$ck] // { name: $ck, type: "UNKNOWN", addressUrl: "" }) as $meta
    | ($sdk.relayChainIdMap[$ck] // "") as $cid
    | ($meta.type == "EVM") as $isEVM
    | (envTokens($sdk; $ck; $env)) as $tokens
    | ([ $oracle[] | select(.chainId == $cid) ]) as $oTokens
    | ([ $oTokens[].address | lc ]) as $oAddrs
    | ([ $tokens[].address | lc ]) as $sAddrs
    | {
        chainKey: $ck,
        name: $meta.name,
        type: $meta.type,
        addressUrl: $meta.addressUrl,
        cid: $cid,
        isEVM: $isEVM,
        tokens: $tokens,
        oracleCount: ($oTokens | length),
        # EVM SDK tokens absent from the oracle => the SDK list is ahead of / out of sync with the solver.
        missing: [ $tokens[] | . as $t | ($t.address | lc) as $a
                   | select($isEVM and (($oAddrs | index($a)) == null)) ],
        # Oracle tokens absent from the SDK list => candidates the SDK may be missing (informational).
        extra:   [ $oTokens[] | . as $o | ($o.address | lc) as $a
                   | select(($sAddrs | index($a)) == null) ]
      }
  ];

# --- markdown rendering -------------------------------------------------------

# Renders one address cell, linked to the explorer when a base URL is known.
def mdAddr($url; $addr):
  if ($url | length) > 0
  then "[`\($addr)`](\($url)\($addr))"
  else "`\($addr)`" end;

# Combined per-chain tables: every supported token in one list, marked by environment —
# ✅ production · 🚧 staging-only (staging supports the production set plus these).
#
# Addresses shown are the **hub (Sonic) asset addresses**, matching the public GitBook
# page (https://docs.sodax.com/developers/deployments/solver-compatible-assets): tokens are
# grouped by their spoke chain, but every address is the token's representation on the Sonic
# hub and links to sonicscan.org. (The spoke-chain address is what the sync check matches.)
def mdCombined($sdk):
  ($sdk.chains["sonic"].addressUrl // "") as $hubUrl
  | [ $sdk.production
      | keys_unsorted[] as $ck
      | ($sdk.chains[$ck] // { name: $ck }) as $meta
      | ( (($sdk.production[$ck] // []) | map(. + { marker: "✅" }))
          + (($sdk.stagingOnly[$ck] // []) | map(. + { marker: "🚧" })) ) as $all
      | select(($all | length) > 0)
      | "### \($meta.name)\n\n| Token | Hub asset (Sonic) |\n| --- | --- |\n"
        + ( [ $all[] | "| \(.marker) \(.symbol) | " + mdAddr($hubUrl; .hubAsset) + " |" ]
            | join("\n") )
    ] | join("\n\n");

# --- report rendering ---------------------------------------------------------

def reportLine:
  . as $c
  | if ($c.tokens | length) == 0 then empty
    else
      "  [\($c.name)] \($c.tokens | length) token(s)"
      + ( if ($c.isEVM | not) then " — non-EVM, not strictly checked"
          elif (($c.missing | length) > 0)
          then " — [31mMISSING from oracle: " + ([$c.missing[].symbol] | join(", ")) + "[0m"
          else " — in sync" end )
    end;

# Oracle-only tokens worth surfacing (skip Sonic: chainId 146 carries hub-internal
# vault/aToken assets that are not user-facing spoke tokens, so they are expected "extras").
def extraLine:
  . as $c
  | if ($c.isEVM and $c.chainKey != "sonic" and ($c.extra | length) > 0)
    then "  [\($c.name)] oracle has \($c.extra | length) token(s) not in SDK list: "
         + ([$c.extra[].symbol] | join(", "))
    else empty end;

# --- assemble -----------------------------------------------------------------
# Run with `jq -n -f` so the SDK dump arrives via --slurpfile sdk (this avoids
# embedding the filter in a shell string, where backticks/$vars would be mangled).

($sdk[0]) as $sdk
| ($prod[0]) as $prodOracle
| ($staging[0]) as $stgOracle
| (analyze($sdk; $prodOracle; "production")) as $prodA
| (analyze($sdk; $stgOracle; "staging")) as $stgA
| (([$prodA[].missing[]] | length) + ([$stgA[].missing[]] | length)) as $drift
| {
    drift: $drift,
    markdown: (
      "# Solver-Compatible Assets\n\n"
      + "_Auto-generated by `scripts/sync-swap-tokens-docs.sh` from the SODAX solver price oracles. Do not edit by hand._\n\n"
      + "_Last generated: \($date)._\n\n"
      + "SODAX runs two solver environments. The **staging** solver supports every production token **plus** the additional staging-only tokens listed below.\n\n"
      + "**Legend:** ✅ supported in **production** · 🚧 **staging-only** (not yet live on the production solver).\n\n"
      + "Tokens are grouped by their spoke chain; the address shown is the token's **hub asset address on Sonic** (links to sonicscan.org).\n\n"
      + "Oracles: production `\($prodUrl)` · staging `\($stagingUrl)`.\n\n"
      + "## Supported Swap Tokens\n\n"
      + mdCombined($sdk)
      + "\n"
    ),
    report: (
      "Swap token sync check\n=====================\n"
      + "Production oracle: \($prodUrl) (\($prodOracle | length) tokens)\n"
      + "Staging    oracle: \($stagingUrl) (\($stgOracle | length) tokens)\n\n"
      + "PRODUCTION (vs production oracle)\n"
      + ([ $prodA[] | reportLine ] | join("\n")) + "\n\n"
      + "STAGING (production + staging-only, vs staging oracle)\n"
      + ([ $stgA[] | reportLine ] | join("\n")) + "\n\n"
      + "Oracle-only tokens (informational — possible additions)\n"
      + (( [ ($prodA[] | extraLine) ] | unique | join("\n") ) as $ex
         | if ($ex | length) > 0 then $ex else "  (none)" end) + "\n\n"
      + ( if $drift > 0
          then "RESULT: [31m\($drift) EVM token(s) out of sync with the oracle.[0m"
          else "RESULT: [32mall EVM swap tokens are in sync with the oracle.[0m" end )
      + "\nNote: non-EVM chains (Solana, Sui, Stellar, Bitcoin, Stacks, ICON, Injective, NEAR) are listed\nbut not strictly checked — oracle/SDK address formats diverge; confirm with the solver team."
    )
  }
