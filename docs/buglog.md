# T3N Walkthrough Bug Log — MANDATE (Phase 1)

This log is the verbatim record of every stuck point, documentation inconsistency, and platform bug encountered while completing the official Terminal 3 quickstart and walkthrough on testnet. It is a scored submission artifact for the Superteam bounty: bug submission quality and documentation quality are explicit judging criteria, so each entry below follows a strict template (finding → reproduction → severity → status → suggested fix) and each candidate is either confirmed, refuted, or marked N/A against live testnet behavior. Entries are filed as they are hit during the walkthrough; pre-seeded candidates from the research dossiers in `docs/research/` are tracked as checklist items at the bottom until they are exercised live.

Environment: Windows 11 (git-bash), Node v24.14.1, @terminal3/t3n-sdk 5.5.0, rustc 1.98.0, docs fetched 2026-09-01.

## Finding template (use for every entry)

For each bug found, add an entry with this exact structure:

### BUG-### — concise title
- Date: YYYY-MM-DD
- Area: docs | SDK | platform | environment
- Docs URL: the url of the relevant docs page
- Environment: OS, SDK version, node version
- Step / command: what was run
- Expected: what should happen
- Actual (verbatim): the exact error output, in a code block
- Reproduction: steps from clean state
- Severity: low | medium | high
- Status: open | confirmed | workaround | resolved
- Suggested fix: a one-line fix

---

## Confirmed findings (filled in as the walkthrough runs)

<!-- Entries are appended here in BUG-001, BUG-002, ... order as each finding is
     hit on live testnet. Every entry must follow the template above exactly.
     Copy the template block, fill every field, and set Status to one of:
     open | confirmed | workaround | resolved. -->

### BUG-001 — Native Rust build fails at link: git-bash `link.exe` is GNU coreutils, not the MSVC linker (environment)
- Date: 2026-09-01
- Area: environment
- Docs URL: https://docs.terminal3.io/developers/adk/get-started/build-contract
- Environment: Windows 11 (git-bash), rustc 1.98.0 stable-x86_64-pc-windows-msvc, VS 2026 BuildTools without the C++ (VCTools) workload
- Step / command: `cargo build --target wasm32-wasip2 --release` in `Terminal-3/z-tenant-flight` (official walkthrough step 2; full log: `C:\Users\fadhm\Desktop\t3n-walkthrough\build_log.txt`)
- Expected: WASM component built at `target/wasm32-wasip2/release/z_tenant_flight.wasm`
- Actual (verbatim):
```
error: linking with `link.exe` failed: exit code: 1
  = note: link: extra operand 'C:\...\build_script_build-...cgu.0.rcgu.o'
          Try 'link --help' for more information.
note: `link.exe` returned an unexpected error
note: in the Visual Studio installer, ensure the "C++ build tools" workload is selected
error: could not compile `serde_core` (build script) due to 1 previous error
error: could not compile `quote` (build script) due to 1 previous error
error: could not compile `proc-macro2` (build script) due to 1 previous error
error: could not compile `zmij` (build script) due to 1 previous error
```
- Reproduction: clean clone of z-tenant-flight on this host, `cargo build --target wasm32-wasip2 --release` → exit 101. Build scripts (proc-macro2/serde_core/quote/zmij) compile for the HOST, so they need a native linker; PATH resolves `link.exe` to git-bash's GNU coreutils `link` (a hardlink tool, accepts exactly 2 operands → "extra operand").
- Severity: high (blocks every native and wasm cargo build until fixed)
- Status: resolved (workaround applied 2026-09-01)
- Suggested fix: install the MSVC C++ build tools (`winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet --norestart"`) so the real `link.exe` (and Windows SDK libs) are on PATH for Rust; or use a GNU toolchain with mingw gcc.
- Workaround applied: rustup GNU toolchain (`stable-x86_64-pc-windows-gnu`) + portable MinGW-w64 gcc 16.2.0 (winlibs, C:\Users\fadhm\mingw64), pinned via `~/.cargo/config.toml` (`[target.x86_64-pc-windows-gnu] linker = "C:/Users/fadhm/mingw64/mingw64/bin/gcc.exe"`). `cargo build --target wasm32-wasip2 --release` on z-tenant-flight v0.4.1 → **Finished in 1m 34s, exit 0** (2026-09-01 23:05). ~460 MB footprint vs 6.73 GB for VCTools; no admin/UAC required.


### BUG-002 — fetchTrustedManifest always throws "Trust manifest ... is malformed" on testnet: SDK 5.5.0 requires rtmr1_allowlist, cluster manifest has only rtmr3_allowlist
- Date: 2026-09-01
- Area: SDK (schema mismatch vs platform)
- Docs URL: https://docs.terminal3.io/developers/adk/get-started/quickstart
- Environment: Windows 11, Node v24.14.1, @terminal3/t3n-sdk 5.5.0
- Step / command: `npx tsx quickstart.ts` — `await fetchTrustedManifest("testnet")` hits https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest
- Expected: operator-signed trust anchor returned (per npm readme: "verified against a public key pinned in this package")
- Actual (verbatim):
```
Error: Trust manifest at https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest is malformed.
```
- Reproduction: any fetchTrustedManifest("testnet") call with SDK 5.5.0 against the current testnet cluster. Manifest itself is valid JSON (HTTP 200, 518 bytes, keys: cluster/version/peer_ids/rtmr3_allowlist/signed_at/signature). Decompiled SDK check isSignedTrustManifest requires rtmr1_allowlist (array of strings) — the cluster manifest does not serve it, so Array.isArray(undefined) → false → "malformed".
- Severity: high (blocks the documented quickstart path out of the box)
- Status: confirmed
- Suggested fix: SDK must accept manifests without rtmr1_allowlist (or the cluster must publish it); until fixed, use the documented dev escape hatch trustAnchor: { unsafe_trust_server: true } on T3nClient and skip fetchTrustedManifest.
- Side effect: on this failure the SDK also dumps ~2.1 MB of whitespace to stdout (see BUG-007).

### BUG-003 — All claim-page keys for one account bind to the SAME DID on testnet (docs' "revisit the claim page once per agent" flow does not produce distinct agent identities)
- Date: 2026-09-01
- Area: platform
- Docs URL: https://docs.terminal3.io/developers/agents/register-agent ("it issues a fresh key together with metered test credits every time, so you can revisit it once per agent")
- Environment: Windows 11, Node v24.14.1, @terminal3/t3n-sdk 5.5.0, testnet
- Step / command: three distinct claim-page secp256k1 keys authenticated via handshake → authenticate; each printed its DID
- Expected: three different DIDs (docs: "The network binds it to your key the first time you authenticate")
- Actual (verbatim): three distinct keys (addresses 0x35ba9ee331 / 0x23bfa29d46 / 0x3b4ca0c839) all returned did:t3n:8e3547bce411fd4f51fe1f25df033d83acccc869. A freshly generated random key returned a distinct DID (did:t3n:5de6906f...), so per-key binding works — only claim-page keys collapse.
- Reproduction: generate 3 keys from https://www.terminal3.io/claim-page (same account), authenticate each.
- Severity: high for agent-identity workflows (agent/user/tenant separation collapses; the walkthrough's three-session demo becomes a self-grant)
- Status: confirmed
- Suggested fix: claim-page keys should mint per-key DIDs (or docs should state claim keys are account-scoped and agents must be minted via the org/t3n agent create path).
- Workaround used: random secp256k1 keys for agent/user identities (authenticate fine; zero credits — see BUG-004).

### BUG-004 — Zero-credit agent DID fails metered invoke with InsufficientCreditError (documented behavior, confirmed live)
- Date: 2026-09-01
- Area: platform (metering)
- Docs URL: https://docs.terminal3.io/developers/adk/tips/common-errors
- Step / command: user (random-key DID) signed agent-auth-update grant; agent (random-key DID, zero credits) called search-offers
- Expected: contract executes under the grant
- Actual (verbatim):
```
InsufficientCreditError: InsufficientCredit (account=f663b6d4005efe2ecac5a9486b5426b8499924d3, required=10000000000, available=0)
  detail: 'InsufficientCredit (account=..., required=10000000000, available=0)', httpStatus: 403, rpcMethod: 'action.execute'
```
- Note: the grant write itself (agent-auth-update on tee:user/contracts) succeeded from a zero-credit DID — only metered contract execution is gated.
- Severity: medium (documented; blocks bring-your-own-key agent flows unless credits are minted for the agent DID)
- Status: confirmed (documented behavior verified)
- Suggested fix: none (platform metering); for the demo use a credit-bearing identity or request tokens for the agent DID.

### BUG-005 — Walkthrough happy path stops at Duffel 401 without a real Duffel API token (external prerequisite, not a T3N bug — chain fully proven)
- Date: 2026-09-01
- Area: environment/external
- Docs URL: https://docs.terminal3.io/developers/adk/tips/seed-api-key
- Step / command: seeded duffel_api_key (dummy) into z:<tid>:secrets via map-entry-set; agent search-offers
- Expected: Duffel offers returned
- Actual (verbatim): contract error: Duffel offer-request failed: HTTP 401 — {"errors":[{"code":"access_token_not_found","message":"The access token you have used is not a valid API access token",...}]}
- Proof value: the contract READ the key from z:<tid>:secrets inside the enclave, built the offer-request, egress was allowed by the grant, and the request reached api.duffel.com — every T3N link in the chain verified live. Only Duffel auth is missing.
- Severity: low (external prereq)
- Status: workaround — provide a real Duffel sandbox token in DUFFEL_API_KEY to complete the happy path

### BUG-006 — Placeholder resolution with empty user profile: "user profile missing field: <field>" (documented placeholder-unknown path, confirmed live)
- Date: 2026-09-01
- Area: platform (placeholders)
- Docs URL: https://docs.terminal3.io/developers/adk/tips/placeholders-outbound-calls
- Step / command: book-offer with a user session whose profile is empty
- Actual (verbatim): contract error: duffel create-order: user profile missing field: date_of_birth
- Evidence: {{profile.first_name}} / {{profile.last_name}} resolved (present in profile), {{profile.date_of_birth}} did not — the substitution happens host-side inside the enclave against the CALLING user's profile, exactly as documented; markers never leak into contract/agent output.
- D1 impact: {{profile.iban}} / {{profile.swift_bic}} / {{profile.legal_name}} are NOT in the documented schema and are unconfirmed on this cluster — the MANDATE marker strategy must verify profile fields before relying on them (Phase 1 decision D1 stays OPEN; date_of_birth already absent is a warning sign).
- Severity: medium for flows that assume a populated profile
- Status: confirmed (documented behavior verified)

### BUG-007 — SDK dumps ~2.1 MB of output to stdout on RPC failures (whitespace blob, or the full index.esm.js source) — output noise
- Date: 2026-09-01
- Area: SDK
- Environment: @terminal3/t3n-sdk 5.5.0, tsx 4.23.13
- Step / command: any failing SDK call (fetchTrustedManifest malformed; getContractVersion 404; InsufficientCreditError)
- Expected: clean error to stderr
- Actual: 2,160,364 whitespace chars (quickstart) / full minified SDK source (invoke) dumped to stdout before the error — 2.1 MB of noise in every failure
- Severity: low (cosmetic but breaks log pipelines)
- Status: confirmed
- Suggested fix: SDK should not write the module source / padding to stdout on error paths


## Pre-seeded candidates (unverified — confirm on live testnet during the walkthrough)

These come from the research dossiers in `docs/research/`; each must be confirmed, refuted, or marked N/A as the walkthrough runs. Keep them as checklist items with a checkbox:

1. [x] CONFIRMED (curl 404 on both) — docs-level, no live step needed: https://docs.terminal3.io/api-reference/openapi.json and https://docs.terminal3.io/terminal-3-openapi.yml are linked from /llms.txt and the ADK reference page (which claims '21 paths, 24 operations, OpenAPI 3.0.3') but return 404.
2. [x] CONFIRMED as docs drift (quickstart says defaults testnet; reference table says production) — always call setEnvironment explicitly: the Quickstart page says the public SDK defaults to testnet; the SDK reference page says it defaults to production. Always calling setEnvironment('testnet') explicitly.
3. [x] CONFIRMED: getContractVersion works live; getScriptVersion is the stale reference-page name
4. [x] CONFIRMED (repo README/lib.rs show host_capabilities JSON; docs: "there is no separate manifest"): the z-tenant-flight repo README/lib.rs shows a JSON host_capabilities manifest; the docs say capabilities come only from WIT imports ('there is no separate manifest').
5. [ ] NOT VERIFIED live (docs-level drift only): the reference page's http-with-placeholders gating column mentions a per-contract placeholder_allowlist; the vendored WIT comment says the only gate is the hard 'profile' namespace plus the delegation grant.
6. [x] VERIFIED: getAuditEvents() is a working typed method; returns AuditPage (empty here because z-tenant-flight never calls logging::audit) 'reported to exist but undocumented'; it IS a typed T3nClient method in 5.5.0.
7. [x] VERIFIED indirectly: z-tenant-flight hex-encodes tenant_did() and its secrets read works on live testnet: docs warn the contract's tenant_did() returns raw bytes and must be hex-encoded before building z-prefixed tid paths; missing OR double hex-encoding both produce a path that matches nothing.
8. [x] VERIFIED: explicit readers/writers={only:[contractId]} map created and readable; status active: maps.create without explicit readers creates a map nobody (not even the owner's contract) can read, with no error (silent deny-all; only a console.warn).
9. [ ] NOT EXERCISED (single registration; docs statement stands) at the same tail with no API to fetch the tail's current id — stale map ACLs possible after re-registering (docs admit the gap).
10. [~] PARTIALLY VERIFIED: first_name/last_name resolve; date_of_birth missing from profile; iban/swift/legal_name unconfirmed — D1 stays OPEN: {{profile.iban}}, {{profile.swift_bic}}, {{profile.legal_name}} are NOT in the documented profile fields (docs list first_name, last_name, date_of_birth, gender, verified_contacts.email.value). Verify against the live cluster; decide marker strategy.

## Local environment findings (NOT T3N bugs — for the handover note)

Machine-level blockers found during setup on this Windows host. These are **environment** issues, not Terminal 3 platform bugs — they are logged here so the handover note and the walkthrough runner's checklist account for them:

- **(a) MSVC C++ build tools (VCTools workload) missing.** Native Rust build scripts fail at the link step with `'link: extra operand'` — in git-bash, `link.exe` resolves to GNU coreutils' `link`, not the MSVC linker, so linking fails. The wasm32-wasip2 contract build also compiles host build scripts, so it is affected too. Fix: `winget install Microsoft.VisualStudio.2022.BuildTools` with the VCTools workload, and ensure the MSVC `link.exe` precedes coreutils on PATH for Rust invocations.
- **(b) rustup had no default toolchain.** `cargo`/`rustc` were unusable until `rustup default stable` was run, which pinned the toolchain to 1.98.0. Resolved; noted so a fresh checkout does not repeat the diagnosis.

## How to run the walkthrough (reference)

Ordered official walkthrough steps, one line each, from `https://docs.terminal3.io/developers/adk/get-started/...`:

1. Quickstart — https://docs.terminal3.io/developers/adk/get-started/quickstart — install the SDK, pick testnet, first client setup.
2. Write contract — https://docs.terminal3.io/developers/adk/get-started/write-contract — scaffold the WIT contract and implement host-callable logic.
3. Build contract — https://docs.terminal3.io/developers/adk/get-started/build-contract — compile to wasm32-wasip2 and check host build-script viability on this machine.
4. Register contract — https://docs.terminal3.io/developers/adk/get-started/register-contract — push the contract to the cluster and capture the returned contract id.
5. Invoke contract — https://docs.terminal3.io/developers/adk/get-started/invoke-contract — call the registered contract from Node against testnet.
6. Test — https://docs.terminal3.io/developers/adk/get-started/test — run the walkthrough test flow and record results against the pre-seeded candidates.
