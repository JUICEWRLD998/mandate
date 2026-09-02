# T3N ADK — Bug Report (Bounty Submission Artifact)

**Scope.** This report documents platform, SDK, documentation and environment bugs encountered while completing the official Terminal 3 (T3N) ADK quickstart + walkthrough and building the **MANDATE** enterprise agent on the T3N public testnet on **2026-09-01/02**. Every entry was reproduced from a clean state — either live against the testnet cluster (command → verbatim error) or by direct re-fetch of the cited documentation. Nothing here is inferred or copied from third-party sources. The raw, verbatim working log is kept unedited at [`docs/buglog.md`](./buglog.md); this document is the formalized submission-grade version of that log, extended with the doc-drift findings verified on 2026-09-02. Report IDs map 1:1 to buglog entries (R01 = BUG-001 … R09 = BUG-009; R10–R14 correspond to the buglog's pre-seeded candidates 1, 2, 3, 5 and 9).

**Environment (all reproductions).**

| Component | Value |
|---|---|
| OS | Windows 11 (git-bash / MSYS2 shell) |
| Node.js | v24.14.1 (`type: module`) |
| SDK | `@terminal3/t3n-sdk` **5.5.0** (pinned; npm `latest`), tsx 4.23.13 |
| Rust | rustc 1.98.0 stable (rustup) — MSVC host toolchain initially, GNU host toolchain after BUG-001 workaround |
| Target cluster | T3N testnet (`cn-api.sg.testnet.t3n.terminal3.io`, node URL resolved via `getNodeUrl()` after `setEnvironment("testnet")`) |
| Docs | `docs.terminal3.io` — fetched 2026-09-01, re-verified 2026-09-02 (raw `.md` variants, rendered pages, `llms.txt`) |

**Reporter/tenant facts for traceability:** testnet tenant `did:t3n:8e3547bce411fd4f51fe1f25df033d83acccc869`; walkthrough reference contract `z-tenant-flight` (registration id 856) and MANDATE contract `z:8e3547bce411fd4f51fe1f25df033d83acccc869:mandate-contracts` (registration ids 856 → 862 across re-registrations, see R14).

---

## 1. Summary matrix (severity-sorted)

| ID | Finding (one line) | Area | Severity | Status |
|---|---|---|---|---|
| R02 | `fetchTrustedManifest("testnet")` always throws "Trust manifest … is malformed": SDK 5.5.0 requires `rtmr1_allowlist`, testnet manifest serves only `rtmr3_allowlist` | SDK | **High** | Confirmed — workaround in host code |
| R03 | All claim-page keys for one account collapse to a single DID ("revisit it once per agent" does not mint distinct agent identities) | Platform | **High** | Confirmed |
| R08 | Documented `agent-auth-update` grant writes succeed but no longer arm egress on testnet; egress enforced only from modern member-delegation doc | Docs/SDK | **High** | Confirmed — dual-surface workaround |
| R01 | Native Rust link failure in git-bash: `link.exe` resolves to GNU coreutils, not the MSVC linker | Environment | Medium | Resolved — GNU toolchain |
| R04 | Zero-credit agent DID fails metered invoke with real `InsufficientCreditError` (documented metering, confirmed live) | Platform | Medium | Confirmed |
| R06 | Empty/partial user profile → `user profile missing field: date_of_birth` mid-flight (placeholder-unknown path) | Platform | Medium | Confirmed |
| R09 | Egress host matching strips the port: entry `localhost:8787` never matches `http://localhost:8787`; denial names `localhost` | Platform/docs | Medium | Confirmed — host-only entries |
| R13 | Host API table claims a per-contract `placeholder_allowlist`; vendored WIT + live behavior show only the hard `profile` namespace gate | Docs | Medium | Confirmed |
| R14 | Re-registration allocates a NEW `contract_id` (856 → 862) with no API to fetch the tail's current id → stale secrets-map ACLs | Platform | Medium | Workaround — `maps.update` re-point |
| R05 | Walkthrough happy path stops at Duffel HTTP 401 without a real Duffel sandbox token (external prereq; chain proven to the API) | External | Low | Workaround needed (external token) |
| R07 | SDK dumps ~2.1 MB of noise to stdout on every RPC failure path (whitespace blob or minified source) | SDK | Low | Confirmed |
| R10 | OpenAPI spec URLs linked from `llms.txt` + reference page (`/api-reference/openapi.json`, `/terminal-3-openapi.yml`) both return 404 | Docs | Low | Confirmed |
| R11 | `setEnvironment` default contradiction: quickstart says testnet; reference table claimed production (09-01); docs converged by 09-02 | Docs | Low | Resolved (docs updated) |
| R12 | Reference page named `getScriptVersion`; the runnable walkthrough (and live testnet) use `getContractVersion` — docs fixed by 09-02 | Docs/SDK | Low | Resolved (docs updated) |

---

## 2. Full reports

### R01 — Native Rust build fails at link: git-bash `link.exe` is GNU coreutils, not the MSVC linker

- **Summary.** The documented contract build (`cargo build --target wasm32-wasip2 --release`) fails on this Windows host at the *host* build-script link step: `PATH` resolves `link.exe` to git-bash's GNU coreutils `link` (a hard-link tool) instead of the MSVC linker, so every host-targeted build script (`proc-macro2`, `serde_core`, `quote`, `zmij`) dies with `extra operand`. This is an environment defect — not a T3N platform bug — but it blocks the official build step for any Windows developer on a rustup-MSVC toolchain whose `PATH` puts coreutils first and whose Visual Studio installation lacks the C++ (VCTools) workload.
- **Area:** environment · **Severity:** medium · **Status:** resolved (workaround) · **Environment:** Windows 11 (git-bash), rustc 1.98.0 `stable-x86_64-pc-windows-msvc`, VS 2026 BuildTools *without* VCTools.
- **Docs URL:** https://docs.terminal3.io/developers/adk/get-started/walkthrough/build-contract (the buglog's recorded `/developers/adk/get-started/build-contract` path itself 404s as of 2026-09-02 — the page lives under `/walkthrough/`).
- **Steps to reproduce (clean state):**
  ```bash
  rustup default stable && rustup target add wasm32-wasip2
  git clone https://github.com/Terminal-3/z-tenant-flight.git && cd z-tenant-flight
  cargo build --target wasm32-wasip2 --release
  ```
  → exit 101. WASM-only code is fine; the *build scripts* compile for the host, which needs a native linker, and `which link.exe` in git-bash reports the coreutils binary (a hardlink utility accepting exactly two operands).
- **Expected vs Actual (verbatim):** expected a component at `target/wasm32-wasip2/release/z_tenant_flight.wasm`. Actual:
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
- **Impact:** every native *and* wasm cargo build is blocked until the toolchain mix is fixed — a hard stop for Windows-based contract development.
- **Suggested fix:** install the MSVC C++ build tools so the real `link.exe` precedes coreutils for Rust invocations, e.g. `winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet --norestart"`; or standardize on a GNU toolchain.
- **Workaround applied:** rustup GNU toolchain (`stable-x86_64-pc-windows-gnu`) + portable MinGW-w64 gcc 16.2.0 (winlibs, `C:\Users\fadhm\mingw64`), pinned via `~/.cargo/config.toml`:
  ```toml
  [target.x86_64-pc-windows-gnu]
  linker = "C:/Users/fadhm/mingw64/mingw64/bin/gcc.exe"
  ```
  `cargo build --target wasm32-wasip2 --release` on z-tenant-flight v0.4.1 → **Finished in 1m 34s, exit 0** (2026-09-01 23:05); ~460 MB footprint vs 6.73 GB for VCTools, no admin/UAC.

### R02 — `fetchTrustedManifest` always throws "Trust manifest … is malformed" on testnet (SDK/platform schema mismatch)

- **Summary.** With SDK 5.5.0, every `fetchTrustedManifest("testnet")` call against the current testnet cluster throws. The served manifest is valid JSON (HTTP 200, 518 bytes) but carries only `rtmr3_allowlist`; the SDK's trust check (`isSignedTrustManifest`, inspected in the decompiled dist bundle) requires `rtmr1_allowlist` to be an array, and `Array.isArray(undefined) → false` → "malformed". This breaks the documented quickstart out of the box and makes the npm-readme attestation claim ("verified against a public key pinned in this package") unreachable on testnet.
- **Area:** SDK (schema mismatch vs platform) · **Severity:** high · **Status:** confirmed; workaround in host code · **Environment:** Node v24.14.1, `@terminal3/t3n-sdk` 5.5.0.
- **Docs URL:** https://docs.terminal3.io/developers/adk/get-started/quickstart
- **Steps to reproduce (clean state):**
  ```bash
  mkdir my-t3n-app && cd my-t3n-app
  npm init -y && npm pkg set type=module
  npm install @terminal3/t3n-sdk@5.5.0 tsx
  export T3N_API_KEY="<claim-page key>"
  # quickstart.ts:  const t3n = new T3nClient({ trustAnchor: await fetchTrustedManifest("testnet"), ... });
  npx tsx quickstart.ts
  ```
  The call hits `https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest`.
- **Expected vs Actual (verbatim):** expected an operator-signed trust anchor. Actual:
  ```
  Error: Trust manifest at https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest is malformed.
  ```
- **Impact:** the documented first-client path fails before any authenticated call; attestation pinning is unavailable on testnet with this SDK version.
- **Suggested fix:** the SDK must accept manifests without `rtmr1_allowlist` (or the testnet cluster must publish it).
- **Workaround applied:** the documented dev escape hatch `trustAnchor: { unsafe_trust_server: true }` on `T3nClient`, skipping `fetchTrustedManifest` — carried by every session in `host/src/connect.ts` (`createSession`, all three identities). Side effect: the failure also triggers the ~2.1 MB stdout dump reported in R07.

### R03 — All claim-page keys for one account collapse to the SAME DID

- **Summary.** Docs tell builders to get each agent's key from the claim page because it "issues a fresh key together with metered test credits every time, so you can revisit it once per agent". Live testnet contradicts this: three distinct claim-page keys minted under the same account all authenticate to the *same* DID, so the documented multi-agent flow collapses into a self-grant. Per-key DID binding itself works (a freshly generated random key produced a distinct DID) — only claim-page keys collapse.
- **Area:** platform · **Severity:** high (agent-identity workflows; agent/user/tenant separation collapses) · **Status:** confirmed · **Environment:** Node v24.14.1, SDK 5.5.0, testnet.
- **Docs URL:** https://docs.terminal3.io/developers/agents/register-agent (quote re-verified 2026-09-02: "it issues a fresh key together with metered test credits every time, so you can revisit it once per agent, not just once for yourself").
- **Steps to reproduce (clean state):** generate three keys from https://www.terminal3.io/claim-page under one account; for each, build a `T3nClient` and `handshake()` → `authenticate(createEthAuthInput(address))`; print `did.value`.
- **Expected vs Actual (verbatim):** expected three distinct DIDs ("the network binds it to your key the first time you authenticate"). Actual — three distinct secp256k1 keys with addresses `0x35ba9ee331`, `0x23bfa29d46`, `0x3b4ca0c839` all returned:
  ```
  did:t3n:8e3547bce411fd4f51fe1f25df033d83acccc869
  ```
  while a freshly generated random key returned a distinct `did:t3n:5de6906f…`.
- **Impact:** the walkthrough's three-session demo (tenant/agent/user) becomes a self-grant when claim-page keys are reused per the docs; audit attribution and revocation scoping are ambiguous.
- **Suggested fix:** claim-page keys should mint per-key DIDs, or the docs must state that claim keys are account-scoped and agents must be minted via the org/`t3n agent create` path.
- **Workaround applied:** random secp256k1 keys for agent/user identities (authenticate fine; they start with zero credits — see R04); `host/src/connect.ts` documents that each key must come from a fresh claim.

### R04 — Zero-credit agent DID fails metered invoke with `InsufficientCreditError` (documented metering, confirmed live)

- **Summary.** Metered contract execution is charged against the *calling identity's own* balance, which "starts at zero even when the tenant has plenty of test tokens" (docs). Confirmed live with the real error message. Note the grant write itself (`agent-auth-update`) succeeded from the zero-credit agent DID — only metered execution is gated.
- **Area:** platform (metering) · **Severity:** medium (documented behavior; blocks bring-your-own-key agent flows) · **Status:** confirmed · **Environment:** Node v24.14.1, SDK 5.5.0, testnet.
- **Docs URL:** https://docs.terminal3.io/developers/adk/tips/common-errors (row re-verified 2026-09-02: "an agent DID's balance is separate from its tenant's, and starts at zero even when the tenant has plenty of test tokens").
- **Steps to reproduce (clean state):** user (random-key DID) signs an `agent-auth-update` grant for the agent; agent (random-key DID, zero credits) calls `search-offers` on the granted contract.
- **Expected vs Actual (verbatim):** expected the contract to execute under the grant. Actual:
  ```
  InsufficientCreditError: InsufficientCredit (account=f663b6d4005efe2ecac5a9486b5426b8499924d3, required=10000000000, available=0)
    detail: 'InsufficientCredit (account=..., required=10000000000, available=0)', httpStatus: 403, rpcMethod: 'action.execute'
  ```
- **Impact:** any agent key not minted on the claim page silently 403s on its first metered call; the error text names the account but not the remedy.
- **Suggested fix:** none (platform metering) — surface the balance top-up path in the error, and have the demo use a credit-bearing identity.
- **Workaround applied:** request test tokens for the agent DID (claim page / `t.me/wardumb` per the bounty listing); MANDATE's three sessions each carry their own credit-bearing keys.

### R05 — Walkthrough happy path stops at Duffel HTTP 401 without a real Duffel sandbox token (external prerequisite — chain fully proven)

- **Summary.** Not a T3N bug: with a dummy `duffel_api_key` the agent's `search-offers` fails at Duffel auth. The failure is *proof* that every T3N link works — the contract read the key from `z:<tid>:secrets` inside the enclave, built the offer-request, the grant allowed egress, and the request reached `api.duffel.com`. Only Duffel authentication is missing. The docs do not flag that a real external token is required before the happy path can complete.
- **Area:** environment/external · **Severity:** low · **Status:** workaround (external token required) · **Environment:** Node v24.14.1, SDK 5.5.0, testnet.
- **Docs URL:** https://docs.terminal3.io/developers/adk/tips/seed-api-key
- **Steps to reproduce (clean state):** seed a dummy `duffel_api_key` into `z:<tid>:secrets` via `map-entry-set`; agent invokes `search-offers`.
- **Expected vs Actual (verbatim):** expected Duffel offers. Actual contract error:
  ```
  contract error: Duffel offer-request failed: HTTP 401 — {"errors":[{"code":"access_token_not_found","message":"The access token you have used is not a valid API access token",...}]}
  ```
- **Impact:** the documented demo stalls at an external auth wall with no doc note telling builders to bring a real (sandbox) token first.
- **Suggested fix:** docs should list the Duffel sandbox-token prereq (and where to get one) on the walkthrough page, not only the seeding tip.
- **Workaround applied:** pending — provide a real Duffel sandbox token via `DUFFEL_API_KEY` to complete the walkthrough happy path.

### R06 — Empty/partial user profile → `user profile missing field: date_of_birth` (documented placeholder-unknown path, confirmed live)

- **Summary.** Placeholder substitution behaves exactly as documented — markers are resolved host-side inside the enclave against the *calling user's* profile, and missing fields surface as a contract error naming the field. The live walkthrough confirmed `{{profile.first_name}}` / `{{profile.last_name}}` resolve while `{{profile.date_of_birth}}` does **not** on this cluster's profiles: a partially-populated profile fails mid-flight. Markers never leak into contract/agent output.
- **Area:** platform (placeholders) · **Severity:** medium (for flows assuming a populated profile) · **Status:** confirmed · **Environment:** Node v24.14.1, SDK 5.5.0, testnet.
- **Docs URL:** https://docs.terminal3.io/developers/adk/tips/placeholders-outbound-calls
- **Steps to reproduce (clean state):** `book-offer` against a user session whose profile lacks `date_of_birth`.
- **Expected vs Actual (verbatim):** expected booking to proceed with resolved markers. Actual contract error:
  ```
  contract error: duffel create-order: user profile missing field: date_of_birth
  ```
- **Impact:** flows that assume the documented profile fields are populated fail at runtime with no up-front signal; marker-based PII strategies must verify profile completeness first.
- **Suggested fix:** expose a profile-completeness check (or validate at `user-upsert` time) so missing fields are caught before a paid/egress call; docs should list which fields the walkthrough profile must carry.
- **Open follow-on (D1):** `{{profile.iban}}`, `{{profile.swift_bic}}`, `{{profile.legal_name}}` are **not** in the documented profile schema (docs list `first_name`, `last_name`, `date_of_birth`, `gender`, `verified_contacts.email.value`) and remain unconfirmed on this cluster — the MANDATE marker strategy must verify each profile field live before relying on it. `date_of_birth` already being absent is a warning sign; **D1 stays open** pending the live pay run.

### R07 — SDK dumps ~2.1 MB of output to stdout on RPC failure paths

- **Summary.** Every failing SDK call observed (malformed trust manifest, `getContractVersion` 404, `InsufficientCreditError`) was preceded by a large stdout dump — 2,160,364 whitespace characters in the quickstart case, the full minified `index.esm.js` source in another — before the real error. Cosmetic, but it corrupts logs and drowns errors in CI/pipe captures.
- **Area:** SDK · **Severity:** low (cosmetic; breaks log pipelines) · **Status:** confirmed · **Environment:** `@terminal3/t3n-sdk` 5.5.0, tsx 4.23.13.
- **Docs URL:** n/a (SDK behavior).
- **Steps to reproduce (clean state):** run any failing SDK call — `fetchTrustedManifest("testnet")` (R02), a `getContractVersion` on an unknown script, or a metered call from a zero-credit identity (R04) — with stdout captured to a file.
- **Expected vs Actual:** expected a clean error on stderr. Actual: ~2.1 MB of whitespace/module source on stdout *before* the error.
- **Impact:** log pipelines and CI runners capture megabytes of noise per failure; the actual error can be pushed past a truncation window.
- **Suggested fix:** the SDK should not write module source/padding to stdout on error paths; route diagnostics to stderr or drop them.
- **Workaround applied:** none needed (non-blocking); failure logs are captured to files with the dump truncated.

### R08 — `agent-auth-update` writes succeed but NO LONGER arm egress on testnet — docs drift (docs = scoring surface)

- **Summary.** The walkthrough, the Agent Auth overview page, and the SDK reference table all present `agent-auth-update` on `tee:user/contracts` as **the** grant write that arms a contract's egress. Live testnet (2026-09-02) accepts the write without error but **ignores it for egress**: invoking the granted contract still fails with `egress denied`. Egress is enforced only from the modern **member-delegation** document on `tee:authorisations/contracts` (SelfOnly, metered ~1e10/op), written via SDK `updateMemberDelegation(BoundGrant)` with a snake_case wire shape (no casing transform). A developer following today's docs therefore builds a grant that *silently cannot egress* — the exact failure the docs flag as their #1 integration warning.
- **Area:** docs/SDK (delegation surface drift) · **Severity:** **HIGH** · **Status:** confirmed (live, 2026-09-02); workaround in host code · **Environment:** Node v24.14.1, SDK 5.5.0, testnet, contract `z:8e3547bce411fd4f51fe1f25df033d83acccc869:mandate-contracts` (id 862).
- **Docs URL:** https://docs.terminal3.io/developers/adk/overview/agent-auth-adk (re-fetched 2026-09-02: still documents `function_name: "agent-auth-update"` as the grant write; zero mentions of member-delegation). The SDK reference page's table row likewise: "`agent-auth-update` (contract call, signed by the data owner) — Grants an agent access to specific functions on a specific contract, scoped to specific hosts."
- **Steps to reproduce (clean state):** register a contract (`cd host && npm run register`), then sign the *documented* grant exactly as the walkthrough shows — the user session executes `function_name: "agent-auth-update"` on `tee:user/contracts` with `allowedHosts: ["localhost:8787"]` — and invoke as the agent (z-mandate's `onboard-customer` dials `RAIL_BASE http://localhost:8787`). Repeated with `allowedHosts: ["localhost"]` → identical denial. The legacy write itself succeeds (no error) — it just has no effect on egress. Writing the modern `BoundGrant` (`grantee`, `contract_id`, `functions`, `scopes`, `version_req`, `allowed_hosts`) via the SDK's `updateMemberDelegation` arms egress as documented.
- **Expected vs Actual (verbatim):** expected the documented grant to arm egress. Actual (both host spellings):
  ```
  contract error: onboard-customer: egress denied for host localhost
  ```
- **Impact:** high for anyone following the current walkthrough — the scored surface teaches a write that no longer grants egress; "working" integrations silently degrade to `egress_denied` during the deprecation window.
- **Suggested fix:** docs should mark `agent-auth-update` deprecated-with-no-effect and standardize on the member-delegation surface (or the platform should keep legacy writes authoritative during the deprecation window).
- **Workaround applied:** dual-surface grant in `host/src/grant.ts` (`grantScript`): legacy `agent-auth-update` first for docs parity (best-effort; failure = warning), then modern `updateMemberDelegation(buildBoundGrant(...))` as the functional grant (failure aborts). Revocation (`revokeScript`) mirrors both: legacy empty `agents: []` + a full-doc `member-delegation-update` write with `{ grants: [], discover_dids: [] }`.

### R09 — Egress host matching strips the port: `localhost:8787` never matches `http://localhost:8787`

- **Summary.** The enclave compares egress allowlist entries against the bare host portion of the outbound URL. An entry `localhost:8787` therefore never matches egress to `http://localhost:8787` — and the denial error names only `localhost`, so the failed entry is not revealed. All documented examples use host-only entries (`api.duffel.com`), so the semantics are invisible until a developer adds a port.
- **Area:** platform/docs (egress matching semantics) · **Severity:** medium (silent misconfiguration: grant writes succeed, calls deny) · **Status:** confirmed (live) · **Environment:** Node v24.14.1, SDK 5.5.0, testnet, z-mandate contract (`RAIL_BASE http://localhost:8787`).
- **Docs URL:** https://docs.terminal3.io/developers/adk/tips/outbound-http-auth-by-user (host allowlist semantics; re-fetched 2026-09-02 — page shows only host-only examples such as `api.duffel.com` and does not document port handling).
- **Steps to reproduce (clean state):** grant `allowedHosts: ["localhost:8787"]` (modern surface) → invoke the egress function → `egress denied for host localhost`. Grant `allowedHosts: ["localhost"]` → allowed (egress-on-modern-surface was verified live during the phase-1 Duffel walkthrough — the request reached the API — and MANDATE's own modern grant is pending user credits, so the port-less entry behavior is stated from that evidence). Under the legacy surface both variants deny (see R08).
- **Expected vs Actual (verbatim):** expected `host:port` to match `http://host:port`. Actual:
  ```
  contract error: onboard-customer: egress denied for host localhost
  ```
  (error text always names the port-less host).
- **Impact:** port-carrying allowlist entries are dead entries; the denial message gives no hint which entry was attempted, so misconfiguration is silent and hard to debug.
- **Suggested fix:** match `host:port` when the URL carries a port (or document and validate host-only entries), and include the attempted `host:port` in the denial string.
- **Workaround applied:** host-only entries; `host/src/grant.ts` defaults `DEFAULT_HOSTS = ["localhost"]` and `parseHostsArg` rejects schemes/ports implicitly by documented contract ("host strings carry NO scheme and NO port").

### R10 — OpenAPI spec links from `llms.txt` and the ADK reference page return 404

- **Summary.** The docs' own LLM-ingest map (`/llms.txt`) links `[openapi](/api-reference/openapi.json)` and `[terminal-3-openapi](/terminal-3-openapi.yml)`; the ADK reference page asserts the REST surface was "Verified directly by parsing `terminal-3-openapi.yml` (21 paths, 24 operations, OpenAPI 3.0.3)" and promises an API-reference tab "generated directly from the spec (so it can't drift out of sync with this page)". Both linked artifacts return 404 — the claim is unverifiable and automation following `llms.txt` hits dead ends.
- **Area:** docs · **Severity:** low (hygiene/ingest; the REST table text survives on the page) · **Status:** confirmed (curl-verified 2026-09-01 and again 2026-09-02) · **Environment:** docs.terminal3.io.
- **Docs URLs:** https://docs.terminal3.io/llms.txt ; https://docs.terminal3.io/developers/adk/reference
- **Steps to reproduce (clean state):**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' https://docs.terminal3.io/api-reference/openapi.json   # → 404
  curl -s -o /dev/null -w '%{http_code}\n' https://docs.terminal3.io/terminal-3-openapi.yml       # → 404
  curl -s https://docs.terminal3.io/llms.txt | grep -A2 'OpenAPI Specs'
  ```
- **Expected vs Actual:** expected HTTP 200 spec documents. Actual: both return `404` ("Asset not found"), despite being listed in `llms.txt` and cited by the reference page.
- **Impact:** the "can't drift out of sync" guarantee is false today; LLM/automation consumers of `llms.txt` lose the REST surface entirely.
- **Suggested fix:** publish the spec at the linked paths (or update the links and the "verified by parsing" claim).
- **Workaround applied:** the reference page's REST table (tags/endpoints, `bearerAuth` + `x-api-token`, server `https://staging.terminal3.io`) is used as the surviving record.

### R11 — `setEnvironment` default contradiction (quickstart vs SDK reference table)

- **Summary.** On 2026-09-01 the two authoritative pages disagreed about the SDK's default cluster: the Quickstart says "the public SDK defaults to testnet — set it explicitly", while the SDK reference table claimed `Defaults to "production"` on its web-rendered copy even though the same page's raw `.md` said `Defaults to "testnet" in the public build` — i.e. the rendered and raw copies of the *same* reference page diverged, on top of the cross-page ambiguity. Re-fetched 2026-09-02: both the rendered page and the `.md` now read `Defaults to "testnet" in the public build` (converged). The safe practice — always calling `setEnvironment` explicitly — remains correct either way.
- **Area:** docs · **Severity:** low · **Status:** resolved (docs converged by 2026-09-02; drift observed 2026-09-01) · **Environment:** docs.terminal3.io.
- **Docs URLs:** https://docs.terminal3.io/developers/adk/get-started/quickstart ; https://docs.terminal3.io/developers/adk/reference
- **Steps to reproduce (clean state):** fetch both pages and compare the default statements:
  ```bash
  curl -s https://docs.terminal3.io/developers/adk/get-started/quickstart.md | grep -n 'defaults to'
  curl -s https://docs.terminal3.io/developers/adk/reference.md   | grep -n 'Defaults to'
  ```
  On 09-01 these disagreed (testnet vs production). On 09-02 both read testnet.
- **Expected vs Actual:** expected one documented default. Actual: contradictory defaults across/within pages at fetch time.
- **Impact:** a developer who trusted the "production" default would silently target the production cluster with test keys.
- **Suggested fix:** single, unambiguous documented default.
- **Workaround applied:** `host/src/connect.ts` (`connectAll`) always calls `setEnvironment("testnet")` before constructing any client, with a comment citing the contradiction.

### R12 — `getScriptVersion` (reference page) vs `getContractVersion` (runnable walkthrough) naming drift

- **Summary.** On 2026-09-01 the SDK reference page listed `getScriptVersion(nodeUrl, scriptName)` while the runnable walkthrough (invoke-contract) — the example that actually executes — calls `getContractVersion(getNodeUrl(), TENANT_SCRIPT)`, which is the symbol that works live on testnet. Re-fetched 2026-09-02: the reference page now lists `getContractVersion(nodeUrl, contractId)`, so the docs have converged on the walkthrough's name.
- **Area:** docs/SDK · **Severity:** low · **Status:** resolved (reference page updated by 2026-09-02; drift observed 2026-09-01) · **Environment:** Node v24.14.1, SDK 5.5.0.
- **Docs URLs:** https://docs.terminal3.io/developers/adk/reference ; https://docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract
- **Steps to reproduce (clean state):** `grep` both pages for the function name on 09-01: the reference page named `getScriptVersion`; the walkthrough named `getContractVersion`. A copy-pasted reference call failed to typecheck/run; the walkthrough call succeeded live.
- **Expected vs Actual:** expected one canonical name for "look up a contract's current version". Actual: two names; only the walkthrough's resolved.
- **Impact:** copy-paste from the reference page broke; naming ambiguity wastes debugging time.
- **Suggested fix:** keep one canonical name across all pages.
- **Workaround applied:** use the walkthrough symbol `getContractVersion` (as `host/src/grant.ts` does for `tee:user/contracts` and `tee:authorisations/contracts`).

### R13 — Host API table claims a per-contract `placeholder_allowlist`; vendored WIT + live behavior show only the hard `profile` namespace gate

- **Summary.** The Host API reference table's `http-with-placeholders` gating column reads: "Egress allowlist (shared with `http`) plus a per-contract `placeholder_allowlist` naming which profile fields may be substituted" — implying a configurable knob controlling which profile fields a contract may resolve. The vendored WIT (`host-interfaces-2.1.0/package.wit`, in this repo at `contract/wit/deps/`) says the opposite: "The host enforces only the hard `profile`-namespace gate — `{{secrets.<x>}}` and any namespace other than `profile` is rejected with `placeholder-denied`", with field-level access governed by the agent delegation grant. Live placeholder tests reached `placeholder-unknown`/missing-field errors with **no allowlist configured anywhere**, confirming the WIT/implementation text. The table describes a security control that does not exist.
- **Area:** docs · **Severity:** medium (misleading security documentation) · **Status:** confirmed (both sides in hand) · **Environment:** docs.terminal3.io + vendored WIT (this repo).
- **Docs URLs:** https://docs.terminal3.io/t3n/how-t3n-works/host-api ; vendored WIT: `contract/wit/deps/host-interfaces-2.1.0/package.wit` (comment block above `interface http-with-placeholders`, lines 46–62).
- **Steps to reproduce (clean state):**
  ```bash
  curl -s https://docs.terminal3.io/t3n/how-t3n-works/host-api.md | grep -o 'placeholder_allowlist[^.]*'
  grep -n -B3 -A5 'hard `profile`' contract/wit/deps/host-interfaces-2.1.0/package.wit
  ```
- **Expected vs Actual:** expected the table and the interface definition to describe the same gate. Actual: table names a per-contract field allowlist; the WIT and live behavior expose only the namespace gate + delegation grant.
- **Impact:** builders hunt for a non-existent allowlist to configure PII-field access, and may assume field-level control the platform does not offer (or a per-contract knob where none exists).
- **Suggested fix:** update the Host API gating column to match the WIT/implementation text (namespace gate + delegation-grant scoping).
- **Workaround applied:** marker strategy built only on the documented `profile` namespace; per-field access treated as delegation-grant-governed (see also R06/D1).

### R14 — Re-registration allocates a NEW `contract_id` (856 → 862) with no API to fetch the tail's current id → stale secrets-map ACLs

- **Summary.** Registering a new version at the same tail allocates a *fresh numeric* `contract_id` (observed 856 → 862 for z-mandate) rather than reusing the previous one, and no API returns the tail's *current* id. The existing `secrets` map's `readers`/`writers` ACLs stay pinned to the old id, so the freshly registered contract's in-enclave `kv-store` read fails with `AccessDenied` until the ACL is re-pointed. The docs' versioning note admits the new-id behavior but does not surface the stale-ACL consequence.
- **Area:** platform · **Severity:** medium (breaks any automated re-deploy path) · **Status:** workaround (verified live 2026-09-02) · **Environment:** Node v24.14.1, SDK 5.5.0, testnet.
- **Docs URL:** https://docs.terminal3.io/developers/adk/get-started/walkthrough/register-contract (versioning semantics: "registering a new `version` at the same tail allocates a new `contract_id` rather than replacing the old one").
- **Steps to reproduce (clean state):** register the contract (captures id 856) → create the `secrets` map with `readers/writers: { only: [856] }` → register again with a bumped version (returns id 862) → invoke a contract function that reads `z:<tid>:secrets` → KV read denied because the ACL still names 856.
- **Expected vs Actual:** expected the re-registered contract to read its secrets map. Actual: silent `AccessDenied` on the KV read; the map ACL is stale with no API to discover the new id.
- **Impact:** every re-deploy (version bump, hotfix) silently orphans the secrets-map ACL; the failure surfaces only at first KV read.
- **Suggested fix:** expose the tail's current `contract_id` (or allow name-based/stable ACLs); meanwhile document the re-point procedure on the register page.
- **Workaround applied:** `host/src/register.ts` `ensureSecretsMap` — on `map already exists`, re-points `readers`/`writers` to the new `contract_id` via `tenant.maps.update("secrets", { readers/writers: { only: [contractId] } })` → returns `"updated"` (verified live 2026-09-02); if the re-point fails it reports `"stale"` and the caller warns that the contract's KV read will fail. The contract record (`host/.contract-record.json`) is overwritten each register so `grant`/`run-demo` always use the tail's latest id.

---

## 3. Documented footguns (not bugs — verified behavior worth knowing)

1. **`tenant_did()` returns raw bytes — hex-encode before building `z:<tid>:` paths.** The WIT signature is `tenant-did: func() -> list<u8>` (20-byte raw CompactDid). Correct usage: `format!("z:{}:secrets", hex::encode(&tenant_did()))`. A missing **or** double hex-encode both produce a path that matches nothing — silently, since the map lookup simply returns no entry. Verified live: z-tenant-flight's hex-encoded secrets read works on testnet; docs and the vendored WIT warn identically.
2. **KV map `readers`/`writers` deny by default.** `maps.create` without an explicit `readers` set creates a map nobody — not even the owner's own contract — can read, with **no error** (only a `console.warn`); the reference page states "`readers`/`writers` default to deny — set explicitly" (re-verified 2026-09-02). Verified live: a map created with explicit `readers/writers: { only: [contractId] }` is readable by the contract; `MapAlreadyExists` on re-create is idempotent.
3. **KV maps are owner-tamperable — append-only integrity lives in the audit ledger, not the KV maps.** As the owning tenant you can always write/delete map entries directly through the authenticated control plane (`tenant.executeControl("map-entry-set", …)`) regardless of a `writers: { only: […] }` grant — a "contract-only" map is *not* tamper-proof against its own owner. The platform's append-only, Merkle-backed guarantee applies to the audit ledger (`logging::audit` + the SDK's typed `getAuditEvents()`), not to tenant KV. Disclosed precisely in `docs/ARCHITECTURE.md`; no overclaim in the submission.

---

## 4. How these were found

- **Live official walkthrough (2026-09-01)** — executed the full quickstart → write → build → register → invoke → test flow on testnet in order; every stuck point was logged verbatim as it happened (R01–R07), with each finding reproduced from a clean state before filing.
- **Live MANDATE registration + grant + egress probing (2026-09-02)** — registered the real z-mandate component (contract ids 856 → 862), probed egress under both delegation surfaces and both host spellings (R08, R09), and exercised the re-registration ACL path (R14 workaround).
- **Documentation cross-checks (2026-09-01/02)** — doc-drift claims (R10–R13) were verified by direct fetch of `llms.txt`, the raw `.md` variants, rendered pages, and local `grep` of the vendored WIT; both 404s re-confirmed by `curl` on 2026-09-02. Every verbatim quote in this report is reproduced from the fetched source or from the unedited `docs/buglog.md`.
- **Still open:** D1 — the `{{profile.iban}}` / `{{profile.swift_bic}}` / `{{profile.legal_name}}` profile-schema fields are unconfirmed on this cluster and `date_of_birth` is already absent live (R06); the MANDATE marker strategy stays provisional until the live pay run resolves it.

---

*Verification note: raw verbatim log preserved unedited at [`docs/buglog.md`](./buglog.md) (BUG-001…BUG-009 + pre-seeded candidates). All live reproductions ran 2026-09-01/02 against the T3N testnet cluster; doc fetches and curl checks re-run 2026-09-02. Severities and statuses reflect what was observed; nothing in this report is inferred or fabricated.*
