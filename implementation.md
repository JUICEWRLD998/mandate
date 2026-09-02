# MANDATE — Implementation Plan (v2, research-complete)

> Status: READY TO BUILD · Updated: 2026-09-01 (after 4-agent research fan-out)
> Project dir: `C:\Users\fadhm\Desktop\terminal3` · Bounty: Terminal 3 × Superteam
> Research base: 44 fetched doc pages + official `Terminal-3/z-tenant-flight` repo +
> npm `@terminal3/t3n-sdk@5.5.0` types + Superteam listing JSON. Every URL in Appendix E.

---

## 0. Goal

Build and submit **MANDATE**: an enterprise agent that onboards a customer (identity
verification) and executes their first payment — while the agent, the LLM, the developer,
and the application server never see the customer's raw identity, documents, or bank
details. Rust contract → WASM in an Intel TDX enclave; `{{profile.*}}` markers substituted
inside the enclave at the last instant; a TypeScript host acts as its own delegated DID
under a scoped, revocable grant.

This is a **devrel bounty** — the score comes from deeply-correct primitive usage,
exceptional documentation, honest bug reports, and early submission, not concept novelty.
**"Time to submit" is judging criterion #1 and 62 submissions already exist (Sep 1).**
Phases 0–1 are the critical path; submit 24h+ before the deadline.

---

## 1. Bounty package (exact, from Superteam listing JSON — fetched 2026-09-01)

| Field | Value |
|---|---|
| Listing | `https://superteam.fun/earn/listing/t3n-agent-build-challenge` |
| Title | "Try out new docs to build a trusted agent with T3N that we can distribute / host" |
| Reward | **290 USDC**: 1st **100** / 2nd **50** / 3rd **50** / 4th–6th **30** |
| Deadline | **2026-09-16 15:59:59 UTC** (= 16:59 WAT, 11:59 ET) — submit 24h+ early |
| Winners by | 2026-09-23 UTC |
| Region | Global; human-only submissions (`agentAccess: HUMAN_ONLY`) |
| Judge/POC | Ian Chong (devrel, `@iancrj`) — DM `t.me/wardumb` with your DID + "Superteam" for more test tokens |
| Signup | REQUIRED: SSO via `https://go.terminal3.io/adk-community` (this generates your DID + API key) |
| Submission | **A public Google Doc + public GitHub repo + screenshots + any bug faced** — that's the complete spec. NO demo video required, NO deployed URL required, NO X post required (bonus only). |

**Judging criteria (verbatim, in order):**
1. "Time to submit (earlier, faster and more efficient the better)" — **criterion #1**
2. "**VERY IMPORTANT** - Build quality with focus on **usefulness and ease to maintain**
   post challenge" — the top-weight criterion; someone must be able to run it after the
   bounty ends; sponsor wants to distribute/host the winner
3. "Documentation quality"
4. "Bug submission quality"
5. "Bonus : Sharing it on social media and tagging @terminal3io on X"

**Eligibility form (3 questions, all required):** email · your DID from the signup page ·
"Would you want to continue running this / pass it to us to run it?" — the answer should
be **"continue running it"** (they have a startup program + listing page for winners who do;
a handover note is also included in the submission).

**README-ready sponsor narrative:** "Docs are refreshed from the prev challenge. Now
looking for devs to build useful agents for enterprises on Terminal 3 that can be easily
maintained." Prior DoraHacks T3 ADK winner pattern: **payment infra for agents won 1st**
(Thia-Term, $1,000) — delegated-auth agents with TEE-secured payments/verification won.

---

## 2. Verified environment facts (2026-09-01, Windows 11 / git-bash)

| Item | State | Action |
|---|---|---|
| Node / npm | v24.14.1 / 11.17.0 (`C:\Program Files\nodejs`) | OK |
| pnpm / yarn | present | use npm |
| Rust | rustup installed, **NO default toolchain** | `rustup default stable` (Phase 0) |
| MSVC linker | **MISSING** — VS 2026 BuildTools (18) installed WITHOUT the VCTools (C++) workload; git-bash `link.exe` is coreutils, not MSVC's linker | native `cargo build`/`cargo test` need VCTools (install via VS Installer modify: add `Microsoft.VisualStudio.Workload.VCTools`); the wasm32-wasip2 contract build does NOT need it |
| WASM target | not installed | `rustup target add wasm32-wasip2` (Phase 1) |
| git | 2.50.1; `user.email` set, `user.name` **EMPTY** | `git config --global user.name "..."` (Phase 0) |
| SDK | `@terminal3/t3n-sdk` **5.5.0** (125 versions; needs node >=18; `type: module`) | pin exact |
| Docs | `docs.terminal3.io` live; index at `https://docs.terminal3.io/llms.txt` (fetch `.md` variants via curl for full text) | — |
| Terminal 3 note | `docs.terminal3.com` is a DIFFERENT site (game SDK) — never cite it | — |

---

## 3. Architecture (research-corrected)

```
Tenant (enterprise) ── T3N API key, DID did:t3n:<40hex> ── registers contract,
creates z:<tid>:secrets map (readers/writers = {only:[contractId]}), seeds rail key
via tenant.executeControl("map-entry-set", …)   [control plane, owner overrides ACLs]

TEE enclave (Intel TDX · Wasmtime sandbox) ── Rust contract → WASM component
  world.wit imports = ENTIRE capability set (no manifest):
    host:tenant/tenant-context@1.0.0 · host:interfaces/logging@2.1.0 ·
    host:interfaces/kv-store@2.1.0 · host:interfaces/http-with-placeholders@2.1.0
  exports contracts interface (one func per operation, generic-input envelope):
    onboard-customer(req) → POST {RAIL}/kyc   ({{profile.*}} markers)
    pay-invoice(req)      → POST {RAIL}/pay   ({{profile.iban}}, {{profile.swift_bic}})
  PII never enters WASM: markers resolve host-side inside the enclave "just before
  the request goes out". Egress host must be on the CALLING USER's grant, else:
  host/http.egress_denied: host '<host>' is not in the authorised_hosts allowlist

Agent host (TS, @terminal3/t3n-sdk) ── SEPARATE AGENT_KEY / own DID / own credits
  handshake() → authenticate(createEthAuthInput(addr)) → did.value
  orchestrates: grant → onboard → pay → audit (getAuditEvents)

Data owner (customer) ── verified identity in T3N profile; signs agent-auth-update
  grant {agentDid, scripts:[{scriptName: z:<tid>:mandate-contracts, versionReq,
  functions:["onboard-customer","pay-invoice"], allowedHosts:["localhost:8787"]}]}
  Revoke = stop re-issuing (or empty agents array) → next egress denied.

Mock money rail (Express ~80 lines, :8787) ── logs EXACT payload received (the
  on-screen proof of substitution) · returns scrubbed responses + iban_sha256 proof
```

**Data flow (happy path):** agent auth → `pay-invoice` with markers only → enclave
decrypts request + user profile (AES-256-GCM, cluster CEK) → resolves markers → egress
allowlist check vs grant → rail receives REAL data → scrubbed response → enclave returns
sanitized result → host writes audit row (audit events are append-only; host stamps
subject/actor/vc_id — contract cannot forge).

**Key correction vs the original brief:** there is **no "arm" verb** on T3N. The contract
becomes callable-with-egress only when the data owner signs the grant. The brief's claim
that the append-only audit primitive is "not yet exposed" is **wrong** — `logging::audit`
(in-enclave) + `audit.get-mine` (`client.getAuditEvents()`, typed in 5.5.0) exist and are
append-only, encrypted, host-stamped. Only tenant KV maps remain owner-tamperable (real
caveat, use as a precise finding in the bug report).

---

## 4. Primitives reference (the "no vital detail missed" core)

### 4.1 Contract authoring
- `wit/world.wit`: `package z:mandate@0.1.0;` + `world mandate { import …; export contracts; }`
- Exported interface (mirror official `contracts`): `record generic-input { input, user-profile, context: option<list<u8>> }`; each fn `func(req: generic-input) -> result<list<u8>, string>`.
- **No `dispatch` function, no `ContractError` enum — the function name IS the export.**
- Rust: `wit_bindgen::generate!({ world: "mandate", path: "wit", additional_derives: [serde::Deserialize, serde::Serialize], generate_all })`; `#[cfg(target_arch = "wasm32")] impl exports::z::mandate::contracts::Guest for Component`; `#[cfg(target_arch = "wasm32")] export!(Component);`
- `Cargo.toml`: `crate-type = ["cdylib", "lib"]` (cdylib = WASM *component*; lib = native unit tests), edition 2021, `wit-bindgen 0.49` (features `["macros","realloc"]`), serde/serde_json/hex with `default-features = false` + `alloc`; release: `opt-level="s" lto=true codegen-units=1 strip=true` (keeps registration under the size cap).
- **Vendor `wit/deps/` pinned to `host-interfaces-2.1.0` + `host-tenant-1.0.0`** (same pins the host links; canonical source is 2.2.0 — deliberate pin).
- `.cargo/config.toml`: `[build] target = "wasm32-wasip2"`.
- Kebab→snake: WIT `http-with-placeholders` → `crate::host::interfaces::http_with_placeholders`.

### 4.2 Placeholders (http-with-placeholders)
- Syntax `{{profile.<field>}}` incl. dot-paths (`{{profile.verified_contacts.email.value}}`). Marker is a literal string in body/headers; host resolves inside enclave before egress; **plaintext never enters WASM**.
- Hard namespace gate: only `profile` (no `{{secrets.*}}`) → `placeholder-denied` for other namespaces / malformed markers.
- **DOCUMENTED profile fields:** `first_name`, `last_name`, `date_of_birth`, `gender`, `verified_contacts.email.value`. **`{{profile.iban}}` / `{{profile.swift_bic}}` / `{{profile.legal_name}}` are NOT in the docs' list** — docs: "Fields the schema doesn't carry yet (passport, title) are supplied by your contract directly." The SDK's `UserInputProfile` has `[key: string]: unknown` (custom fields storable via user-upsert) but resolvability depends on the cluster's profile contract schema. **→ Phase 1 MUST verify marker strategy (see Phase 1, decision D1).**
- Error strings (contract-facing): `egress denied for host {host}` · `placeholder not permitted: {marker}` · `user profile missing field: {field}` · `no user context bound for placeholder resolution` · `upstream: {reason}`. Platform full string: `host/http.egress_denied: host '<host>' is not in the authorised_hosts allowlist`.
- `placeholder-no-user-context` when no `pii_did` bound (admin/bootstrap). Calls are synchronous (no deferred queue).

### 4.3 KV / secrets / z-namespace
- Canonical name `z:<tid>:<tail>`; `<tid>` = 40-hex suffix of `did:t3n:<tid>`; **never pass `z:` prefix to SDK — local tail only** (else `canonical map name invalid`).
- Hardware-level rule: contract can only touch maps prefixed with its own `<tid>` (enforced inside TDX at every transaction).
- Map creation: `tenant.maps.create({ tail: "secrets", visibility: "private", writers: { only: [contractId] }, readers: { only: [contractId] } })` — **`readers` MUST be explicit (KV governor defaults to DENY; omitting it makes your own contract's read fail `AccessDenied`).**
- Seed: `tenant.executeControl("map-entry-set", { map_name: tenant.canonicalName("secrets"), key: "rail_api_key", value: process.env.RAIL_API_KEY! })` — control plane, bypasses ACL, "the only path to the key is through your contract code."
- Contract read: `kv_store::get(&format!("z:{}:secrets", hex::encode(&tenant_context::tenant_did())), b"rail_api_key")` — **`tenant_did()` returns raw bytes; hex-encode or the path matches nothing** (missing OR double hex-encode both fail).
- `kv-store` WIT: `get(map,key)->option`, `put`, `delete->bool`, `set-claims-digest` (exactly 32 bytes SHA-256), `scan(map,start,end,limit)` — limit 0 rejected, one-shot no cursor.
- Writes are atomic with the call; owner (tenant) can always write via control plane → "contract-only" map is NOT tamper-proof against its owner (state this honestly).
- WIT method names: `kv_store::get(&map_name, key)` etc.; imports: `use crate::host::interfaces::{kv_store, logging, http_with_placeholders as hwp}; use crate::host::tenant::tenant_context;`

### 4.4 Grants / delegation / egress
- Grant write (documented walkthrough shape, signed by the **user/data owner**):
  `userClient.execute({ contract_id: "tee:user/contracts", contract_version: <from getContractVersion(getNodeUrl(), "tee:user/contracts")>, function_name: "agent-auth-update", input: { agents: [{ agentDid, scripts: [{ scriptName: TENANT_SCRIPT, versionReq: scriptVersion, functions: ["onboard-customer","pay-invoice"], allowedHosts: ["localhost:8787"] }] }] } })`
- **Three-way scoping:** contract × functions × hosts. Absent `allowedHosts` = deny-all egress. Grant = "armed" state. `functions`/`allowed_hosts` always emitted by the wire serializer.
- Denial: contract still runs; only the outbound call fails with `host/http.egress_denied`. Docs' #1 warning: "the code is fine, but no grant authorizes the host. Set the grant before you invoke."
- Revocation: empty `agents` array / empty grants doc / `revokeMemberDelegationForOrg` / dashboard Remove — key unchanged, access gone.
- **Modern surface (SDK 5.5.0):** `agent-auth-*` is in a deprecation window; `member-delegation-*` is current: `getMemberDelegation()`, `updateMemberDelegation(grant, opts)`, `memberDelegationUpdate(doc)` (full-doc write; empty grants = revoke all), `checkDelegation({contract, pii_did, functions, scopes})` (pre-flight, anti-enumerative), all on `tee:authorisations/contracts`, SelfOnly. **Decision D2 (Phase 3):** demo uses the documented `agent-auth-update` (docs = scoring surface), README notes `member-delegation` as the modern equivalent; if agent-auth-update misbehaves on testnet, switch to `updateMemberDelegation` with flat `BoundGrant { grantee, contract_id, functions, allowed_hosts, version_req }`.
- Dashboard no-code path: testnet.network.terminal3.io → AI Agents tab (defaults to ALL functions/hosts if unspecified).

### 4.5 Identity / sessions
- All sessions identical: `new T3nClient({ trustAnchor: await fetchTrustedManifest("testnet"), wasmComponent, handlers: { EthSign: metamask_sign(address, undefined, key) } })` → `handshake()` → `authenticate(createEthAuthInput(address))` → `did.value`.
- `setEnvironment("testnet")` **always explicitly** (docs contradict themselves on the default). `TenantClient` needs `baseUrl: getNodeUrl()` (T3nClient doesn't).
- **Three keys, three DIDs:** tenant `T3N_API_KEY`, agent `AGENT_KEY` (its own claim-page key + own credits — balance starts at zero; reuse of tenant key → `InsufficientCreditError`), user `USER_KEY` (data-owner stand-in).
- Never hardcode/derive DIDs — read from session. Claim page (https://www.terminal3.io/claim-page) shows each key once.
- Org-owned agent path (if wanted): `t3n agent create` → key `t3n_key_<id>.<secret>` minted in TEE, printed once, unrecoverable; stateless `POST /api/invoke` with `X-T3N-Api-Key`. Public self-registered path (t3n CLI: whoami / create-card / host-card, card < 16 KiB) is the simpler demo route.

### 4.6 Error envelope & audit
- Errors: JSON-RPC `bad_request` HTTP 400 `{ code, detail, request_id }`; SDK throws `detail` string — **match on substrings** (table in Appendix A).
- HTTP 500 triage: grab `request_id` → re-check egress + map ACLs (missing grant/ACL can surface as 500) → retry once (unhealthy node) → report with `request_id` if persistent.
- Audit: `logging::audit` in-enclave; host reads via `client.getAuditEvents({ pii_did?, limit?, cursor? })` → `AuditPage { batches: AuditBatch { key, committed, events }[], next_cursor? }`; `AuditEvent { ts_ms, subject, actor, vc_id, action, target, outcome, details? }` — on delegated calls actor = agent, vc_id = delegation credential; events permanent, encrypted, append-only. Activity log (org-scoped): `getActivityLog` — DIDs only, `seq_no` is the ordering key.

---

## 5. Implementation phases

Phases 0–1 first ("time to submit" is criterion #1; the quickstart bug log is a scored
artifact). Hard scope gate: ONE rail, TWO contract functions, ONE grant, ONE flow. Mock
rail only — never attempt a live rail/KYC provider.

### Phase 0 — Environment & repo scaffold (≈30 min, do TODAY)
- [ ] `rustup default stable` (downloads toolchain) → verify `cargo --version`.
- [ ] `git config --global user.name "..."` (currently empty).
- [ ] `git init` in `C:\Users\fadhm\Desktop\terminal3`; `.gitignore` (node_modules/, target/, *.log, .env, *.local); initial commit.
- [ ] Repo layout per Appendix C (contract/ + host/ + mock-rail/ + scripts/ + docs/ + tests/).
- [ ] README stub (one-liner + architecture sketch).
- Verify: `cargo --version`, `git log --oneline`, `npm --version`.

### Phase 1 — Signup, quickstart + full walkthrough on testnet, bug log (scored artifact #1)
> **STATUS: COMPLETE 2026-09-01.** Walkthrough executed live (register id 856, self-grant + true-delegation variants, Duffel 401 + placeholder-unknown reached). 7 findings confirmed in docs/buglog.md (BUG-001..007): trust-manifest rtmr1_allowlist mismatch (BUG-002), claim-page keys collapsing to one DID (BUG-003), zero-credit agent gating (BUG-004), external Duffel token prereq (BUG-005), empty-profile placeholder gap (BUG-006), SDK stdout dumps (BUG-007). BUG-002 workaround `trustAnchor:{unsafe_trust_server:true}` is carried into all host code. D1: PARTIAL — first/last_name resolve; date_of_birth does NOT; iban/swift/legal_name unconfirmed → marker strategy must verify profile fields in Phase 2/3.
**Exact order (from the docs; known stuck points inline):**
1. [ ] SSO signup: `https://go.terminal3.io/adk-community` → claim page → copy `T3N_API_KEY` **now (shown once)**. NOTE THE DID.
2. [ ] Quickstart: `mkdir my-t3n-app && cd my-t3n-app && npm init -y && npm pkg set type=module && npm install @terminal3/t3n-sdk tsx && export T3N_API_KEY=...` → write `quickstart.ts` (exact code: Appendix A §A.1) → `npx tsx quickstart.ts` → expect `Connected as: did:t3n:...`.
   - Stuck points (documented): "Top-level await… cjs" → missing `type:module`; `Invalid Ethereum private key` → key not exported; WASM load errors → run plain Node (no bundler); `ReferenceError: tenant is not defined` → append every snippet to the SAME file.
3. [ ] Dev env: `rustup target add wasm32-wasip2`; `cargo install wasm-tools` (optional; ~2 min silent — normal). Append `TenantClient` with `baseUrl: getNodeUrl()` + `await tenant.tenant.me()` → `TenantClient ready.`
4. [ ] Walkthrough contract: clone `Terminal-3/z-tenant-flight` (sibling folder, NOT nested), `cargo build --target wasm32-wasip2 --release`, verify with `wasm-tools component wit`.
5. [ ] Register: `tenant.contracts.register({ tail: "travel-contracts", version: "0.1.0", wasm })` → note `contract_id` (numeric, needed for map ACLs). Create `secrets` map with explicit readers/writers. Seed `map-entry-set`.
6. [ ] Invoke: agent session (own claim-page AGENT_KEY), user session, user signs `agent-auth-update` (allowedHosts: api.duffel.com… or the walkthrough host), agent `executeAndDecode`. Confirm happy path + **the denied path** (host not in grant → `host/http.egress_denied`).
7. [ ] Test: `cargo test` (native, host fns are wasm32-only).

**Decision D1 — marker strategy (do this in Phase 1, blocks Phase 2):**
- [ ] Determine the live cluster's profile schema: can `{{profile.iban}}`, `{{profile.swift_bic}}`, `{{profile.legal_name}}` resolve? Try (a) direct markers; if unresolved try (b) `user-upsert` with custom fields (`[key:string]:unknown` open schema) then reference; if neither, (c) **documented fallback**: demo-hardcodes values exactly as z-tenant-flight hardcodes `passport_number` (loses some magic moment; note trade-off in README) — or restructure markers to documented fields (`{{profile.first_name}}` etc. as legal name parts) + hardcoded IBAN only in the rail-facing body built from a KV value. Record the outcome + exact error strings in the bug log.

**Deliverable:** `docs/buglog.md` — every stuck point verbatim (command, error, env, unblock). This is raw material for the Phase 7 bug report. Verify: all steps green; buglog entries each reproducible.

### Phase 2 — Rust TEE contract (`contract/`)
> **STATUS: COMPLETE 2026-09-02** (branch phase-2/contract, 2-agent fan-out: kyc.rs | pay.rs).
> World `z:mandate@0.1.0` imports ONLY tenant-context@1.0.0 + logging/kv-store/http-with-placeholders@2.1.0 (vendored wit/deps, pinned — canonical is 2.2.0); export `contracts` {onboard-customer, pay-invoice}. Build verified: `cargo test --target x86_64-pc-windows-gnu --lib` = 21/21 green (10 kyc + 9 pay + 2 lib); `cargo build --release` (target wasm32-wasip2 via .cargo/config.toml) → `z_mandate.wasm` 171,304 B.
> PII design (each fn): request structs PII-free + `#[serde(deny_unknown_fields)]` → inline PII rejected at parse (`bad input: unknown field …` — REAL hygiene; the z-tenant-flight test is aspirational); outbound bodies markers-only via `crate::MARKER_*` consts; verdicts scrubbed (kyc_id/status/risk_score? · payment_id/status/iban_sha256); raw rail body NEVER in errors/logs (deliberate deviation from Duffel reference — a rail could echo resolved PII; HTTP code only); logs carry only operational ids; 65,536-B in/out guards.
> **D1 sequencing note:** profile-field verification (legal_name/iban/swift_bic/date_of_birth resolution) is IMPOSSIBLE before a contract emitting those markers is registered — that is Phase 3/5 territory (register → grant → invoke). Marker consts in lib.rs are the single swap point per the D1 decision tree (direct → user-upsert → demo-hardcoded per z-tenant-flight passport precedent). First live registration must probe each marker and record exact error strings in buglog.
- [x] Scaffold crate per Appendix C; `wit/world.wit` importing ONLY: `host:tenant/tenant-context@1.0.0`, `host:interfaces/logging@2.1.0`, `host:interfaces/kv-store@2.1.0`, `host:interfaces/http-with-placeholders@2.1.0`; export `contracts` with `onboard-customer` + `pay-invoice` (generic-input envelope).
- [x] `src/lib.rs`: wit-bindgen generate + Guest impl dispatching per-fn (no central dispatch).
- [x] `src/kyc.rs` (`onboard-customer`): parse `{customer_id}`; read `rail_api_key` from `z:<tid>:secrets` (hex-encode tenant_did); build body with markers (`legal_name`, `date_of_birth` per D1); `hwp::call` POST `{RAIL_BASE}/kyc`; map `HttpError` via `format_http_error` (verbatim from z-tenant-flight); parse only `kyc_id/status/risk_score`; never forward raw body; log failures in-enclave, return sanitized strings.
- [x] `src/pay.rs` (`pay-invoice`): build `{beneficiary:{legal_name, iban, swift}, amount, currency, reference}` with `{{profile.*}}` markers (per D1); POST `{RAIL_BASE}/pay`; parse `payment_id/status/iban_sha256`; **never** resolve or log markers.
- [x] Input hygiene: reject any payload carrying PII at parse via `deny_unknown_fields` (error contains `"bad input"` — 4 tests prove it). Cap input size (65,536; serde_json OOMs in WASM).
- [x] No duplicate Content-Type header (host sets it via `.json()` — rail_headers sends Authorization only).
- [x] Tests: `cargo test --lib` — marker rendering, input guards, verdict mapping, PII-hygiene checklist from walkthrough page 5 (PII never in return values or log lines).
- [x] Build: `cargo build --release` (config targets wasm32-wasip2) → `contract/target/wasm32-wasip2/release/z_mandate.wasm` (171,304 B).
- Verify: build clean, tests pass, `wasm-tools component wit` lists imports + `export contracts`.

### Phase 3 — TypeScript agent host (`host/`)
> **STATUS: COMPLETE 2026-09-02** (branch phase-3/host, 3-agent fan-out: register.ts | grant.ts | run-demo.ts). Verified: `npx tsc --noEmit` clean (strict, NodeNext, noUnusedLocals) + `npx vitest run` = 38/38 green (11 register + 12 grant + 15 run-demo). Deps pinned: `@terminal3/t3n-sdk@5.5.0` exact, tsx ^4.23.13, vitest ^4.1.11, typescript 5.9.3, @types/node 24.
> Design: all modules import-side-effect-free (pathToFileURL main-gating, connect.ts pattern); pure builders tested with structural mocks — NO live keys/network in tests. `connect.ts` = three independent sessions (BUG-002 `unsafe_trust_server` workaround); `lib/records.ts` `.contract-record.json` is the single source of truth for the canonical z: name + contract_id between register → grant → run-demo (re-registration allocates NEW ids — record is overwritten each register). register.ts guards the wasm magic bytes; secrets map readers/writers explicit `{only:[contract_id]}` (KV governor denies by default) + re-registration ACL caveat warned; `rail_api_key` seeded via control-plane map-entry-set. grant.ts signs the DOCUMENTED `agent-auth-update` on `tee:user/contracts` (D2: legacy = scoring surface), revoke = empty agents array; **show() verified against SDK 5.5.0 types: zero-arg `getMemberDelegation()` EXISTS (index.d.ts) and is optional-chained with a graceful note fallback**. run-demo.ts: agent call payloads PII-free by construction (test-asserted), PAY_BODY_TEMPLATE mirrors contract/src/pay.rs (markers only — never plaintext), audit pane compact-only (never raw page), agent-output.log carries ids/amounts/markers only (BEAT 5 grep discipline).
- [x] `package.json` (`type: module`), pin `@terminal3/t3n-sdk@5.5.0` + `tsx`; `.env.example` (T3N_API_KEY, AGENT_KEY, USER_KEY, RAIL_URL, CONTRACT_TAIL, RAIL_API_KEY).
- [x] `src/connect.ts`: three sessions (tenant/agent/user) — handshake → authenticate → DIDs from `did.value`.
- [x] `src/register.ts`: read wasm → `tenant.contracts.register({ tail: "mandate-contracts", version: "0.1.0", wasm })` → print + SAVE contract_id (.contract-record.json; re-registration allocates a NEW id; keep records); `tenant.maps.create` secrets (explicit readers/writers = contractId); `map-entry-set` rail_api_key.
- [x] `src/grant.ts`: `grant` (agent-auth-update per §4.4; functions + allowedHosts) · `revoke` (empty agents) · `show` (read back via `getMemberDelegation()` — verified typed zero-arg on 5.5.0).
- [x] `src/run-demo.ts`: orchestrate `onboard-customer` → `pay-invoice` → print AGENT view (markers literal) → audit pane via `getAuditEvents()` (delegated call → actor = agent, vc_id = grant).
- [x] `src/lib/rail-client.ts` (thin fetch /health wrapper), `src/lib/logger.ts` (writes `agent-output.log`).
- [x] Tests (vitest): orchestration with rail mocked; grant/revoke error paths (`egress_denied` surfaces; `InsufficientCreditError` if agent key wrong).
- Verify: full flow runs; audit events readable; revoked call fails with `egress denied`. — **DEFERRED to Phase 5**: live run needs real keys + credits + the Phase 4 rail up (egress target); the D1 marker probe also lands at the first live register→grant→invoke (Phase 5 demo). Phase 3 gate = tsc + vitest + structural correctness vs the phase-1-proven walkthrough shapes.

### Phase 4 — Mock money rail (`mock-rail/`, Express ~80 lines)
> **STATUS: COMPLETE 2026-09-02** (branch phase-4/rail, 2-agent fan-out: app.ts | server.ts). Verified: `npx tsc --noEmit` clean + `npx vitest run` = 12/12 (8 app + 4 server) + **live curl smoke test** — booted `npx tsx src/server.ts`, hit all three endpoints: /health `{ok:true}`; /kyc returned scrubbed `{kyc_id,status:'verified',risk_score:12,checks:[...]}` (no PII echo) while rail.log recorded the FULL resolved payload incl. `legal_name:"Ada Bank"` + Authorization `Bearer rail_demo_key_1234`; /pay returned `{payment_id,status:'settled',trace:'T3N-MANDATE-DEMO',iban_sha256}` and the digest MATCHED a locally computed `sha256('GB29 NWBK 6016 1331 9268 19')` — proof-of-receipt verified end-to-end.
> Design: `createRailApp(logger)` factory (testable; server.ts injects the real `createRailLogger()`); responses NEVER reflect PII (scrubbed by construction, test-asserted); rail.log (mock-rail/rail.log, gitignored) is the DELIBERATE inversion of the host's logging rules — it records exact received payloads incl. resolved marker values (the counterparty legitimately holds the data; that is the demo's magic-moment proof). sha256 hashes the EXACT received iban string (no normalization — demo re-hashes the rail.log-extracted string and must match). Validation: missing fields → 400 `missing field: <field>`; IBAN sanity `/^[A-Z0-9 ]{15,34}$/i` → 400 `invalid iban`; non-JSON body → 400 `json body required`. Port 8787 default via `RAIL_PORT` (server.ts also returns the real port when 0 requested). No auth enforcement (demo), but the Authorization header the contract sends from KV is captured into rail.log.
- [x] `POST /kyc` → `logReceived` (console + `rail.log`), respond `{ kyc_id, status:"verified", risk_score, checks:["identity","sanctions"] }` (scrubbed, no PII echo).
- [x] `POST /pay` → `logReceived`, respond `{ payment_id, status:"settled", trace:"T3N-MANDATE-DEMO", iban_sha256: sha256(req.body.iban) }` (deterministic proof-of-receipt: compare with locally-computed hash — verified live).
- [x] `GET /health` → `{ ok: true }` (demo ready-signal). Port 8787 via `RAIL_PORT`. No auth in demo, but contract still sends `Authorization: Bearer <rail_api_key from KV>` — exercises the sealed-key story for real (header captured in rail.log).
- [x] Tests (supertest/vitest): payload logging, scrubbed response, 4xx on missing fields.
- Verify: curl the endpoints; log shows real values when called through the enclave. — **curl-verified live on the branch (see status block); the ENCLAVE path (contract → rail.log with substituted values) is verified in Phase 5 E2E.**

### Phase 5 — Integration E2E + revocation demo (deterministic, no live third parties)
> **STATUS: SCRIPTS COMPLETE 2026-09-02** (branch phase-5/demo, 2-agent fan-out: e2e-asserts.sh | demo.sh). Committed: `tests/e2e-asserts.sh` (assertion library encoding the trust claims — 30-case self-verifying harness green: contains/not/last-line/line-count/json-field-extract/sha256-match/repo-invariant), `scripts/demo.sh` (Beats 0-5 runner: repo-clean preflight → KYC → magic-moment pay w/ rail.log-growth + sha256 proof → revoke → egress-denied with rail.log line-count unchanged → after-proof; SCREENSHOT FRAME hints per beat). Verified: `bash -n` clean both; harness 30/30; `DEMO_DRY=1 bash scripts/demo.sh` exit 0 — pure trace, no network/CLI/.env touched; repo-root plaintext invariant PASSES live. Design: demo.sh holds NO IBAN literal — it extracts the real IBAN from rail.log and digest-compares against the agent's iban_sha256 (validates the round-trip AND keeps scripts/ clean); dry-run mode makes the runner verifiable without testnet. Invariant policy: fake fixture PII allowed in tests//fixtures/ + #[cfg(test)] mods + **markdown docs (illustration)** — never in executable source; the one source-comment occurrence (rail-log.ts) was scrubbed. run-demo.ts gained kyc|pay|all modes + runKyc/runPay single-step exports (41/41 host tests) so Beats 1 & 4 drive single steps.
> **LIVE RUN PENDING (needs user)**: `bash scripts/demo.sh` on testnet requires host/.env (T3N_API_KEY/AGENT_KEY/USER_KEY — working keys exist in Desktop/t3n-walkthrough/my-t3n-app/.env), credits, `npm run register` + `npm run grant` first, and the rail up (mock-rail `npm start`). That run closes **D1** (first live register→grant→invoke probes whether legal_name/iban/swift/date_of_birth markers resolve) and produces the submission screenshots. NOT executable by subagents (real keys + credit burn) — orchestrator + user, post-merge.
- [x] `scripts/demo.sh` implementing **Beats 0–5** (Appendix B): preflight → KYC → PAY (magic moment) → revoke → denied → after-proof. Assertions: rail.log contains the REAL IBAN; agent-output.log contains `{{profile.iban}}` and NOT the IBAN; after revoke, agent-output.log/console contains `egress denied` and rail.log line count unchanged; repo grep for plaintext IBAN returns nothing (tests/fixtures/docs exempt by documented policy).
- [~] Failure paths scripted: no grant (egress_denied) — **BEAT 4 in demo.sh**; wrong host / unpermitted marker (`placeholder not permitted`) — deferred (if-time-allows; covered conceptually by BUG-002/006 buglog entries + D1 probe).
- [~] Screenshots for the submission: contract source (markers only), rail log (real values) side-by-side with agent log (markers only), audit pane, revocation frame — **SCREENSHOT FRAME hints emitted per beat; actual captures during the live run**.
- Verify: `./scripts/demo.sh` runs green twice in a row (deterministic). — **Pending live testnet run (see above); dry-run + harness + invariant verified on the branch.**

### Phase 6 — Docs: README, ARCHITECTURE.md, Google Doc
> **STATUS: COMPLETE 2026-09-02** (branch phase-6/docs, 3-agent fan-out: README.md | ARCHITECTURE.md | SUBMISSION.md + orchestrator consistency pass + buglog BUG-008/009 filed).
> README.md rewritten submission-grade (~237 lines): pitch → why (breach framing) → how-it-works (mermaid + ASCII + who-never-sees-what) → safety rails (property/enforcement/proof table) → layout → run-it-yourself (5 verified commands incl. DEMO_DRY) → testing table (21/46/12/30 + typechecks) → demo beats + magic moment → **how-this-is-scored table** (5 criteria → evidence) → troubleshooting (10 real-error rows) → 7 honest deviations → MIT + sponsor handover. docs/ARCHITECTURE.md (455 lines): mermaid system + 2 sequence diagrams, actor trust table, contract internals, privacy data-flow table (what-every-viewer-sees), D2 delegation mechanics, genuine-protections vs honest-limits, test-to-claim map (16 rows). docs/SUBMISSION.md (195 lines, Google-Doc source): title/eligibility block → problem → insight → one-paragraph → architecture → demo beats with LIVE-vS-PENDING honesty block → scoring map → run-it-yourself → bug summary (9 findings) → handover & maintenance (markers/versions/env-contract/config-swap rail) → MIT. Buglog updated: BUG-008 (legacy agent-auth-update no longer arms egress — D2) + BUG-009 (egress host matching strips port) filed; candidate 9 (re-registration new id) marked VERIFIED+WORKAROUNDED (maps.update re-point, 856→862).
> Cross-doc consistency pass (orchestrator): every command/error/id grepped across all three docs; caught + fixed: SUBMISSION `npm run grant` → `npm run grant -- grant`; `cargo test --lib` → `--target x86_64-pc-windows-gnu --lib`; bug counts 7→9 everywhere; README InsufficientCredit row updated for the metered modern grant surface. No fabricated receipts anywhere — pending live evidence is explicitly labeled.
- [x] `README.md` per Appendix D outline (self-contained, criteria-mapped — judges run repos through AI graders): problem → insight → architecture → safety rails → **how-this-is-scored table** → run-it-yourself (5 commands) → troubleshooting → known deviations (single-repo, profile-schema caveat, SDK naming drift, testnet only) → license (MIT) + handover note.
- [x] `docs/ARCHITECTURE.md` (diagram: Agent → z:<tid>:mandate-contracts (TDX) → mock rail; three sessions; KV secrets; grant; scrubbed responses; iban_sha256).
- [x] `docs/SUBMISSION.md` = Google Doc source (problem → insight → architecture → demo → scoring map → run-it-yourself → handover). Create the public Google Doc from it. — **creation steps handed to the user; fill <YOUR-EMAIL>/<YOUR-DID>, paste, restyle headings, set Anyone-with-link → Viewer.**
- Verify: stranger can clone + run on testnet from README alone. — **commands verified by the agents + orchestrator against the live repo; full stranger-run pending the final live testnet run (credits) + screenshot captures, which also update SUBMISSION §5 frames.**

### Phase 7 — Bug report artifact (scored criterion — first-class deliverable)
- [ ] Formalize `docs/buglog.md` into submission-grade reports: per bug — summary, steps to reproduce, expected vs actual, environment (OS / SDK 5.5.0 / docs URL), severity, suggested fix. Every entry reproduces from a clean state.
- **Known ammo (from research — verify each live before claiming):**
  1. Docs 404s: `/api-reference/openapi.json` and `/terminal-3-openapi.yml` are linked from `llms.txt` + reference page ("21 paths, 24 operations, OpenAPI 3.0.3") but return 404.
  2. `setEnvironment` default contradiction: Quickstart says defaults to testnet; reference table says defaults to production.
  3. SDK naming drift: reference lists `getScriptVersion(nodeUrl, scriptName)`; the walkthrough (runnable example) uses `getContractVersion(nodeUrl, TENANT_SCRIPT)`.
  4. Stale manifest docs: `z-tenant-flight` README/lib.rs shows a `host_capabilities` JSON manifest; docs explicitly say there is no manifest (WIT imports only).
  5. Host API table vs WIT: `http-with-placeholders` gating column mentions a per-contract `placeholder_allowlist`; vendored WIT says the only gate is the hard `profile` namespace + delegation. WIT text is more precise — verify on testnet.
  6. `getAuditEvents()`: docs mark "reported to exist but undocumented"; it IS a typed 5.5.0 method.
  7. `tenant_did()` raw-bytes gotcha: docs warn of missing OR double hex-encode → path matches nothing.
  8. `readers` ACL deny-by-default gotcha (map created but deny-all with no error, only a console.warn).
  9. Re-registration allocates a NEW contract_id with no API to fetch the tail's current id → stale map ACLs (docs admit the gap).
  10. `{{profile.iban}}`-style fields not in the documented profile schema (if D1 confirms) — top follow-on primitive: a payment/account profile section.
- **Honest caveat to include:** tenant KV maps are not tamper-proof against their own owner; the append-only guarantee lives in the audit ledger, not the KV maps.

### Phase 8 — Submission
- [ ] X post tagging @terminal3io (bonus criterion) with the magic-moment screenshot.
- [ ] Public GitHub repo (name/description optimized for the listing); verify public links.
- [ ] Superteam submission: Google Doc link + repo link + screenshots + bug reports + the eligibility answers (DID; **continue running** via their startup program + handover note included).
- Verify: submission page shows all fields; links open unauthenticated.

### Phase 9 — Hardening (pre-submission, from hackathon-strategy skill)
- [ ] Full clean-clone testnet run — not just green typecheck/lint: contract suite, host tests, rail tests, live E2E.
- [ ] Real receipts in the doc: deployed contract address/id, registration tx info, audit rows.
- [ ] No fake claims (AI graders cross-check the repo); every quoted error string real.
- [ ] `requesting-code-review`: pre-commit security scan — no secrets, .env handling, fake-but-plausible fixtures only, no real IBANs/keys in git history.

---

## 6. Test plan
- `contract/`: `cargo test --lib` + `cargo clippy --all-targets -- -D warnings` — marker rendering, input hygiene (PII rejected), verdict mapping, PII-never-in-output checklist (walkthrough page 5).
- `host/`: vitest — orchestration state machine (rail mocked), grant/revoke error paths.
- `mock-rail/`: supertest — payload logging, scrubbed responses, validation 4xx.
- E2E (scripted, deterministic): Beats 0–5 + 3 failure paths (no grant / wrong host / bad marker) + revocation.
- Preflight: every demo control executed live on testnet before submission; failures explained, not silent.

## 7. Skills to use during the build
| Skill | Where |
|---|---|
| `terminal3-adk` (**created 2026-09-01**) | Load before ANY T3N work — distilled docs facts, exact errors, version pins, gotchas |
| `hackathon-strategy` | Phase 6/9: README as AI-judge artifact, criteria mapping, pre-submission hardening |
| `github-repo-management` | Phase 0/8: repo setup, remotes, public submission hygiene |
| `test-driven-development` | Phases 2–4: tests before code |
| `systematic-debugging` | Phases 1/5: 4-phase root cause on stuck points |
| `requesting-code-review` | Phase 9: pre-commit security scan, secret/PII hygiene |
| `plan` | Phase 6: doc structure discipline |
| `dogfood` | Only if a web dashboard gets built (if-time-allows) |
| Subagent fan-out (user preference) | Large disjoint work (contract vs host vs rail) → one subagent per file set; shared foundation (world.wit, SDK pin, D1 decision) done by the orchestrator first |

## 8. Risk register (updated with research findings)
| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R0 | `{{profile.iban}}`-style markers unresolvable on the cluster's profile schema | Magic moment breaks | D1 decision in Phase 1: direct → user-upsert custom fields → documented-fields + KV-sourced fallback; record exact error strings (bug-report ammo either way) |
| R1 | "Coming soon" primitives needed | Scope cut | Only Available primitives used; payment executes via rail's own API (Duffel pattern), no in-ADK signing |
| R2 | SDK version churn (5.5.0 latest, 125 versions) | Breakage | Pin exact version; agent-auth-* deprecation window → member-delegation fallback (D2) |
| R3 | Rust toolchain friction on Windows | Setup stall | `rustup default stable` + `target add wasm32-wasip2` in Phase 0/1 |
| R4 | Judge: "rail is mocked, does this work for real?" | Credibility | Mock = Duffel pattern (config-swap); revocation beat carries the trust argument; iban_sha256 proof |
| R5 | Scope creep (live rail/KYC provider) | Missed deadline | Hard gate: mock only |
| R6 | Docs drift (setEnvironment default, getScriptVersion vs getContractVersion, stale manifest, 404 OpenAPI links) | Wrong assumptions / stuck | Docs are the scoring surface — use the WALKTHROUGH (runnable) variants; verify on live testnet; log every drift as a bug (scored) |
| R7 | Charge-on-attempt metering (pay even on error; retries re-charge) | Token burn / demo cost | Careful retry loops; get agent + user their own claim-page credits; DM t.me/wardumb for more (quote Superteam + DID) |
| R8 | KV maps owner-tamperable (no append-only KV) | Overclaim risk | Disclose precisely; point to the audit ledger (logging::audit + getAuditEvents) as the integrity surface |
| R9 | Late submission (62 already in) | Lower score | Phases 0–1 today; submit 24h+ before Sep 16 15:59:59 UTC |
| R10 | PII hygiene slip (real IBANs/keys in repo/history) | Trust kill | Fake-but-plausible fixtures; requesting-code-review; `.env.example` only |
| R11 | Session node-affinity + single-node 500s | Flaky demo | Retry once per docs; keep demo script local to one session context |
| R12 | Bundler WASM friction (Next/Vite/Webpack) | Host breaks | Plain Node + tsx only; no bundler in the demo path |
| R13 | Long tail rejected downstream in delegation grants | Grant fails | Short tail: `mandate-contracts` |

## 9. Acceptance criteria (map to the brief's MVP)
Must-have (all verified live before submission):
- [ ] Signup + quickstart + full walkthrough on testnet; `docs/buglog.md` with verbatim errors + reproduction steps
- [ ] D1 marker strategy verified on live cluster (outcome + exact errors recorded)
- [ ] Rust contract: `onboard-customer` + `pay-invoice` via http-with-placeholders (world.wit, WIT imports, correct tenant_did hex-encoding)
- [ ] TS host: separate agent DID, auth, scoped grant (functions + allowedHosts), orchestration, audit rows via getAuditEvents
- [ ] Mock rail (Express): logs exact payload, scrubbed responses, iban_sha256 proof
- [ ] Deterministic demo (Beats 0–5) incl. revocation → `egress denied` live
- [ ] Public GitHub + public Google Doc + README (architecture diagram, screenshots, run instructions, how-this-is-scored section)
- [ ] Bug report as a first-class artifact (buglog.md formalized, ~10 candidate findings)
Should-have:
- [ ] Audit-log pane in the demo (delegation + egress trail)
- [ ] X post tagging @terminal3io
- [ ] Handover note + eligibility answer ("continue running" + startup program)
If time allows:
- [ ] Reusable-KYC credential angle in the doc narrative (T3 Verify / Smart VC)
- [ ] Minimal web dashboard

## Appendix A — Key exact code / strings (research-verified)
A.1 Quickstart `quickstart.ts`: see §4.5 session construction; run `npx tsx quickstart.ts`.
A.2 Contract `format_http_error` (verbatim z-tenant-flight) — see §4.2 error strings.
A.3 Grant write (agent-auth-update) — see §4.4.
A.4 Error-substring table (match in `detail`): `version <x> is not higher than current version <y>` · `map already exists` (idempotent) · `map not found` · `canonical map name invalid: <reason>` · `quota exceeded: <dim>` · `access denied: <caller> cannot <op> map "<map>"` · `tenant is suspended` · `host/http.egress_denied: host '<host>' is not in the authorised_hosts allowlist` · `InsufficientCreditError` · auth prefixes `eth_authenticator_limit` (10-wallet cap), `eth_auth_map_conflict`, `email_not_verified`, `user_not_found`, `legacy_field`.

## Appendix B — Demo script (Beats 0–5)
BEAT 0 BEFORE: grant exists (grant.ts show), rail healthy, `grep -r "GB29" host/ contract/ || echo "no plaintext in repo"`.
BEAT 1 KYC: `run-demo.ts kyc --customer cus_1` → AGENT shows markers; RAIL shows `{"legal_name":"Ada Bank","date_of_birth":"1990-01-15",...}`. Assert rail.log has legal_name; agent log has marker, not plaintext.
BEAT 2 PAY (MAGIC MOMENT): `run-demo.ts pay --invoice inv_1 --amount 199.00` → AGENT: `{"beneficiary":{"legal_name":"{{profile.legal_name}}","iban":"{{profile.iban}}","swift":"{{profile.swift_bic}}"},...}` + `{payment_id, status:"settled", iban_sha256: 9f2a…}`; RAIL: `payload={"beneficiary":{"legal_name":"Ada Bank","iban":"GB29 NWBK 6016 1331 9268 19","swift":"NWBKGB2L"},...}`. Locally verify `sha256(IBAN) == iban_sha256`. Same request, two views — the secret moved without touching the mover.
BEAT 3 REVOKE: `grant.ts revoke --agent $AGENT_DID` (empty agents) → `grant.ts show` lists none.
BEAT 4 DENIED: `run-demo.ts pay --invoice inv_2 --amount 50.00` → `egress denied for host localhost:8787`; rail.log unchanged.
BEAT 5 AFTER: `grep -r "GB29" host/ contract/` still empty; optional audit pull.

## Appendix C — Repo tree (final)
```
terminal3/ (mandate)
├── README.md · LICENSE (MIT) · .gitignore
├── docs/  ARCHITECTURE.md · DEMO-SCRIPT.md · SUBMISSION.md · buglog.md
├── contract/  Cargo.toml · .cargo/config.toml · src/{lib.rs,kyc.rs,pay.rs}
│              wit/world.wit · wit/deps/{host-interfaces-2.1.0,host-tenant-1.0.0}
├── host/  package.json · .env.example · src/{connect,register,grant,run-demo}.ts
│          src/lib/{rail-client,logger}.ts · tests/
├── mock-rail/  package.json · src/server.ts · tests/
├── scripts/  build-contract.sh · seed-secrets.ts · start-rail.sh · demo.sh
└── tests/  e2e-asserts.sh
```

## Appendix D — README / Google Doc outline
README: pitch+badges → architecture diagram → run-it-yourself (5 commands) → layout table → architecture section → demo summary → testing → troubleshooting table → known deviations & caveats → license + handover.
Google Doc: title block → problem (cite docs' breach framing: "AI agents must not be given direct access to employee PII, bank account details, payroll provider credentials, or treasury payment keys") → insight (http-with-placeholders; delegation not blanket trust) → architecture → demo (2-min Loom of Beats 1–4) → **how-this-is-scored table** → run-it-yourself → handover note.

## Appendix E — Sources (all fetched 2026-09-01)
Docs: docs.terminal3.io — /llms.txt, /developers/adk/{overview,overview/adk-tour,overview/agent-auth-adk,get-started/quickstart,get-started/what-is-z-namespace,get-started/prerequisites/*,get-started/walkthrough/{write,build,register,invoke,test}-contract, tips/{capabilities-from-wit-import,create-kv-maps,seed-api-key,outbound-http-auth-by-user,placeholders-outbound-calls,common-errors}, reference, changelog, use-cases/payroll-agent}, /developers/agents/{register-agent,provision-org-agent}, /t3n/{data-owner-guide/delegate-access,use-cases/delegate-access-to-agent,how-t3n-works/{host-api,z-namespace,tokens,did,tees},overview/{what-is-t3n,why-t3n}}, /intro/{about-t3,platform}.
Repo: github.com/Terminal-3/z-tenant-flight (world.wit, deps/*.wit, Cargo.toml, .cargo/config.toml, src/*.rs, README).
Registry: registry.npmjs.org/@terminal3/t3n-sdk (5.5.0, 125 versions) + installed dist/index.d.ts.
Bounty: superteam.fun/earn/listing/t3n-agent-build-challenge (+ __NEXT_DATA__ JSON), superteam.fun/api/listings?query=terminal, prior listings (ai-id, dorahacks t3adkdevchallenge).
Products: terminal3.io/products/verify, terminal3.io/solutions/agentic/ai-governance.
Confirmed 404s: /api-reference/openapi.json, /terminal-3-openapi.yml, use-cases/{travel-booking,procurement}.md, github.com/Terminal-3/trinity (private).
Community leads (not official): github.com/ferdiii778/t3n-trusted-travel-agent, github.com/mansi0xc/aidlink/blob/main/BUGS.md (SDK 3.9.0 wall-hit log).
