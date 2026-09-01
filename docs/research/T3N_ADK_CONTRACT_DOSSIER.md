# T3N ADK — CONTRACT-SIDE TECHNICAL DOSSIER
### For MANDATE: a Rust TEE contract on Terminal 3 (T3N), built with `world.wit` / WIT imports + TypeScript host
**Research date:** 2026-09-01 · **Source:** official Terminal 3 docs (`docs.terminal3.io`), the official `Terminal-3/z-tenant-flight` reference repo, and the npm registry metadata for `@terminal3/t3n-sdk`. Every quote below is verbatim from a fetched source; every URL is listed in SOURCES.

> **TL;DR for the build:** A T3N TEE contract is a Rust crate compiled to a **WASM component** with `cargo build --target wasm32-wasip2 --release` (`crate-type = ["cdylib", "lib"]`, **no `cargo-component` needed**), driven by `wit-bindgen 0.49`. Its entire capability set is the set of host interfaces imported in `wit/world.wit` — there is **no capability manifest**. Capabilities available today: `http`, `http-with-placeholders`, `kv-store`, `logging`, `tenant` (`tenant-context`) — everything else is system-only or coming soon. PII is sent to upstream APIs via `{{profile.<field>}}` markers through `http-with-placeholders`; the host substitutes them inside the TDX enclave and the plaintext never enters WASM memory. Contracts are registered with `tenant.contracts.register({ tail, version, wasm })` (canonical name `z:<tid>:<tail>`), read secrets from `z:<tid>:secrets` via `kv-store::get`, and can only dial hosts the **calling user's grant** allows (`agent-auth-update` with `allowedHosts`), else `host/http.egress_denied`.

---

## 1. The Rust contract authoring model

### 1.1 The world: `wit/world.wit` (exact, from the official repo)

```wit
package z:tenant-flight@0.4.0;

world tenant-flight {
    import host:tenant/tenant-context@1.0.0;
    import host:interfaces/logging@2.1.0;
    import host:interfaces/kv-store@2.1.0;
    import host:interfaces/http@2.1.0;                    // search (no PII)
    import host:interfaces/http-with-placeholders@2.1.0;  // booking (PII via placeholders)

    export contracts;
}
```

Docs (walkthrough Step 1): *"A TEE contract is a Rust crate compiled to a WASM **component**. It exports its functions through a `contracts` WIT interface and imports only the host capabilities it needs."* And: *"[The interfaces you import here are your contract's entire capability set](/developers/adk/tips/capabilities-from-wit-import) — there is no separate manifest. The host links your contract against the matching tenant world and refuses to load it if it imports an interface that world does not provide."*

The exported `contracts` interface (exact):

```wit
interface contracts {
    /// Standard 3-field envelope used by all contracts callable from the node.
    /// `input`        — JSON-serialized request payload specific to the function.
    /// `user-profile` — always None for tenant contracts (hardcoded at dispatch).
    /// `context`      — JSON-serialized DynamicContext (node-minted, trusted).
    record generic-input {
        input:        option<list<u8>>,
        user-profile: option<list<u8>>,
        context:      option<list<u8>>,
    }
    search-offers: func(req: generic-input) -> result<list<u8>, string>;
    book-offer: func(req: generic-input) -> result<list<u8>, string>;
}
```

Design rules (verbatim from walkthrough): *"One func per operation. Each takes generic-input and returns JSON bytes on success, or an error string. There is no central `dispatch` function and no `ContractError` enum — the function name *is* the export."*

### 1.2 Capability names — the complete, confirmed list

From the SDK & API Reference ("WIT host interfaces (contract-side capabilities)"):

| Interface | Purpose | Status |
|---|---|---|
| `http` | Synchronous outbound HTTP. No PII allowed inline. | **Available** |
| `http-with-placeholders` | Outbound HTTP with server-resolved PII substitution. | **Available** |
| `kv-store` | Read/write tenant KV maps. | **Available** |
| `tenant` (`tenant-context`) | Tenant context, e.g. `tenant_did()`. Returns raw bytes (`list<u8>`) — hex-encode before use in a `z:<tid>:` path. | **Available** |
| `logging` | In-enclave logging. | **Available** |
| `did-registry`, `agent-auth`, `user-profile`, `user-removal`, `contracts-call`, `authorisation`, `otp`, `config/read`, `provider-config`, `time/clock`, `node-config`, `stash`, `agent-registry` | Various — see Host API | "Confirmed to exist — verify current maturity before relying on one, several are still evolving" |
| `signing`, `outbox`, `vp` | Cryptographic signing / async notifications / verifiable-presentation helpers. | **"Listed as coming soon"** |

Import-namespace rule (capabilities-from-wit-import tip): *"Your contract runs in one of the `tenant-*` linker worlds, chosen from the host interfaces it imports in `world.wit`. Import `http` and your contract is linked against the `tenant-http` world; import nothing beyond the base and you get `tenant-base` (`kv-store`, `logging`, `tenant-context`)."* And: *"On top of that, the TEE runtime enforces a capability ceiling — privileged interfaces (signing, user profile, …) are never linked into tenant worlds."*

**⚠ Version pins in the reference repo:** the vendored `wit/deps/` folders are `host-interfaces-2.1.0`, `host-tenant-1.0.0`, `host-outbox-1.0.0`. The header comment in `host-interfaces-2.1.0/package.wit` says the version is *"Held at @2.1.0 deliberately so existing contracts (user / vc / agent-registry / organisation / payroll), all pinned to @2.1.0 in their per-contract wit/deps copies, continue to link against the host runtime"* and that the canonical source-of-truth file is *"at @2.2.0"* — **pin your `wit/deps` to the same versions the host links (`2.1.0` interfaces, `1.0.0` tenant) unless you deliberately opt into new interfaces.**

### 1.3 Exact WIT signatures (verbatim from the vendored `package.wit` files)

**`host:interfaces/http`** — `call: func(request: request) -> result<response, string>;`
```wit
interface http {
  enum verb { get, post, put, patch, delete }
  record request {
    method: verb,
    url: string,
    headers: option<list<tuple<string, string>>>,
    payload: option<list<u8>>
  }
  record response { code: u16, payload: list<u8> }
  call: func(request: request) -> result<response, string>;
}
```

**`host:interfaces/http-with-placeholders`** — `call: func(request: request) -> result<response, http-error>;`
```wit
interface http-with-placeholders {
  enum verb { get, post, put, patch, delete }
  record request {
    method: verb,
    url: string,
    headers: option<list<tuple<string, string>>>,
    payload: option<list<u8>>
  }
  record response { code: u16, payload: list<u8> }
  variant http-error {
    egress-denied(string),          // Target host is not on the contract's `http_allow_list`
    placeholder-denied(string),     // namespace other than `profile`, or malformed marker
    placeholder-unknown(string),    // {{profile.<field>}} resolved to no value on the profile
    placeholder-no-user-context,    // no `pii_did` bound (admin / bootstrap / unauthenticated)
    upstream-error(string),         // transport/TLS/parse failure; PII is NEVER included
  }
  call: func(request: request) -> result<response, http-error>;
}
```

**`host:interfaces/logging`**
```wit
interface logging {
  info: func(message: string) -> result<_, string>;
  debug: func(message: string) -> result<_, string>;
  error: func(message: string) -> result<_, string>;
}
```

**`host:interfaces/kv-store`**
```wit
interface kv-store {
    get: func(map-name: string, key: list<u8>) -> result<option<list<u8>>, string>;
    put: func(map-name: string, key: list<u8>, value: list<u8>) -> result<_, string>;
    delete: func(map-name: string, key: list<u8>) -> result<bool, string>;   // true if existed
    set-claims-digest: func(digest: list<u8>) -> result<_, string>;          // must be exactly 32 bytes (SHA-256)
    scan: func(map-name: string, start: list<u8>, end: list<u8>, limit: u32)
        -> result<list<tuple<list<u8>, list<u8>>>, string>;                  // limit 0 rejected; one-shot, no cursor
}
```

**`host:tenant/tenant-context`**
```wit
interface tenant-context {
    tenant-did: func() -> list<u8>;                  // 20-byte raw CompactDid; hex-encode before building z:<tid>: paths
    contract-id: func() -> u32;                      // stable interned id of the running contract
    calling-user-did: func() -> option<list<u8>>;    // None for /api/dev/exec and webhook dispatch
    cluster-timestamp-secs: func() -> u64;
    seq-no: func() -> u64;
}
```

**Rust side (from the reference repo) — import paths and calling conventions:**
- WIT `kebab-case` names become Rust `snake_case` module paths: `use crate::host::interfaces::{http as http_iface, kv_store, logging, http_with_placeholders as hwp};` and `use crate::host::tenant::tenant_context;`
- `http_iface::call(&http_iface::Request { method: http_iface::Verb::Post, url, headers: Some(vec![(String, String)]), payload: Some(bytes) })` returns `Result<Response, String>`; `resp.code` is `u16`, `resp.payload` is `Vec<u8>`.
- `kv_store::get(&map_name, b"duffel_api_key")` — full canonical map name (`z:<tid>:secrets`), byte-string key.
- `tenant_context::tenant_did()` returns raw bytes — **must hex-encode**: `format!("z:{}:secrets", hex::encode(&tid))`.
- Bindings generated at compile time:
```rust
wit_bindgen::generate!({
    world: "tenant-flight",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});
...
#[cfg(target_arch = "wasm32")]
impl exports::z::tenant_flight::contracts::Guest for Component {
    fn search_offers(req: exports::z::tenant_flight::contracts::GenericInput) -> Result<Vec<u8>, String> { ... }
}
#[cfg(target_arch = "wasm32")]
export!(Component);
```

### 1.4 `Cargo.toml` (exact, from the official repo)

```toml
[package]
name = "z-tenant-flight"
version = "0.4.1"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[dependencies]
wit-bindgen = { version = "0.49", default-features = false, features = ["macros", "realloc"] }
serde = { version = "1.0", default-features = false, features = ["derive", "alloc"] }
serde_json = { version = "1.0", default-features = false, features = ["alloc"] }
hex = { version = "0.4", default-features = false, features = ["alloc"] }

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
strip = true
```

Doc comment: *"# crate-type cdylib is what makes the wasm32-wasip2 target emit a WASM *component* (not a bare module). Keep "lib" too so the business logic stays unit-testable natively."* The release profile comment: *"Small, self-contained artifact — keeps registration under the size cap."* The contract is effectively `no_std`-style (the code uses `alloc::` paths and `extern crate alloc;`), so keep dependencies `default-features = false` with `alloc`.

> **Repo/docs discrepancy to know about:** `src/lib.rs` in the official repo carries a doc comment showing a legacy JSON manifest `{"host_capabilities": ["kv_store", "logging", "tenant_context", "http", "http_with_placeholders"]}` and the repo README shows `z_sdk.kv("secrets").set(...)`. The **docs explicitly say there is no manifest** ("You don't declare capabilities in a manifest — there isn't one") and that seeding uses the `map-entry-set` control call. Treat `host_capabilities` as stale repo documentation; the current surface is WIT-imports-only + `tenant.executeControl("map-entry-set", …)`.

---

## 2. Compile / build flow

Exact commands (Step 2 "Build your TEE contract"; run from the contract repo root where `Cargo.toml` and `wit/world.wit` live):

```bash
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
ls -lh target/wasm32-wasip2/release/*.wasm
```

- **Toolchain:** Rust via rustup (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` then `source "$HOME/.cargo/env"`), WASI Preview 2 target `wasm32-wasip2` ("WASI Preview 2 build target — a few seconds").
- **No `cargo-component` required** (verbatim Note): *"You do not need `cargo-component`. With `crate-type = ["cdylib", "lib"]` in `Cargo.toml`, the `wasm32-wasip2` target emits a WASM component that T3N can inspect and register."*
- **Output path:** `target/wasm32-wasip2/release/`. *"If your package name contains hyphens, Cargo converts them to underscores in the file name. The `z-tenant-flight` package therefore builds to: `target/wasm32-wasip2/release/z_tenant_flight.wasm`."*
- **Verify the component interface** (optional but recommended):
```bash
wasm-tools component wit target/wasm32-wasip2/release/z_tenant_flight.wasm
```
*"The output should include the host interfaces you imported in `wit/world.wit`, such as `host:interfaces/kv-store`, and your exported interface: `export contracts;`."* Install with `cargo install wasm-tools` — the docs warn: *"`cargo install wasm-tools` compiles roughly 100 crates from source and takes about 2 minutes with no progress output in between — that's normal, not a hang."*
- The official repo also ships `.cargo/config.toml` with `[build] target = "wasm32-wasip2"` (so a bare `cargo build` also works).
- **Native tests:** `cargo test` / `cargo test --lib`; host-calling functions (`http`, `kv-store`) are `#[cfg(target_arch = "wasm32")]`-gated — *"natively they return an error, so unit tests focus on input parsing and validation"* (native `search_offers` returns `Err("search_offers is only implemented on the wasm32 target")`).
- The `.wasm` artifact is what you pass to `tenant.contracts.register` (Step 3). The TS side runs with `npx tsx quickstart.ts` (Node project needs `npm pkg set type=module` for top-level await).

---

## 3. The TEE model — Wasmtime sandbox, Intel TDX, deploy/register/invoke

### 3.1 Runtime

From "Trusted Execution Environment (TEE) Node": *"Applications on T3N are packaged as TEE contracts. Each contract is executed by the node's WASM runtime (**Wasmtime**) in a sandbox that limits it to a set of granted host functions, and the whole runtime executes inside the TEE."* TEE nodes provide: *"Post-quantum encrypted communication channels; Authentication and attestation services; Consensus-backed storage (a distributed key-value store replicated across the cluster using the Raft consensus protocol and protected with Merkle-tree integrity proofs); Host functions that allow TEE contracts to interact with external systems and network services."*

Hardware: *"The T3 Network currently utilizes **Intel TDX (Trust Domain Extensions)** to run Secure Encrypted Virtual Machines. Future versions will support other TEEs."*

Host API model: *"TEE contracts execute as WebAssembly (WASM) components within a sandboxed Wasmtime runtime hosted by a T3N node. By default, contracts have no direct access to the operating system, network, filesystem, clock, randomness, or other system resources."* — *"TEE contracts interact with the outside world exclusively through a strongly typed Host API implemented by the T3N node using the WASM Component Model."* — *"If a capability is not defined in the Host API, the contract cannot do it."* — *"all interfaces are gated by authorisation checks — a contract cannot access capabilities it has not been granted."*

Storage/execution lifecycle: *"TEE contracts are stored off-chain in content-addressable storage (CAS) and are not persisted directly on T3N nodes. Instead, the node registry maintains references to contract artifacts, allowing nodes to retrieve and execute the correct contract version on demand."* and *"A TEE contract is invoked only after the requested data has been securely decrypted within an attested TEE and all required authentication and authorization checks have been successfully completed."*

Execution sequence (mermaid in docs): client sends `action.execute(encrypted request)` → node decrypts → `{tee_contract_name, function_name, input}` → KV `Get user profile ValueRef by DID` → CAS fetch encrypted profile blob → `Decrypt profile (AES-256-GCM with cluster CEK)` → resolve contract ValueRef from registry → fetch contract bytecode from CAS → `Execute TEE contract (profile, input) in sandbox` → encrypted response back to client.

### 3.2 Register / deploy (SDK, TypeScript host side)

Built on `TenantClient` (constructed with `t3n` = authenticated `T3nClient`, `baseUrl: getNodeUrl()`, `tenantDid`; verify with `await tenant.tenant.me()` — *"throws if something's wrong"*).

```typescript
import { readFile } from "fs/promises";

const WASM_PATH = "../z-tenant-flight/target/wasm32-wasip2/release/z_tenant_flight.wasm";
const CONTRACT_TAIL = "travel-contracts";
const CONTRACT_VERSION = "0.1.0";

const wasmBytes = await readFile(WASM_PATH);

const result = await tenant.contracts.register({
  tail: CONTRACT_TAIL,
  version: CONTRACT_VERSION,
  wasm: wasmBytes,
});

const contractId = result.contract_id;
const tenantId = tenantDid.slice("did:t3n:".length);
const scriptName = `z:${tenantId}:${CONTRACT_TAIL}`;
console.log(`registered ${scriptName} as contract id ${contractId}`);
```

Key registration facts (verbatim):
- **Tail rules:** *"The `tail` is the tenant-local name… the full canonical name is `z:<tid>:<tail>`"*; regex `tail must match /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/`. Never pass `z:<tid>:` yourself — the SDK prefixes it.
- **Version semantics:** *"registering a new `version` at the same tail allocates a new `contract_id` rather than replacing the old one"* (What is ADK table). Re-registration with a non-greater version fails: `version <x> is not higher than current version <y>`.
- **Version shadowing warning (changelog + register page):** *"A previously-working pinned-version call starts failing or behaving unexpectedly → An explicit pinned version is honored by `contracts.execute()`, so a pinned call failing usually means that version was never successfully registered/executable — not that it was shadowed."* And the AI-assistant skill pitfalls table: *"Re-registering a contract breaks old pinned-version calls — Registering a newer version can reroute calls that pin an older one — Re-verify any version-pinned calls after any re-registration."*
- **Capabilities at registration:** *"Your contract's capabilities come from the host interfaces it imports in `world.wit`, not from this registration request."*
- **Long tails:** *"A long contract tail is rejected further downstream (e.g. when building a delegation grant), even though registration succeeded — Some downstream operations enforce a shorter length limit on the full canonical name than registration does. Prefer a short tail from the start."*
- Contracts are invoked via the same `execute` transport as other T3N contracts; *"The only difference is the `contract_id` starts with `z:<tid>`:"* — i.e. `contract_id: z:<tid>:travel-contracts`, plus `contract_version` (from `getContractVersion(getNodeUrl(), TENANT_SCRIPT)`), `function_name`, `input` (JSON).

### 3.3 "Armed" = the data-owner grant, then invoke

There is no "arm" verb — a contract becomes callable-with-egress only after the **data owner** signs an `agent-auth-update` grant (this is the docs' "armed" state). Sequence (Invoke walkthrough):

1. **Agent session:** `agentClient` built with its own `AGENT_KEY`; `trustAnchor: await fetchTrustedManifest("testnet")`; `handshake()` → `authenticate(createEthAuthInput(agentAddress))` → `agentDid`.
2. **User session:** `userClient` built the same way with `USER_KEY` (*"stands in for the real data owner's own key"*).
3. **User signs the grant:**
```typescript
const userContractVersion = await getContractVersion(getNodeUrl(), "tee:user/contracts");
await userClient.execute({
  contract_id: "tee:user/contracts",
  contract_version: userContractVersion,
  function_name: "agent-auth-update",
  input: {
    agents: [{
      agentDid: agentDid,
      scripts: [{
        scriptName: TENANT_SCRIPT,               // z:<tid>:travel-contracts
        versionReq: scriptVersion,
        functions: ["search-offers", "book-offer"],
        allowedHosts: ["api.duffel.com"],        // hosts the contract may dial
      }],
    }],
  },
});
```
*A grant is scoped three ways at once: which contract, which functions on it, and which external hosts it may reach.* For direct (self) calls, set `agentDid` to the user's own DID ("a self-grant"). **Without a matching grant: *"the contract still runs, but any outbound call is denied with `host/http.egress_denied`."***
4. **Invoke (as the agent):** `agentClient.executeAndDecode({ contract_id: TENANT_SCRIPT, contract_version: scriptVersion, function_name: "search-offers" | "book-offer", input: {...} })`.

There is also a **no-code path** for the grant: the T3N Dashboard (https://testnet.network.terminal3.io) → `AI Agents` tab → `New agent` → enter Agent DID → select `Authorized TEE contract` → optional `functions` → optional `Allowed hosts` → `Add`. Note: *"If optional fields are not specified, the agent will have access to all functions and hosts."* Revocation is a `Remove` click on the same tab.

### 3.4 Metering / tokens

*"T3N tokens are used to meter TEE contracts execution and storage… They are not OAuth tokens, session tokens, JWTs, or API keys."* Metered items: *"WASM compute fuel, host-function calls such as kv.put or cas.write, storage deposit and storage rent, contract registration when the admin request bills your DID."* Failure semantics: *"Metered WASM uses charge-on-attempt semantics. If a contract starts and consumes cluster resources, the caller pays for the fuel and host-function budget consumed even if the contract later returns an error, panics, or runs out of token. Contract writes are rolled back on failure, but consumed work is still charged."* Tokens are currently non-transferable.

---

## 4. Placeholder substitution (`http-with-placeholders`)

### 4.1 Syntax and semantics

- Exact marker syntax: `{{profile.<field>}}` — e.g. `{{profile.first_name}}`, `{{profile.last_name}}`, `{{profile.date_of_birth}}`, `{{profile.gender}}`, `{{profile.verified_contacts.email.value}}` (dot-paths into the user-profile schema are allowed).
- The marker is placed **in the request body (and headers) as a literal string**. The contract sends the template; the host resolves it *inside the enclave*, *"just before the request goes out"*. Verbatim: *"it does **not** read the values and inline them. Instead it uses the **`http-with-placeholders`** host interface: you put `{{profile.<field>}}` markers in the request, and the host resolves them from the calling user's profile **inside the enclave**, just before the request goes out. The plaintext never enters your WASM."*
- From the reference `{{profile.iban}}` angle: the marker pattern generalizes to **any profile-schema field**, i.e. `{{profile.<path.to.field>}}`. The docs' canonical naming-convention row: *"`{{profile.<field>}}` — Placeholder marker resolved server-side inside the enclave — the literal string is what your contract sends; the real value never enters WASM memory."* (The Duffel example sends bank-free data; the same mechanism carries `{{profile.iban}}`-style fields for payment use cases. The payroll use-case page describes exactly this: *"instead of accessing employee bank details… the Payroll AI Agent submits a payroll execution instruction to T3N. T3N securely delivers the required sensitive payroll data directly to the payroll provider."*)

### 4.2 Which markers are permitted

The host enforces a hard namespace gate (verbatim from vendored WIT comment): *"The host enforces only the hard `profile`-namespace gate — `{{secrets.<x>}}` and any namespace other than `profile` is rejected with `placeholder-denied`."* Malformed markers are also rejected: the `placeholder-denied` doc comment lists *"a placeholder referenced a namespace other than `profile`, or used a malformed marker (nested / non-snake-case field)."*

Fields the profile schema doesn't carry yet must be supplied by the contract directly (verbatim): *"Markers reference the user profile schema — e.g. `{{profile.first_name}}`, `{{profile.date_of_birth}}`, `{{profile.verified_contacts.email.value}}`. Fields the schema doesn't carry yet (passport, title) are supplied by your contract directly."* (The reference repo demo-hardcodes `title`, `passport_number`, `passport_country_code`, `passport_expiry_date`, `phone_number` because *"the user-profile schema carries no passport / nationality / title fields, and we don't run phone verification for the demo, so `verified_contacts.phone.value` won't exist."*)

### 4.3 Error strings (typed `http-error` → contract-facing strings)

The Rust side maps the WIT variant to strings (exact code from `booking.rs`):

```rust
fn format_http_error(e: hwp::HttpError) -> String {
    match e {
        hwp::HttpError::EgressDenied(host) => format!("egress denied for host {host}"),
        hwp::HttpError::PlaceholderDenied(marker) => format!("placeholder not permitted: {marker}"),
        hwp::HttpError::PlaceholderUnknown(field) => format!("user profile missing field: {field}"),
        hwp::HttpError::PlaceholderNoUserContext => "no user context bound for placeholder resolution".to_string(),
        hwp::HttpError::UpstreamError(reason) => format!("upstream: {reason}"),
    }
}
```

Docs' placeholders page states the same contract-facing strings: *"A marker your contract isn't permitted to resolve fails with `placeholder not permitted: <marker>`."* and *"Egress is the same rule as `http`. The target host must be on the user's allowed-hosts grant, or the call is denied (`host/http.egress_denied`)."* The platform-side full egress error (from Common Errors): `host/http.egress_denied: host '<host>' is not in the authorised_hosts allowlist`.

### 4.4 Injection gating

*"Profile access is gated by the user's delegation."* — markers resolve only when the calling agent is authorized for that user (the `agent-auth-update` grant). Also: *"the contract WASM never holds plaintext PII — substitution happens on the host stack between manifest validation and the outbound reqwest call, so a compromised contract that tries to read the substituted bytes back finds only the unresolved template."* (vendored WIT comment). A call with no bound user (`pii_did`) fails `placeholder-no-user-context` — *"No wall-clock fallback, no admin override — there is no user profile to substitute from."* Calls are synchronous: *"Like plain `http`, you get the upstream response back in the same invocation — there's no deferred queue."*

---

## 5. Secrets & KV (z-namespace, map-entry-set, ACLs)

### 5.1 z-namespace canonical naming

*"Every z-namespace resource uses this canonical name: `z:<tid>:<tail>`"* where `<tid>` = *"40-hex suffix of your tenant DID, `did:t3n:<tid>`"* (i.e., the 20-byte lowercase hex suffix) and `<tail>` = tenant-local map or contract name. Example: `z:8f3a0123456789abcdef0123456789abcdefc91d:secrets`. The z-namespace overview: *"The cluster enforces one rule at hardware level: a contract can only read or write maps whose prefix matches its own `<tid>`. There is no ACL misconfiguration that can break this — the check runs inside the TDX enclave at every transaction."*

- Tenant-owned namespaces (`z:`) are open-ended; system maps (`users`, `auth`, `dids`, `scripts`, `outbox_*`, `idx:_tenant_*`) are T3N-owned and *"Tenant contracts cannot directly read the T3N users system map. Treat user profile data as outside z-space."* — *"Do not copy PII into tenant maps just to make it easier for a contract to read."*
- Public maps: `z:<tid>:public:<tail>` + `visibility = "public"`; world-readable via `/api/dev/public-kv/<tid>/<tail>`; tail must start with `public:`; *"Never put PII in a public map."* Public visibility does not auto-grant cross-tenant contract reads.

### 5.2 Creating the `secrets` map with ACLs

```typescript
await tenant.maps.create({
  tail: "secrets",
  visibility: "private",
  writers: { only: [contractId] },
  readers: { only: [contractId] },  // REQUIRED — the kv-governor denies reads when omitted
});
```

- **`readers` must be set explicitly**: *"`readers` **must** be set explicitly — the KV governor defaults to **deny**, so leaving it off makes the contract's own secret read fail with `AccessDenied`."* (`MapAlreadyExists` is idempotent — safe to re-run when re-deploying.)
- ACL semantics (Storage Namespaces → Access model): *"Writers controls which **tenant contracts** may write. Readers controls which **tenant contracts** may read. If readers is omitted on map creation, it defaults from writers. Cross-tenant access is denied unless the map owner explicitly grants another tenant contract access."* → *"cross-tenant access is possible by deliberate policy, but not by accident."*
- **ACLs gate your contracts, not you:** *"`writers`/`readers` gate your contracts, not you… As the tenant that owns a map, you can always write or delete its entries directly through the authenticated control plane — e.g. `tenant.executeControl("map-entry-set", …)` — regardless of a `writers: { only: [...] }` grant."* → *"a 'contract-only' map is **not tamper-proof against its own owner**… that calls for a host-stamped, append-only primitive, which T3N does not yet expose."*

### 5.3 Seeding secrets via `map-entry-set` (control plane)

```typescript
await tenant.executeControl("map-entry-set", {
  map_name: tenant.canonicalName("secrets"),
  key:      "duffel_api_key",
  value:    process.env.DUFFEL_API_KEY!,
});
console.log("API key sealed in z:<tid>:secrets — not visible outside the TEE");
```

Verbatim: *"There's no `set-credentials` function — the tenant SDK writes the key straight into the map with the `map-entry-set` control call, on the authenticated `tee:tenant/contracts` path (not an agent call)."* It *"bypasses the map's `writers` ACL — the key lands even though the map is read/write-restricted to the contract alone."* Then the contract reads it back inside the enclave: `kv_store::get(&format!("z:{}:secrets", hex::encode(&tenant_did())), b"duffel_api_key")` — *"`kv-store::get` takes the full canonical map name (not the bare tail) and a byte-string key."* Verbatim security claim: *"The only path to the key is through your contract code — no external observer, not the agent, not the calling developer, can read it back out."*

### 5.4 KV transactionality

Host API table: `kv-store` → *"Read / write / delete entries in the contract's namespaced key-value maps. Writes participate in the same atomic transaction as the rest of the call."* — *"Namespace is bound to the contract; no cross-contract reads."*

---

## 6. Egress — host allowlists and how outbound hosts are scoped

- **The contract never declares hosts.** Verbatim: *"Your TEE contract does not declare which hosts it may call. A tenant contract's outbound HTTP egress is resolved, on every call, from the **calling user's authorization grant** — the *allowed hosts* the user grants when they delegate to your agent or contract: **Delegated call** → the subject user's grant. **Direct (self) call** → the caller's own self-grant."*
- **Denial behavior:** *"If the target host (for example `api.duffel.com`) isn't on the grant's allowed-hosts list, the contract still runs but the outbound call is denied with `host/http.egress_denied`."* Full message: `host/http.egress_denied: host '<host>' is not in the authorised_hosts allowlist`.
- **Docs' #1 integration warning:** *"This is the most common reason a working contract can't reach its API: the code is fine, but no grant authorizes the host. Set the grant before you invoke."*
- **`http` vs `http-with-placeholders` share one egress policy** (vendored WIT): *"Egress is gated by the existing per-contract `http_allow_list` (same allowlist plain `http` uses), so a contract opted into both `http` and `http-with-placeholders` shares one egress policy."*
- **Grant shape is per-agent / per-script / per-function / per-host** (see §3.3): `agentDid` → `scripts[]` → `{ scriptName, versionReq, functions, allowedHosts }`. The WIT interface `agent-auth` is `update-authorisations: func(user-did: list<u8>, payload: list<u8>)` where the payload JSON schema is `{"agents": list<{"agentDid": string, "scripts": list<{"scriptName": string, "versionReq": option<string>, "functions": option<list<string>>, "allowedHosts": option<list<string>>}>}>}`.
- **Narrative:** *"An AI agent doesn't get standing access to anything… No grant, no access — the contract still runs, the outbound call just gets denied."* (ADK Tour); *"Splitting authentication from authorization means a compromised or misbehaving agent key doesn't automatically mean compromised data access — the blast radius of a leaked agent key is exactly whatever scripts, functions, and hosts a user has explicitly granted it, nothing more. It also means a user can revoke an agent's access without the agent's key changing at all — they just stop re-issuing the grant."* (Agent Auth).
- Dashboard path for the same grant (Data Owner Guide, `https://testnet.network.terminal3.io` → AI Agents tab), with the "all functions and hosts if unspecified" default.
- Forbidden host examples in docs: allowed host `https://api.airlines.com` — *"It cannot send your passport data to any other server."*
- Note a docs-internal drift: the Host API table's `http-with-placeholders` gating column says *"Egress allowlist (shared with `http`) plus a per-contract `placeholder_allowlist` naming which profile fields may be substituted"*, while the vendored WIT comment says the only host-side placeholder gate is the hard `profile` namespace and that field-level access is governed by the agent delegation grant. The WIT/implementation text is the more precise one; the Host API table appears stale. Worth verifying against the live testnet when the grant is exercised.

---

## 7. Quickstart / walkthrough — every step, in order, with commands + known stuck points

### Phase 0 — Claim key & credits (https://www.terminal3.io/claim-page)
Sign in with work email; developer key + test credits issued instantly (self-serve). **Key shown once — copy before navigating away; it cannot be retrieved.** Optional campaign code for extra credits.

### Phase 1 — Quickstart (authenticated call, ~10 min)
```bash
mkdir my-t3n-app && cd my-t3n-app
npm init -y
npm pkg set type=module        # required — the code uses top-level await
npm install @terminal3/t3n-sdk tsx
export T3N_API_KEY="<the key you copied from the claim page>"
```
Create `quickstart.ts` (exact):
```typescript
import {
  T3nClient, setEnvironment, loadWasmComponent,
  eth_get_address, metamask_sign, createEthAuthInput, fetchTrustedManifest,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet"); // the public SDK defaults to testnet — set it explicitly

const T3N_API_KEY = process.env.T3N_API_KEY!;
const wasmComponent = await loadWasmComponent(); // all crypto runs inside this component
const address = eth_get_address(T3N_API_KEY);

const t3n = new T3nClient({
  trustAnchor: await fetchTrustedManifest("testnet"), // pins the node's attestation
  wasmComponent,
  handlers: { EthSign: metamask_sign(address, undefined, T3N_API_KEY) },
});

await t3n.handshake();
const did = await t3n.authenticate(createEthAuthInput(address));
const tenantDid = did.value; // did:t3n:... — reuse this exact variable in every later step
console.log("Connected as:", tenantDid);
```
Run: `npx tsx quickstart.ts` → expect `Connected as: did:t3n:9f2a...`.

**Stuck points (documented):** (1) `Top-level await is currently not supported with the "cjs" output format` → missing `"type": "module"` (`npm pkg set type=module`). (2) `Invalid Ethereum private key` from `eth_get_address` → `T3N_API_KEY` not exported into the running shell. (3) WASM parse/module-load errors under Next.js/Turbopack, Vite, older Webpack → *"the SDK loads a WASM component, and some bundlers try to process it in ways that break it"*; try plain Node script or server-only route first; on Next.js add a no-bundle exception for `@terminal3/t3n-sdk`. (4) Later snippets fail with `ReferenceError: tenant is not defined` → **append every later snippet to the same `quickstart.ts` file** — the docs' code samples assume `t3n`/`tenantDid`/`tenant` are in scope from earlier steps.

### Phase 2 — Set up dev environment
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # choose default
source "$HOME/.cargo/env"
rustup target add wasm32-wasip2
cargo install wasm-tools      # optional; ~2 min, no progress output — normal
```
Append to `quickstart.ts`:
```typescript
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
const tenant = new TenantClient({
  t3n,
  baseUrl: getNodeUrl(),   // the active node from setEnvironment() — pass explicitly!
  tenantDid,               // did.value from Quickstart — never hardcode
});
await tenant.tenant.me();  // throws if something's wrong
console.log("TenantClient ready.");
```
Run `npx tsx quickstart.ts` → confirm `TenantClient ready.` **Stuck point:** omitting `baseUrl` on `TenantClient` — *"calls can still fail at request time without it, even after calling `setEnvironment()`. This is specific to `TenantClient` — `T3nClient` … doesn't take a `baseUrl` at all."* Fix: always pass `baseUrl: getNodeUrl()`.

### Phase 3 — Write the contract (separate repo!)
```bash
cd .. # out of my-t3n-app, back to a shared parent folder
git clone https://github.com/Terminal-3/z-tenant-flight.git
cd z-tenant-flight
```
Repo layout: `src/lib.rs` (bindings + Guest dispatch), `src/search.rs`, `src/booking.rs`, `wit/world.wit`, `wit/deps/` (vendored `host-interfaces-2.1.0`, `host-tenant-1.0.0`, `host-outbox-1.0.0`), `Cargo.toml`. **Stuck point:** the contract project is a sibling of the Node project, never nested inside it — `WASM_PATH` must point *across* folders.

### Phase 4 — Build
```bash
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
ls -lh target/wasm32-wasip2/release/*.wasm   # → z_tenant_flight.wasm
```
(Optional) `wasm-tools component wit target/wasm32-wasip2/release/z_tenant_flight.wasm`.

### Phase 5 — Register + wire secrets
1. Create the `secrets` map with `readers: { only: [contractId] }` **and** `writers: { only: [contractId] }` — but `contractId` comes from registration, so register first, then create the map (or `tenant.maps.update(...)` to add the contractId later; the docs' troubleshooting row: *"The contract registers, but later cannot read `secrets` → The map does not exist yet, or its ACL does not include this `contractId`."*).
2. `tenant.contracts.register({ tail: "travel-contracts", version: "0.1.0", wasm: wasmBytes })` → capture `result.contract_id`.
3. `tenant.maps.create({ tail: "secrets", visibility: "private", writers: { only: [contractId] }, readers: { only: [contractId] } })`.
4. Seed the API key: `tenant.executeControl("map-entry-set", { map_name: tenant.canonicalName("secrets"), key: "duffel_api_key", value: process.env.DUFFEL_API_KEY! })`.

**Registration stuck points:** `ENOENT: no such file or directory` → `WASM_PATH` wrong (cross-folder) or contract not built; `tenant not found` → `tenantDid` constructed/derived instead of read from `did.value`; `version <x> is not higher than current version <y>` → bump `CONTRACT_VERSION` (e.g. `0.1.0` → `0.1.1`).

### Phase 6 — Grant egress (user signs) + invoke (agent calls)
Build `agentClient` (own `AGENT_KEY`), `userClient` (own `USER_KEY`), then `userClient.execute({ contract_id: "tee:user/contracts", ..., function_name: "agent-auth-update", input: { agents: [{ agentDid, scripts: [{ scriptName: TENANT_SCRIPT, versionReq: scriptVersion, functions: ["search-offers","book-offer"], allowedHosts: ["api.duffel.com"] }] }] } })`, then `agentClient.executeAndDecode({ contract_id: TENANT_SCRIPT, contract_version: scriptVersion, function_name, input })` (full code in §3.3).

**Agent stuck points:** agent needs its **own** key + **own** credits from the claim page (revisit it per agent — it mints a fresh key+credits each time); reusing the tenant key → `InsufficientCreditError` on metered calls (an agent DID's balance "starts at zero even when the tenant has plenty of test tokens"). Agent authenticated but calls fail with `host/http.egress_denied` → no one authorized it yet (auth ≠ authorization).

### Phase 7 — Test
Native unit tests: `cargo test` (business-logic guards; host fns not available natively). Test checklist from the docs: happy path `search-offers → book-offer` returns `{ id, pnr, status }`; input hygiene (book-offer accepts only `offer_id`, `passenger_id`, `total_amount`, `total_currency` — any payload carrying passenger PII is rejected at parse with an error containing `"bad input"`); PII never in output or logs; *"The `{{profile.*}}` markers stay literal in the contract — resolution happens host-side, so they never appear resolved in WASM memory."*

### Phase 8 — Agent onboarding (if the caller is a separate agent)
`npx @terminal3/t3n-sdk --help` (zero-install) or `pnpm add -g @terminal3/t3n-sdk`; `export T3N_API_KEY="0x<agent's private key>"`; `t3n whoami --env testnet`; `t3n agent create-card --did "$AGENT_DID"` (card < 16 KiB); `t3n agent host-card --file agent-card.json --env testnet` → served at `https://<node>/api/agent-card/<did>`; verify with `curl https://<node>/api/agent-card/"$AGENT_DID"`. Org-owned variant: `t3n org create --name ...`, `t3n agent create --org ... --name ... --card agent-card.json` (API key `t3n_key_<id>.<secret>` printed **once**, minted inside the TEE, unrecoverable; presented in `X-T3N-Api-Key` header on stateless `POST /api/invoke`).

---

## 8. BUGS / GOTCHAS — exhaustive, documented or discoverable

### 8.1 Error transport & exact error strings
- Errors come back as JSON-RPC **`bad_request`** (HTTP 400) with `{ code: "bad_request", detail, request_id }`. *"The SDK throws with `detail` — a human-readable message string, **not** a typed error object. Match on the substring shown below."* User-auth failures carry a machine code prefix in `detail` (e.g. `eth_authenticator_limit: …`) for a single `startsWith`.
- **Tenant op errors (match substrings in `detail`):** `version <x> is not higher than current version <y>` · `map already exists` (idempotent, ignore) · `map not found` · `canonical map name invalid: <reason>` (tail empty / contains `..` / starts with `z:`) · `quota exceeded: <dim>` (e.g. `quota exceeded: max_contracts`) · `access denied: <caller> cannot <op> map "<map>"` · `tenant is suspended` · `host/http.egress_denied: host '<host>' is not in the authorised_hosts allowlist` · `InsufficientCreditError` (agent identity with zero balance).
- **Auth/wallet codes (prefix of `detail`):** `eth_authenticator_limit` (cap on wallets per DID — e.g. adding an 11th; i.e. the cap is 10) · `eth_auth_map_conflict` (wallet already linked to another DID) · `email_not_verified` · `user_not_found` (DID has no profile) · `legacy_field` (pre-2.0.0 dispatch field such as `otp_code` on `user-upsert`).
- **Contract-side typed errors** (from WIT): `egress-denied`, `placeholder-denied`, `placeholder-unknown`, `placeholder-no-user-context`, `upstream-error` → surface strings in §4.3.
- **Generic HTTP 500 triage (docs' procedure):** (1) grab `request_id` first; (2) re-check egress and ACLs — *"A missing outbound-host grant or a missing map ACL entry can surface as a 500 instead of the more specific error you'd expect"*; (3) retry once — *"A single unhealthy node can return a 500 for requests that are otherwise correct"*; (4) if consistent/reproducible, report to dev Telegram with `request_id` — *"it's more likely a platform-side issue than your integration."*

### 8.2 Contract-authoring gotchas
- **`tenant_did()` returns raw bytes, not a string.** *"Using it directly (or formatting it with `{}`) is wrong and won't compile against a `String` map path — it must be hex-encoded first."* And from the AI-assistant skill: *"a missing OR double hex-encode both produce a path that matches nothing."* Correct: `format!("z:{}:secrets", hex::encode(&tenant_did()))`.
- **`readers` defaults to deny** → `AccessDenied` on your own secret; always set `readers`/`writers` explicitly on `maps.create`.
- **Host fn calls are wasm32-only** — host functions "only run on `wasm32`; natively they return an error."
- **WASM memory limits are real:** the reference `search.rs` guards against a 1.7 MB Duffel response OOMing WASM with `const MAX_OFFER_REQ_BYTES: usize = 65_536;` ("64 KB is well above the ~2 KB we expect" — *"serde_json will OOM inside WASM"*). Keep payloads small.
- **Duplicate `Content-Type` header:** the host HTTP fn sets Content-Type via `.json()` automatically — *"sending it explicitly creates a duplicate that Duffel rejects."*
- **Register small:** release profile `strip = true` + `opt-level = "s"` + `lto` + `codegen-units = 1` — *"keeps registration under the size cap"* (no exact WASM byte cap is published; the only published size cap is the 16 KiB agent-card limit).
- **No time source inside WASM** unless you import `time`/`clock` (System-only): *"Any time-dependent logic — there is no other source of time inside WASM."*
- **`kv-store::scan`:** `limit 0` is rejected; one-shot, no cursor/paging; reserved host-iface maps (outbox…) refuse `scan`.
- **`set-claims-digest`** must be exactly 32 bytes (SHA-256) and is included in the Merkle leaf for offline receipt verification.
- **`contracts-call` (contract-to-contract):** default-deny `(caller, target)` allowlist, `allowed_functions`, `max_depth`; typed errors `reentrant`, `depth-exceeded`, `not-allowlisted`, `target-unknown`, `inner-failed`, `inner-trapped`, `encoding-failed`, `no-execution-context`. Inner call shares the outer OCC transaction; inner writes discarded on inner failure but the outer may continue.
- **`signing`:** `sign-as-user` needs a per-contract allowlist; `sign-with-wallet` errors `not-authorized` / `malformed-address` (address must be exactly 20 bytes). `sign-sd-jwt-vc` uses `bind-to-holder: bool` — *"Replaces the pre-2.0.0 `holder-binding-key-material: option<string>` field, which shipped the private key across the WIT boundary"* (security fix; don't resurrect the old shape).

### 8.3 Registration / versioning gotchas
- **Version-shadowing:** registering a newer version at the same tail can reroute calls that pin an older version; pinned versions are honored by `contracts.execute()` — re-verify pinned calls after any re-registration.
- **Version monotonicity:** must be strictly greater; `version <x> is not higher than current version <y>`.
- **Tail length:** long tails pass registration but can be rejected downstream (delegation grants) — "Prefer a short tail from the start."
- **Tail charset:** `/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/`; never prefix `z:<tid>:` yourself; `canonical map name invalid` if you do.
- **`contract_id` is numeric** and required for map ACLs; `scriptName = z:<tid>:<tail>` is the invoke `contract_id`.

### 8.4 Identity / credits gotchas
- **Agent DID balance starts at zero** — separate from tenant balance; reuse of tenant key or any non-claim-page key → `InsufficientCreditError`. Get each agent its own claim-page key ("revisiting it mints a fresh key+credits each time").
- **DIDs are opaque** — never hardcode or derive `tenantDid`/`agentDid`; always read from the authenticated session (`did.value` / `t3n whoami`).
- **Org agents:** `org create` is **not idempotent** (every call mints a new org); `card-set` fails with `error: RPC Error: NotScopeWriter: signing user is not a writer for this scope` until you `t3n org writers-add --org … --scope agent-cards --writer "$(t3n whoami)"`; `setWriters` **replaces** the list (read-then-merge or you revoke everyone); writer verbs need SDK **4.25.0+**; `card-get` reads are metered too (`InsufficientCredit` = out of credits, not a card problem).
- **Agent keys minted in the TEE never leave it** — opaque bearer `t3n_key_<key-id>.<secret>`, shown once, unrecoverable; only a hash is stored on-ledger; present in `X-T3N-Api-Key` on `POST /api/invoke`.

### 8.5 Platform quirks
- **Sessions are node-affine:** *"the node that handles the handshake stores the session state in memory, and later requests in that session must return to that node."*
- **Charge-on-attempt metering:** you pay for fuel/host-fn budget even if the contract errors, panics, or runs out of tokens; writes roll back but consumed work is charged. Write conflicts drop the prepared charge; retries re-run and re-charge. *"handle contract-level failures as billable attempts; handle retry loops carefully."*
- **Client session crypto:** ML-KEM-768 handshake, HKDF-SHA256 directional keys (`t3n-session-v1-c2s` / `t3n-session-v1-s2c`), AES-256-GCM payloads with fresh 12-byte nonces; ledger private domain AES-256-GCM with nonce derived from Raft (term, index); CAS blobs AES-256-GCM under a separate CEK; node-to-node = libp2p Noise + mutual TDX attestation + Keccak-256 config-digest check.
- **Bundler friction** with the SDK's WASM component under Next.js/Turbopack, Vite, Webpack (documented as a "known rough edge").
- **`setEnvironment` default — docs contradict themselves:** the Quickstart says *"the public SDK defaults to testnet — set it explicitly"*; the reference page's own table (web-rendered copy, first fetch) said `Defaults to "production"` while the `.md` says `Defaults to "testnet" in the public build`. **Always call `setEnvironment("testnet")` explicitly.**
- **SDK naming drift:** the reference page lists `getScriptVersion(nodeUrl, scriptName)` while the invoke walkthrough uses `getContractVersion(nodeUrl, TENANT_SCRIPT)`; the walkthrough is the worked, runnable example — use `getContractVersion`.
- **SDK version pinning:** docs-changelog reports hackathon integrations referencing `@terminal3/t3n-sdk` `3.5.2`, `3.9.0`, `3.11.0` (unverified by Terminal 3); **npm registry (fetched 2026-09-01): `latest` = `5.5.0`, 125 versions published**, Node >= 18 for the CLI (>= 16 per old package metadata), `type: module`. Writer verbs require ≥ 4.25.0. Use `npx @terminal3/t3n-sdk` to always run latest.
- **No documented 1000-block limit or log caps:** despite the task brief's hypotheses, the official docs do **not** document any 1000-block limit, log line caps, or per-log size limits. What *is* documented: registration "size cap" (exact number unpublished), 16 KiB agent-card cap, `kv-store::scan` budget (`limit > 0`), WASM compute fuel + host-function budget, and the 65,536-byte payload guard in the reference example. If you hit an undocumented block/log limit on testnet, the docs direct you to the developer Telegram (`https://t.me/terminal3developer`) or `devrel@terminal3.io`.
- **Dead links discovered:** `/api-reference/openapi.json` and `/terminal-3-openapi.yml` (both listed in `/llms.txt`) return **404** as of 2026-09-01; the docs' REST table (21 paths, 24 operations, OpenAPI 3.0.3, `bearerAuth` + `x-api-token` on some endpoints, server `https://staging.terminal3.io`) is the only surviving record of the REST surface.
- **Community-only symbols (NOT confirmed by official docs — treat as leads):** `buildDelegationCredential()`, `canonicaliseCredential()`, `signCredential()`, `buildInvocationPreimage()`, `signAgentInvocation()` (reported as a standalone delegation-credential flow separate from `agent-auth-update`), `DelegationCustodialClient` (one team, possibly unfinished/internal), `getAuditEvents()` (exists but undocumented).

---

## 9. Product narrative — quotes for the MANDATE README

The docs never literally say "it is not the model that fails, it is the architecture around it" — **that exact sentence does not appear anywhere in the fetched docs.** The closest verified narrative lines (all verbatim, with sources) you can reuse:

- *"Protect user privacy by design by keeping sensitive data out of prompts, context windows, and application servers."* — Why T3 ADK
- *"Enable trusted agent actions including transactions, approvals, and interactions with external services using verifiable permissions and auditability."* — Why T3 ADK
- *"The contract can process user PII and call third-party APIs on a user's behalf, without your infrastructure — or you — ever seeing the plaintext."* — ADK Tour
- *"An AI agent doesn't get standing access to anything… No grant, no access — the contract still runs, the outbound call just gets denied."* — ADK Tour
- *"PII moves through the enclave, never through your code."* — ADK Tour (Step title)
- *"Hardware-attested mandates for AI agents, so every agentic action is bounded, logged, and provable for increased security and privacy."* — About (AI Agent Governance card) — **a direct hook for the name MANDATE**
- *"Sensitive data (e.g. payment credentials) stays in T3N, resolved inside a TEE, and never enter agent memory, context, or prompt history."* — Platform Overview
- *"Runtime policy enforcement: Define exactly what agents can access and do. Policies are evaluated at request time — not just at provisioning — so scope creep is blocked in flight."* — Platform Overview
- *"Every agent action is cryptographically signed and logged to an immutable Merkle-backed ledger. Export ready for any regulator, any time."* — Platform Overview
- *"Traditionally, platforms that store and process private data require you to blindly *trust the operator*… This trust is unverifiable and frequently compromised. T3N shifts this paradigm… replaces operator trust with cryptographic verification."* — Why T3N
- *"The blast radius of a leaked agent key is exactly whatever scripts, functions, and hosts a user has explicitly granted it, nothing more."* — Agent Auth
- *"Your contract — and anything logging or inspecting it — only ever sees the placeholder."* — ADK Tour (placeholders step)
- *"The only path to the key is through your contract code — no external observer, not the agent, not the calling developer, can read it back out."* — Seed API key into secrets map
- Payroll pitch (directly relevant to an enterprise agent): *"An AI agent–driven payroll flow on T3N addresses these challenges by enabling enterprise AI agents to execute payroll tasks under explicit, policy-bound delegation, with secure custody of sensitive payroll data, verifiable approvals, and auditable execution across HR, payroll, banking, benefits, and tax systems."* — Delegate Access to AI Agents

---

## SOURCES — every URL actually fetched (all HTTP-200 unless noted)

**Terminal 3 docs (https://docs.terminal3.io) — fetched via sitemap, web_extract, or raw `.md` (all `.md` variants are official, referenced from `/llms.txt`):**
1. https://docs.terminal3.io/sitemap.xml
2. https://docs.terminal3.io/llms.txt
3. https://docs.terminal3.io/developers/adk/overview/what-is-adk
4. https://docs.terminal3.io/developers/adk/overview/why-adk
5. https://docs.terminal3.io/developers/adk/overview/adk-tour
6. https://docs.terminal3.io/developers/adk/overview/agent-auth-adk
7. https://docs.terminal3.io/developers/adk/get-started/quickstart
8. https://docs.terminal3.io/developers/adk/get-started/prerequisites/request-test-tokens
9. https://docs.terminal3.io/developers/adk/get-started/prerequisites/set-up-dev-env
10. https://docs.terminal3.io/developers/adk/get-started/what-is-z-namespace
11. https://docs.terminal3.io/developers/adk/get-started/walkthrough/write-contract
12. https://docs.terminal3.io/developers/adk/get-started/walkthrough/build-contract
13. https://docs.terminal3.io/developers/adk/get-started/walkthrough/register-contract
14. https://docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract
15. https://docs.terminal3.io/developers/adk/get-started/walkthrough/test
16. https://docs.terminal3.io/developers/adk/tips/capabilities-from-wit-import
17. https://docs.terminal3.io/developers/adk/tips/create-kv-maps
18. https://docs.terminal3.io/developers/adk/tips/seed-api-key
19. https://docs.terminal3.io/developers/adk/tips/outbound-http-auth-by-user
20. https://docs.terminal3.io/developers/adk/tips/placeholders-outbound-calls
21. https://docs.terminal3.io/developers/adk/tips/common-errors
22. https://docs.terminal3.io/developers/adk/reference
23. https://docs.terminal3.io/developers/adk/changelog
24. https://docs.terminal3.io/developers/adk/support/ai-coding-assistants
25. https://docs.terminal3.io/developers/adk/use-cases/payroll-agent
26. https://docs.terminal3.io/developers/agents/register-agent
27. https://docs.terminal3.io/developers/agents/provision-org-agent
28. https://docs.terminal3.io/t3n/overview/what-is-t3n
29. https://docs.terminal3.io/t3n/overview/why-t3n
30. https://docs.terminal3.io/t3n/how-t3n-works/architecture
31. https://docs.terminal3.io/t3n/how-t3n-works/consensus
32. https://docs.terminal3.io/t3n/how-t3n-works/data-encryption
33. https://docs.terminal3.io/t3n/how-t3n-works/did
34. https://docs.terminal3.io/t3n/how-t3n-works/tees
35. https://docs.terminal3.io/t3n/how-t3n-works/host-api
36. https://docs.terminal3.io/t3n/how-t3n-works/tokens
37. https://docs.terminal3.io/t3n/how-t3n-works/z-namespace
38. https://docs.terminal3.io/t3n/use-cases/delegate-access-to-agent
39. https://docs.terminal3.io/t3n/use-cases/reusable-user-data
40. https://docs.terminal3.io/t3n/data-owner-guide/delegate-access
41. https://docs.terminal3.io/intro/about-t3
42. https://docs.terminal3.io/intro/platform
43. https://docs.terminal3.io/intro/components/did
44. https://docs.terminal3.io/intro/components/vc

**Official reference repo — Terminal-3/z-tenant-flight (github.com), all fetched raw from `main`:**
45. https://github.com/Terminal-3/z-tenant-flight (repo listing via API)
46. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/wit/world.wit
47. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/wit/deps/host-interfaces-2.1.0/package.wit
48. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/wit/deps/host-tenant-1.0.0/package.wit
49. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/Cargo.toml
50. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/.cargo/config.toml
51. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/src/lib.rs
52. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/src/search.rs
53. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/src/booking.rs
54. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/README.md

**npm registry:**
55. https://registry.npmjs.org/@terminal3/t3n-sdk (package metadata — `dist-tags.latest = "5.5.0"`, 125 versions; readme included in metadata fetch)

**404s explicitly confirmed (do NOT guess content from these):**
- https://docs.terminal3.io/api-reference/openapi.json → 404 "Asset not found"
- https://docs.terminal3.io/terminal-3-openapi.yml → 404
- https://docs.terminal3.io/openapi.json → 404
- https://staging.terminal3.io/openapi.json → 404 ("Cannot GET /openapi.json")
- https://docs.terminal3.io/developers/adk/support/t3-builder-tg → 404 (page listed in sitemap; no `.md` variant retrievable)

**Web searches used for discovery:** "Terminal 3 T3N ADK docs terminal3.io", "Terminal 3 agents docs TEE contract ADK reference" (both resolved to docs.terminal3.io). The browser tool was unavailable (remote-debugging approval wall), so all content above came from direct HTTP fetches of the official `.md`/HTML endpoints.

*All quotes above were copied verbatim from the fetched sources; any paraphrase is explicitly marked as such. Where the docs contradict themselves (setEnvironment default, getScriptVersion vs getContractVersion, placeholder_allowlist vs hard profile-namespace gate, manifest vs no-manifest), both sides are quoted and flagged.*
