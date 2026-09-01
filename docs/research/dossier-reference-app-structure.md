# T3N MANDATE — Reference-App Structure & Demo Design Dossier

**Scope:** Terminal 3 (T3N) official examples → what our MANDATE reference app should copy, and how to design its demo. Every claim below is tied to a URL in [SOURCES](#sources). Anything that could not be verified (404s, API-naming drift, profile-schema unknowns) is called out explicitly — nothing here is invented.

---

## 0. TL;DR — what the official examples actually are

| Ask | Verdict (verified) |
|---|---|
| Is there an official example repo? | **Yes — `Terminal-3/z-tenant-flight`** (public, 23 commits, v0.4.1): a Rust/WASM Duffel flight-booking contract that runs inside the Trinity TEE. It is the walkthrough's worked example end-to-end. |
| Is there an official example **host**? | **No single "host" repo.** The host is the Node/TS app from the Quickstart (`my-t3n-app` with `quickstart.ts`) plus code appended per walkthrough step — the docs' pattern is *two sibling folders*: `z-tenant-flight/` (Rust) + `my-t3n-app/` (TS). |
| Travel-booking use-case page? | **No dedicated page.** The travel use case *is* the walkthrough + `z-tenant-flight`; the "Individual → travel booking agent" flow also appears as a section of the platform use-case page. |
| Payroll / procurement use-case pages? | **No dedicated pages.** Both are sections of one platform page (`/t3n/use-cases/delegate-access-to-agent`). The ADK "Payroll Agent" page is a one-line redirect to it. |
| `{{profile.*}}` placeholder substitution? | **Core documented primitive** — `http-with-placeholders` host interface. Quoted verbatim below. |
| Revocation / egress denial? | **Documented**: `host/http.egress_denied` when the target host isn't on the user's grant's `allowedHosts`. |

**The single most important quote for our pitch** (ADK Tour, step 5):

> "It sends a request with `{{profile.field}}` placeholder markers, and the host substitutes the real values inside the enclave at the last moment. Your contract — and anything logging or inspecting it — only ever sees the placeholder."
> — https://docs.terminal3.io/developers/adk/overview/adk-tour.md

---

## 1. Official quickstart & walkthrough

### 1.1 Quickstart (the host-side starting point)

URL: https://docs.terminal3.io/developers/adk/get-started/quickstart — "Get your first authenticated call to Terminal 3 working in under 10 minutes. No Rust, no WASM, no blockchain knowledge required for this part."

Project shape (verbatim commands):

```bash
mkdir my-t3n-app && cd my-t3n-app
npm init -y
npm pkg set type=module        # required — the code below uses top-level await
npm install @terminal3/t3n-sdk tsx
export T3N_API_KEY="<the key you copied from the claim page>"
```

The connection code is a single `quickstart.ts` (imports from `@terminal3/t3n-sdk`): `setEnvironment("testnet")`, `loadWasmComponent()`, `eth_get_address(T3N_API_KEY)`, `new T3nClient({ trustAnchor: await fetchTrustedManifest("testnet"), wasmComponent, handlers: { EthSign: metamask_sign(address, undefined, T3N_API_KEY) } })`, then `await t3n.handshake(); const did = await t3n.authenticate(createEthAuthInput(address)); const tenantDid = did.value;`.

Key docs guidance we must replicate: **"append each new snippet to the bottom of this same `quickstart.ts`"** (the docs assume `t3n`/`tenantDid`/`tenant` stay in scope), and **"Never hardcode or derive your tenant DID … Always read it back from the authenticated session."**

### 1.2 The walkthrough (5 pages) — official structure

| Page | URL | What it does |
|---|---|---|
| 1. Write your TEE contract | https://docs.terminal3.io/developers/adk/get-started/walkthrough/write-contract | Clones `Terminal-3/z-tenant-flight`, explains every file (tree below) |
| 2. Build your TEE contract | https://docs.terminal3.io/developers/adk/get-started/walkthrough/build-contract | `rustup target add wasm32-wasip2` + `cargo build --target wasm32-wasip2 --release` → `target/wasm32-wasip2/release/z_tenant_flight.wasm`; verify with `wasm-tools component wit` |
| 3. Register your TEE contract | https://docs.terminal3.io/developers/adk/get-started/walkthrough/register-contract | `tenant.contracts.register({ tail, version, wasm })` → numeric `contract_id`; "The register payload is just `{ tail, version, wasm }`; there is no manifest." |
| 4. Invoke your TEE contract | https://docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract | Agent session + user signs `agent-auth-update` grant + `executeAndDecode` |
| 5. Test your TEE contract | https://docs.terminal3.io/developers/adk/get-started/walkthrough/test | Native `cargo test` on input-parsing guards; no harness, no `ContractError` enum |

Exact quotes worth reusing from registration: *"Registration does not run your code, create maps, seed secrets, or grant outbound HTTP access. It only stores the component and records the versioned contract entry for your tenant."* and the tail rule *"Do not include `z:<tid>:` in the `tail`"* with regex `tail must match /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/` (keep tails short — long tails hit stricter downstream limits).

### 1.3 Verified file tree — `Terminal-3/z-tenant-flight` (from GitHub API, `main`)

```
z-tenant-flight/
├── .cargo/
│   └── config.toml              # [build] target = "wasm32-wasip2"
├── .gitignore
├── Cargo.lock
├── Cargo.toml
├── README.md
├── src/
│   ├── lib.rs                   # wit-bindgen generate! + Guest impl, dispatches per-fn
│   ├── search.rs                # search-offers — Duffel search via host:interfaces/http (no PII)
│   └── booking.rs               # book-offer — Duffel order via http-with-placeholders (PII)
└── wit/
    ├── world.wit                # package z:tenant-flight@0.4.0; imports host interfaces; exports contracts
    └── deps/
        ├── host-interfaces-2.1.0/package.wit
        ├── host-outbox-1.0.0/package.wit
        └── host-tenant-1.0.0/package.wit
```

The docs' rendering of the tree (write-contract page) adds the annotations:

```
z-tenant-flight/
├── src/
│   ├── lib.rs          ← wit-bindgen entry point + Guest impl that dispatches to each fn
│   ├── search.rs       ← search-offers — Duffel search (no PII)
│   └── booking.rs      ← book-offer — Duffel booking (PII via http-with-placeholders)
├── wit/
│   ├── world.wit       ← the world your contract exports + the host interfaces it imports
│   └── deps/           ← vendored host interface packages (host-interfaces, host-tenant)
└── Cargo.toml
```

Note: the walkthrough keeps the Rust contract as a **separate project** from the TS app ("put it in its own folder alongside it, not inside it"; registration code then references `const WASM_PATH = "../z-tenant-flight/target/wasm32-wasip2/release/z_tenant_flight.wasm"`). There is no `host/` directory in the official repo — the host lives in the Quickstart app. We diverge deliberately (single distributable repo, see §3) and will note the deviation in the README.

### 1.4 The exact contract shape (verbatim from the repo)

**`wit/world.wit`** (the capability declaration — "Capabilities are determined entirely by which of these you import in `world.wit` — there's no separate manifest"):

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

interface contracts {
    record generic-input {
        input:        option<list<u8>>,
        user-profile: option<list<u8>>,
        context:      option<list<u8>>,
    }

    search-offers: func(req: generic-input) -> result<list<u8>, string>;
    book-offer:    func(req: generic-input) -> result<list<u8>, string>;
}
```

**`Cargo.toml`** (note the deliberate `cdylib + lib` trick):

```toml
[package]
name = "z-tenant-flight"
version = "0.4.1"
edition = "2021"

# crate-type cdylib is what makes the wasm32-wasip2 target emit a WASM
# *component* (not a bare module). Keep "lib" too so the business logic
# stays unit-testable natively.
[lib]
crate-type = ["cdylib", "lib"]

[dependencies]
wit-bindgen = { version = "0.49", default-features = false, features = ["macros", "realloc"] }
serde = { version = "1.0", default-features = false, features = ["derive", "alloc"] }
serde_json = { version = "1.0", default-features = false, features = ["alloc"] }

# Small, self-contained artifact — keeps registration under the size cap.
[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
strip = true
```

**`src/lib.rs`** — the dispatch skeleton (each exported function is its own export; "there is **no** `dispatch` function and **no** `ContractError` enum"):

```rust
wit_bindgen::generate!({
    world: "tenant-flight",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

mod booking;
mod search;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::tenant_flight::contracts::Guest for Component {
    fn search_offers(req: exports::z::tenant_flight::contracts::GenericInput) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("search-offers: missing input")?;
        search::search_offers(&input)
    }
    fn book_offer(req: exports::z::tenant_flight::contracts::GenericInput) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("book-offer: missing input")?;
        booking::book_offer(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);
```

**`src/booking.rs`** — the Duffel-style booking contract using `http-with-placeholders` (THE pattern our `pay-invoice` copies, with `{{profile.iban}}` in place of `{{profile.first_name}}`):

```rust
use crate::host::interfaces::http_with_placeholders as hwp;
use serde_json::json;

let order_body = json!({
    "data": {
        "type": "instant",
        "selected_offers": [req.offer_id],
        "passengers": [{
            "id": req.passenger_id,                              // opaque Duffel id — not PII
            // Resolved host-side from the user's profile (PII never enters WASM):
            "given_name":  "{{profile.first_name}}",
            "family_name": "{{profile.last_name}}",
            "born_on":     "{{profile.date_of_birth}}",
            "email":       "{{profile.verified_contacts.email.value}}",
        }],
        "payments": [{ "type": "balance", "amount": req.total_amount, "currency": req.total_currency }]
    }
});

let resp = hwp::call(&hwp::Request {
    method: hwp::Verb::Post,
    url: format!("{DUFFEL_BASE}/air/orders"),
    headers: Some(duffel_headers(&api_key)),
    payload: Some(serde_json::to_vec(&order_body).map_err(|e| e.to_string())?),
})
.map_err(|e| format!("duffel create-order: {}", format_http_error(e)))?;
```

The typed error renderer (proof that denial errors are first-class and PII-safe — reuse verbatim):

```rust
fn format_http_error(e: hwp::HttpError) -> String {
    match e {
        hwp::HttpError::EgressDenied(host)        => format!("egress denied for host {host}"),
        hwp::HttpError::PlaceholderDenied(marker) => format!("placeholder not permitted: {marker}"),
        hwp::HttpError::PlaceholderUnknown(field) => format!("user profile missing field: {field}"),
        hwp::HttpError::PlaceholderNoUserContext  => "no user context bound for placeholder resolution".to_string(),
        hwp::HttpError::UpstreamError(reason)     => format!("upstream: {reason}"),
    }
}
```

The scrub-the-response pattern (only the booking ID and PNR cross the WIT boundary; errors are logged inside the TEE and never forwarded):

```rust
if resp.code != 200 && resp.code != 201 {
    let _ = logging::error(&format!("Duffel create-order HTTP {}: {}", resp.code,
        String::from_utf8_lossy(&resp.payload)));
    return Err(format!("Duffel create-order failed: HTTP {}", resp.code));
}
let order: serde_json::Value = serde_json::from_slice(&resp.payload).map_err(|e| e.to_string())?;
let booking_id = order["data"]["id"].as_str().ok_or("Duffel response missing order id")?.to_string();
let pnr = order["data"]["booking_reference"].as_str().ok_or("Duffel response missing booking_reference")?.to_string();
// ... returns Booking { id, pnr, status } — the ONLY fields the caller ever sees.
```

Secrets pattern (API key lives in a tenant KV map, never a `secret` interface):

```rust
let tid = tenant_context::tenant_did();
let map_name = format!("z:{}:secrets", hex::encode(&tid));
let bytes = kv_store::get(&map_name, b"duffel_api_key")
    .map_err(|e| format!("kv read: {e}"))?
    .ok_or("duffel_api_key not found in z:<tid>:secrets — populate it via the tenant SDK before use")?;
String::from_utf8(bytes).map_err(|e| e.to_string())
```

README also declares the host-capability manifest JSON the walkthrough references: `{ "host_capabilities": ["kv_store", "logging", "tenant_context", "http"] }` (lib.rs extends it with `"http_with_placeholders"`).

### 1.5 The host that calls it (verbatim from walkthrough page 4)

Three sessions — tenant/agent/user — then a user-signed grant, then `executeAndDecode`:

```typescript
const agentKey = process.env.AGENT_KEY!; // a separate credential — never reuse your tenant's T3N_API_KEY
const agentAddress = eth_get_address(agentKey);
const agentClient = new T3nClient({
  trustAnchor: await fetchTrustedManifest("testnet"),
  wasmComponent,
  handlers: { EthSign: metamask_sign(agentAddress, undefined, agentKey) },
});
await agentClient.handshake();
const agentAuth = await agentClient.authenticate(createEthAuthInput(agentAddress));
const agentDid = agentAuth.value; // reused below when the user authorizes this agent

const TENANT_SCRIPT = `z:${tenantDid.slice("did:t3n:".length)}:travel-contracts`;
const scriptVersion = await getContractVersion(getNodeUrl(), TENANT_SCRIPT);
```

```typescript
// Signed by the USER (data owner), not the agent.
const userContractVersion = await getContractVersion(getNodeUrl(), "tee:user/contracts");
await userClient.execute({
  contract_id: "tee:user/contracts",
  contract_version: userContractVersion,
  function_name: "agent-auth-update",
  input: {
    agents: [{
      agentDid: agentDid,
      scripts: [{
        scriptName: TENANT_SCRIPT,
        versionReq: scriptVersion,
        functions: ["search-offers", "book-offer"],
        allowedHosts: ["api.duffel.com"],   // hosts the contract may dial
      }],
    }],
  },
});
```

```typescript
const booking = await agentClient.executeAndDecode({
  contract_id: TENANT_SCRIPT,
  contract_version: scriptVersion,
  function_name: "book-offer",
  input: {
    offer_id:       offer.id,
    passenger_id:   offer.passenger_ids[0],  // opaque Duffel id from search — not PII
    total_amount:   offer.total_amount,
    total_currency: offer.total_currency,
  },
});
// booking.pnr → the flight booking reference. The passenger's name never left the enclave.
```

**⚠️ Naming drift (verified, must handle):** the *current* fetched pages use `contract_id` / `contract_version` / `getContractVersion` / `tenant.contracts.register`; earlier search-engine snapshots of the same page use `script_name` / `getScriptVersion` and `z:<tid>:travel-contracts`. The SDK reference table confirms the current naming (`tenant.contracts.register({ tail, version, wasm })`, `getContractVersion(nodeUrl, contractId)`). Our host code should pin against the installed SDK's actual types and note both names in a comment.

### 1.6 Test shape (walkthrough page 5) — the "PII hygiene" tests we should copy

```rust
#[test]
fn book_offer_rejects_inline_pii() {
    let input = serde_json::to_vec(&serde_json::json!({
        "offer_id": "off_1",
        "passengers": [{ "given_name": "Jane" }],   // not a valid field
        "total_amount": "199.00", "total_currency": "GBP",
    })).unwrap();
    let err = book_offer(&input).unwrap_err();
    assert!(err.contains("bad input"));
}
```

Official test checklist: happy path `search-offers → book-offer`; input hygiene (any payload carrying passenger PII is rejected at parse time); **PII never in output** ("`passport`, `date_of_birth`, and name fields do not appear in any return value or log line"); and "The `{{profile.*}}` markers stay literal in the contract — resolution happens host-side, so they never appear resolved in WASM memory."

---

## 2. Use-case pages (travel booking, payroll, procurement)

### 2.1 What exists and what 404s (explicit)

- `https://docs.terminal3.io/developers/adk/use-cases/travel-booking.md` → **404 (does not exist)**.
- `https://docs.terminal3.io/developers/adk/use-cases/procurement.md` → **404 (does not exist)**.
- `https://docs.terminal3.io/t3n/use-cases/travel-booking.md` and `.../procurement.md` → **404/HTTP error (do not exist)**.
- `https://docs.terminal3.io/developers/adk/use-cases/payroll-agent.md` → exists but is a **one-line redirect**: "See [Delegate Access to AI Agents](/t3n/use-cases/delegate-access-to-agent#payroll)".
- The complete docs index (`https://docs.terminal3.io/llms.txt`) lists only four platform use-case pages: `delegate-access-to-agent`, `delegate-access-to-human`, `mpc`, `reusable-user-data`.

**Conclusion:** all three requested use cases live in **one** page — `https://docs.terminal3.io/t3n/use-cases/delegate-access-to-agent.md` — plus the walkthrough for travel. Payroll and procurement are *sections* ("### B2B Procurement", "### Payroll") under "## Enterprise"; travel booking is the "## Individual" flow.

### 2.2 Patterns & primitives per use case

**Travel booking (walkthrough + Individual flow).** Primitives: TEE contract (`z-tenant-flight`), `host:interfaces/http` (search, no PII), `http-with-placeholders` (booking), `kv-store` + `tenant-context` (secrets), `logging`, agent delegation via `agent-auth-update` with `functions` + `allowedHosts`, `executeAndDecode`. Pattern: *search with no PII → book with PII that never enters the agent or the contract; only `{ id, pnr, status }` comes back.*

Reusable quotes (Individual section): *"for these agents to complete "last-mile" transactions (e.g., confirming a flight booking with a payment), they often require access to highly sensitive user data, like payment details, passport numbers, credential, or API keys"*; *"When the AI agent is about to initiate the last-mile transaction (e.g., actual booking), instead of exposing the private user data to the agent, the AI agent interacts with T3N, which then securely delivers the required private user data directly to the third party (e.g., the airline's booking system)"*; *"T3N processes the third-party response (e.g., from the airline's booking system) before forwarding it, ensuring any private user data is processed first and not returned to the AI agent."*

**Payroll.** Primitives: delegation with policy constraints ("eligible employee groups, payroll calendar, approval thresholds, … funding limits"), TEE contract holding the "last-mile" payment instruction, placeholders for bank details, sanitized responses, append-only audit. Quote: *"they remain difficult to automate safely because AI agents must not be given direct access to employee PII, bank account details, payroll provider credentials, or treasury payment keys."* Step 7: *"instead of accessing employee bank details, payroll provider credentials, or treasury payment keys directly, the Payroll AI Agent submits a payroll execution instruction to T3N."* Step 10: *"T3N processes and sanitizes the execution responses before returning payroll status, exception details, and audit records to the Payroll AI Agent, ensuring sensitive employee and financial data is never exposed to the agent."* ← **this is our exact product sentence.**

**B2B Procurement.** Primitives: same delegation + "verifiable inter-agent communication" (buyer agent ↔ supplier agent over T3N), payment info stored once, sanitized responses to *both* agents. Quotes: *"enabling enterprise AI agents to transact on behalf of their organizations under explicit, policy-bound delegation, with secure data custody, verifiable inter-agent communication, and auditable execution"*; step 8: *"the Buyer AI Agent submits a payment instruction to T3N, which securely delivers the pre-configured payment info to the payment platform or enterprise system"*; step 9: *"T3N processes and sanitizes the response before returning a confirmation to the Buyer AI Agent and Supplier AI Agent, ensuring sensitive financial data is never exposed to either agent."*

The one page also carries the breach citations (UnitedHealth $190M exposure; Middle East call-center agent compromise) — reuse for the Problem slide.

---

## 3. Recommended repo structure for OUR reference app

Follow the official layout rules: contract = Rust crate compiled with `wasm32-wasip2` + vendored `wit/deps/`, host = ESM TS with `@terminal3/t3n-sdk`, secrets in a KV map, capabilities only from WIT imports. **Deliberate deviation (documented in README):** official docs keep contract and host as sibling folders; we merge them into one repo so the sponsor can distribute a single cloneable artifact.

```
mandate/                                  # = the distributable reference app
├── README.md                             # problem → quickstart → architecture → scoring map → handover
├── LICENSE                               # MIT (matches z-tenant-flight)
├── .gitignore
├── docs/
│   ├── ARCHITECTURE.md                   # diagrams: agent / z:<tid>:mandate-contracts (TDX) / mock rail
│   ├── DEMO-SCRIPT.md                    # the deterministic script from §5, with expected output
│   └── SUBMISSION.md                     # Google-Doc source (see §6)
│
├── contract/                             # Rust WASM crate — mirrors z-tenant-flight exactly
│   ├── Cargo.toml                        # crate-type = ["cdylib","lib"]; release profile opt-level="s"
│   ├── .cargo/config.toml                # [build] target = "wasm32-wasip2"
│   ├── src/
│   │   ├── lib.rs                        # wit_bindgen::generate! + Guest impl (one fn per export)
│   │   ├── kyc.rs                        # onboard-customer — http-with-placeholders → POST /kyc
│   │   └── pay.rs                        # pay-invoice — http-with-placeholders → POST /pay ({{profile.iban}})
│   ├── wit/
│   │   ├── world.wit                     # imports: tenant-context, logging, kv-store, http-with-placeholders
│   │   └── deps/                         # vendored host-interfaces-2.1.0/, host-tenant-1.0.0/
│   └── tests are #[cfg(test)] modules inside src/ (per walkthrough page 5)
│
├── host/                                 # TS host — mirrors quickstart.ts + walkthrough pages 3–4
│   ├── package.json                      # "type":"module"; @terminal3/t3n-sdk, tsx
│   ├── .env.example                      # T3N_API_KEY, AGENT_KEY, USER_KEY, RAIL_URL, CONTRACT_TAIL
│   └── src/
│       ├── connect.ts                    # T3nClient + authenticate → tenantDid / agentDid / userDid
│       ├── register.ts                   # tenant.contracts.register({tail,version,wasm})
│       ├── grant.ts                      # agent-auth-update (grant / revoke / scope hosts)
│       ├── run-demo.ts                   # deterministic demo: kyc → pay → revoke → pay(denied)
│       └── lib/
│           ├── rail-client.ts            # thin fetch wrapper for /kyc /pay /health
│           └── logger.ts                 # prefixes AGENT/RAIL lines; writes agent-output.log
│
├── mock-rail/                            # the "bank" (stands in for Duffel — see §4)
│   ├── package.json                      # express, tsx
│   └── src/server.ts                     # ~80 lines; POST /kyc, POST /pay, GET /health; writes rail.log
│
├── scripts/
│   ├── build-contract.sh                 # rustup target add wasm32-wasip2 && cargo build --release
│   ├── seed-secrets.ts                   # create z:<tid>:secrets map + set rail_api_key (map-entry-set)
│   ├── start-rail.sh                     # npx tsx mock-rail/src/server.ts > rail.log 2>&1 &
│   └── demo.sh                           # start-rail → register → grant → run-demo → revoke → assert
│
└── tests/
    ├── contract-native/                  # or kept inline; cargo test --lib runs from contract/
    └── e2e-asserts.sh                    # grep rail.log for real IBAN; grep agent-output.log for {{profile.iban}}; assert "egress denied" after revoke
```

Why this mirrors the official pattern: the contract crate is byte-for-byte shaped like `z-tenant-flight` (same build flags, same WIT imports minus `http` if we keep all egress PII-carrying); the host replicates the "append to the same TS file, keep `t3n`/`tenantDid` in scope" flow; the rail occupies the exact position Duffel occupies in the official diagram (`Agent → z:<tid>:contract → host (http-with-placeholders) → Duffel`).

---

## 4. Mock money-rail design (Express, ~80 lines)

The rail is our "Duffel": the third party the contract dials. Its two jobs: (1) **log the exact payload received** — the on-screen proof that `{{profile.*}}` markers were substituted inside the enclave before egress; (2) **return scrubbed responses** that never echo PII back (mirroring *"T3N processes and sanitizes the response before returning a confirmation"*).

```typescript
// mock-rail/src/server.ts — "the bank". Stands in for Duffel in the official
// walkthrough diagram. Logs the EXACT payload it receives (proving real-vs-
// placeholder substitution) and returns scrubbed responses (PII never echoes back).
import express from "express";
import { createHash } from "node:crypto";

const app = express();
app.use(express.json());

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// The on-screen proof: the rail logs what the HOST actually sent after
// resolving {{profile.*}} inside the enclave. Also appended to rail.log so the
// demo script can assert on it.
function logReceived(route: string, body: unknown) {
  const line = `[RAIL] ${route} ${new Date().toISOString()} payload=${JSON.stringify(body)}`;
  console.log(line);
  // process.env.RAIL_LOG? fs.appendFileSync("rail.log", line + "\n") : undefined
}

// --- KYC: identity data arrives substituted (legal_name, dob, ...). --------
app.post("/kyc", (req, res) => {
  logReceived("POST /kyc", req.body);
  // Scrubbed: enough signal for the agent to decide, no PII echoed.
  res.json({
    kyc_id: "kyc_" + Math.random().toString(36).slice(2, 10),
    status: "verified",
    risk_score: 12,
    checks: ["identity", "sanctions"],
  });
});

// --- PAY: bank details arrive substituted (iban, swift, legal_name). --------
app.post("/pay", (req, res) => {
  logReceived("POST /pay", req.body);
  // Scrubbed response. iban_sha256 lets the agent verify the rail received the
  // RIGHT account (compare with a hash the user computes locally) without the
  // plaintext IBAN ever appearing in agent logs.
  res.json({
    payment_id: "pay_" + Math.random().toString(36).slice(2, 10),
    status: "settled",
    trace: "T3N-MANDATE-DEMO",
    iban_sha256: sha256(String(req.body.iban ?? "")),
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.RAIL_PORT ?? 8787);
app.listen(PORT, () => console.log(`[RAIL] mock money rail listening on :${PORT}`));
```

Design rules:
- **Log verbatim, don't redact in the rail.** The whole point is that the rail (the "third party") legitimately sees plaintext — like Duffel does. The rail's stdout/log is the only place plaintext appears, which is the visual proof.
- **Never echo PII in responses.** `pay` returns only `payment_id/status/trace` + the IBAN **hash** (a deterministic proof-of-receipt that doubles as a demo flourish).
- **Two log sinks:** console (for the live demo, side-by-side with the agent's console) and `rail.log` (for scripted assertions).
- **`/health`** gives the demo script a ready signal (`curl -sf localhost:8787/health`).
- The rail needs no auth in the demo, but the contract still sends `Authorization: Bearer <rail_api_key>` read from the `secrets` KV map — so the "API key never leaves the enclave/KV store" story is exercised for real.

Contract side (pay.rs) — the substitution point our magic moment depends on:

```rust
let body = serde_json::json!({
    "beneficiary": {
        "legal_name": "{{profile.legal_name}}",
        "iban":       "{{profile.iban}}",
        "swift":      "{{profile.swift_bic}}",
    },
    "amount":   req.amount,
    "currency": "USD",
    "reference": format!("mandate-{}", req.invoice_id),
});
let resp = hwp::call(&hwp::Request {
    method: hwp::Verb::Post,
    url: format!("{RAIL_BASE}/pay"),
    headers: Some(rail_headers(&api_key)),
    payload: Some(serde_json::to_vec(&body).map_err(|e| e.to_string())?),
}).map_err(|e| format!("rail pay: {}", format_http_error(e)))?;
// → parse payment_id/status/iban_sha256 only; never forward the raw body.
```

⚠️ **Honest caveat (must verify at build time):** the docs say markers *"reference the user profile schema"* — the walkthrough schema demonstrably carries `first_name`, `last_name`, `date_of_birth`, `gender`, `verified_contacts.email.value` — and that *"Fields the schema doesn't carry yet (passport, title) are supplied by your contract directly."* Whether `{{profile.iban}}` / `{{profile.swift_bic}}` resolve depends on the profile schema of the cluster we get. **If IBAN isn't a profile field, the magic moment breaks** — so the onboarding step of the demo must seed the profile with an IBAN field (or we document a demo-hardcoded value exactly the way `z-tenant-flight` hardcodes `passport_number` and note the trade-off: hardcoding keeps the demo runnable but loses the magic moment). Decide during implementation; both paths are pre-planned.

---

## 5. Demo script — deterministic before → action → after

Runs as `scripts/demo.sh`; every step prints both the AGENT view and the RAIL view. Deterministic inputs (fixed `cus_1`, `inv_1`, amount `199.00`, seeded profile, fixed port 8787); the only nondeterminism is generated `pay_*`/`kyc_*` ids, which the script matches with wildcards.

**Preflight (one-time, also in README):** build + register contract (`z:<tid>:mandate-contracts`, functions `onboard-customer`, `pay-invoice`), create `secrets` KV map + seed `rail_api_key`, start rail, connect `tenant`/`agent`/`user` sessions, user signs grant with `functions: ["onboard-customer","pay-invoice"]`, `allowedHosts: ["localhost:8787"]`.

**BEAT 0 — BEFORE (state proof).**
- Show the grant exists (`grant.ts show`), rail healthy (`curl -sf :8787/health`).
- Prove plaintext is nowhere in the agent's world: `grep -r "GB29" host/ contract/ || echo "no plaintext in repo"` → exits 1. State: "the IBAN exists only in the user's T3N profile."

**BEAT 1 — KYC (action).** `npx tsx host/src/run-demo.ts kyc --customer cus_1`
- AGENT console: `onboard-customer → POST localhost:8787/kyc body: {"legal_name":"{{profile.legal_name}}","date_of_birth":"{{profile.date_of_birth}}"}  →  {kyc_id: kyc_*, status: "verified", risk_score: 12}` — markers still literal.
- RAIL console: `[RAIL] POST /kyc ... payload={"legal_name":"Ada Bank","date_of_birth":"1990-01-15",...}` — real values.
- Assert: rail.log contains `"legal_name"`; agent-output.log contains `{{profile.legal_name}}` and **not** `Ada Bank`.

**BEAT 2 — PAY, the MAGIC MOMENT (action).** `npx tsx host/src/run-demo.ts pay --invoice inv_1 --amount 199.00`
- AGENT console: `pay-invoice → POST localhost:8787/pay body: {"beneficiary":{"legal_name":"{{profile.legal_name}}","iban":"{{profile.iban}}","swift":"{{profile.swift_bic}}"},"amount":199.00}  →  {payment_id: pay_*, status: "settled", iban_sha256: 9f2a…}` — the agent's log still shows `{{profile.iban}}`.
- RAIL console (the magic moment, side by side): `[RAIL] POST /pay ... payload={"beneficiary":{"legal_name":"Ada Bank","iban":"GB29 NWBK 6016 1331 9268 19","swift":"NWBKGB2L"},...}` — **real bank details appear in the rail's log while the agent's log still shows `{{profile.iban}}`.** Same request, two views; plaintext existed only inside the enclave (host-side substitution) and at the rail.
- Verify substitution used the RIGHT value: locally compute `sha256("GB29 NWBK 6016 1331 9268 19")` and compare with `iban_sha256` in the agent's response — matches, without the IBAN ever appearing in agent output.
- Assert: rail.log contains `GB29 NWBK`; agent-output.log contains `{{profile.iban}}` and not `GB29`.

**BEAT 3 — REVOCATION (action).** `npx tsx host/src/grant.ts revoke --agent $AGENT_DID`
- User signs `agent-auth-update` with the agent removed (or `functions: []` / `allowedHosts: []`).
- Show: `grant.ts show` now lists no grants for the agent.

**BEAT 4 — REVOCATION PROOF (action).** `npx tsx host/src/run-demo.ts pay --invoice inv_2 --amount 50.00`
- AGENT console: the function **still runs** (contract executes), but `hwp::call` returns `HttpError::EgressDenied` → surfaced as `egress denied for host localhost:8787` (docs: the call "is denied with `host/http.egress_denied`"; "the contract still runs, but any outbound call is denied").
- RAIL console: **no new line** — nothing egressed. Assert: agent-output.log contains `egress denied`; rail.log line count unchanged.

**BEAT 5 — AFTER (state proof).**
- `grep -r "GB29" host/ contract/` → still nothing. The plaintext IBAN never touched the agent's machine, the host code, or the contract.
- Optional: pull the T3N append-only audit log for the two calls (tenant DID as first-class field) as the auditability slide.

**Failure modes to script around:** rail not started (`/health` check first), grant missing before beat 1 (same `egress denied` symptom — the docs' most common pitfall: *"the code is fine, but no grant authorizes the host"*), `placeholder not permitted: <marker>` if a marker isn't covered by the grant (bonus beat if time permits).

---

## 6. Submission documentation outline

### 6.1 Google Doc (the submission itself)

1. **Title block** — MANDATE: one line ("an agent that onboards a customer and runs their first payment — without ever seeing their identity or bank details"), team, links (repo, demo video, loom of the magic moment).
2. **Problem** — agents need last-mile financial access but can't be handed PII/bank details; cite the docs' breach examples (UnitedHealth, Middle East call-center agent compromise) and the docs' own framing: *"AI agents must not be given direct access to employee PII, bank account details, payroll provider credentials, or treasury payment keys."*
3. **Insight** — one primitive does the work: `http-with-placeholders`. The agent (and the host, and the contract) only ever sees `{{profile.iban}}`; the enclave substitutes the real value "just before the request goes out" — quote the ADK Tour sentence (§0). Delegation (not blanket trust) gates both function access and egress hosts.
4. **Architecture** — the official diagram shape (`Agent → z:<tid>:mandate-contracts → host (http-with-placeholders) → mock rail`) plus: KV `secrets` map for the rail API key, three sessions (tenant/agent/user), the `agent-auth-update` grant with `functions` + `allowedHosts`, scrubbed responses, `iban_sha256` proof. Link `docs/ARCHITECTURE.md`.
5. **The demo** — embed the 2-minute video: KYC beat, the magic moment (split-screen rail log vs agent log), revocation beat (`egress denied`). Link `docs/DEMO-SCRIPT.md`.
6. **How this is scored** — table mapping the (official) judging rubric rows to shipped features. Template rows (adjust to the actual hackathon rubric):

   | Rubric row | Shipped feature | Where |
   |---|---|---|
   | Working end-to-end demo | deterministic script: KYC → pay → revoke → denied, with assertions | `scripts/demo.sh`, §5 |
   | Use of T3N primitives | TEE contract (WIT imports), `http-with-placeholders`, KV secrets, delegation grant, `egress_denied` | `contract/wit/world.wit`, `host/src/grant.ts` |
   | Privacy/security posture | PII never in agent/host/contract; scrub on return; hash-proof of correct substitution | `contract/src/pay.rs`, `mock-rail/src/server.ts` |
   | Reproducibility / docs | README quickstart, `.env.example`, one-command demo | README, §3 tree |
   | Tests | native cargo tests incl. PII-hygiene rejects | `contract/src/*.rs` `#[cfg(test)]`, walkthrough page-5 checklist |
   | Innovation / story | "agent never sees the money" — magic moment + revocation | Demo video, §5 |

7. **Run it yourself** — five commands (below).
8. **Handover note (for Terminal 3 devrel)** — what makes it distributable: single repo, no secret in the tree (`.env.example` only), contract tail is short/stable (`mandate-contracts`), the rail is swappable — to go production, point `RAIL_BASE`/`allowedHosts` at a real money-rail (e.g. Stripe/Duffel-style API) and extend the profile schema for `iban`; note the `contract_id` vs `script_name` SDK-naming drift and the profile-schema caveat (§4) so future maintainers don't get stuck; license MIT.

### 6.2 README (repo front door)

1. What it is + one-sentence pitch + badges + architecture diagram (link `docs/ARCHITECTURE.md`).
2. **Run it yourself** (5 commands):
   ```bash
   git clone <repo> && cd mandate
   ./scripts/build-contract.sh                     # 1. contract → target/wasm32-wasip2/release/*.wasm
   ./scripts/start-rail.sh                         # 2. mock money rail on :8787 (writes rail.log)
   cd host && npm i && cp .env.example .env        # 3. fill T3N_API_KEY / AGENT_KEY / USER_KEY
   npx tsx src/register.ts && npx tsx src/grant.ts # 4. register contract + grant agent egress
   ./scripts/demo.sh                               # 5. deterministic demo incl. revocation beat
   ```
3. Repository layout table (the §3 tree).
4. Architecture section (three sessions, KV secrets, grant, placeholders, scrubbed responses).
5. Demo script summary + link.
6. Testing: `cargo test --lib`, `cargo clippy --all-targets -- -D warnings`, plus the walkthrough's PII-hygiene checklist verbatim.
7. Troubleshooting table (adapted from `register-contract` page: `tenant not found`, `version <x> is not higher than current version <y>`, contract can't read `secrets` → ACL missing `contractId`, re-registration allocates a new `contract_id` and stale map ACLs).
8. Known deviations & caveats: single-repo layout vs official sibling folders; `{{profile.iban}}` depends on profile schema (fallback: demo-hardcoded); SDK naming drift; testnet only.
9. License + handover note pointer.

---

## SOURCES (every URL actually fetched)

**Fetched successfully (HTTP 200), content used above:**
1. https://docs.terminal3.io/llms.txt — full docs index (the authoritative page map; disproves dedicated travel/procurement pages)
2. https://docs.terminal3.io/developers/adk/get-started/quickstart (+ `.md`) — Quickstart; project scaffold, `quickstart.ts` shape, `tenantDid` guidance
3. https://docs.terminal3.io/developers/adk/get-started/walkthrough/write-contract.md — walkthrough page 1: repo tree, `world.wit`, `Cargo.toml`, `lib.rs`, `search.rs`, `booking.rs`, secrets pattern, design rules
4. https://docs.terminal3.io/developers/adk/get-started/walkthrough/build-contract.md — page 2: build commands, artifact path, `wasm-tools`
5. https://docs.terminal3.io/developers/adk/get-started/walkthrough/register-contract.md — page 3: `tenant.contracts.register`, tail rules, troubleshooting table
6. https://docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract.md — page 4: agent/user sessions, `agent-auth-update` grant, `executeAndDecode`
7. https://docs.terminal3.io/developers/adk/get-started/walkthrough/test.md — page 5: native tests, PII-hygiene checklist
8. https://docs.terminal3.io/developers/adk/tips/placeholders-outbound-calls.md — `http-with-placeholders` mechanics, marker semantics, `placeholder not permitted`, `host/http.egress_denied`
9. https://docs.terminal3.io/developers/adk/tips/outbound-http-auth-by-user.md — egress resolved per-call from the user's grant; `host/http.egress_denied`
10. https://docs.terminal3.io/developers/adk/overview/adk-tour.md — the five-piece ADK shape; placeholder quote
11. https://docs.terminal3.io/developers/adk/get-started/what-is-z-namespace.md — `z:<tid>:` naming, TDX-enforced isolation, PII flows via placeholders
12. https://docs.terminal3.io/developers/adk/reference.md — SDK method table, naming conventions, WIT host-interface table (`http`, `http-with-placeholders`, `kv-store`, `tenant`, `logging`), REST surface, unconfirmed-API warning
13. https://docs.terminal3.io/developers/adk/use-cases/payroll-agent.md — exists; one-line redirect stub to delegate-access-to-agent#payroll
14. https://docs.terminal3.io/t3n/use-cases/delegate-access-to-agent.md — **the** use-case page: B2B Procurement, Payroll, Individual (travel) flows + breach citations
15. https://api.github.com/repos/Terminal-3/z-tenant-flight/git/trees/main?recursive=1 — verified full file tree (23 commits, main)
16. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/README.md
17. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/Cargo.toml
18. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/src/lib.rs
19. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/src/search.rs
20. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/src/booking.rs
21. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/wit/world.wit
22. https://raw.githubusercontent.com/Terminal-3/z-tenant-flight/main/.cargo/config.toml

**Confirmed NOT to exist (404 / HTTP error) — do not cite as pages:**
23. https://docs.terminal3.io/developers/adk/use-cases/travel-booking.md — 404
24. https://docs.terminal3.io/developers/adk/use-cases/procurement.md — 404
25. https://docs.terminal3.io/t3n/use-cases/travel-booking.md — 404/HTTP error
26. https://docs.terminal3.io/t3n/use-cases/procurement.md — 404/HTTP error

**Search-discovered (not deep-fetched; leads only):**
27. https://github.com/Terminal-3 — org profile (26 repos; `z-tenant-flight`, `adk-getting-start`, `adk-circle-call-centre-agent-demo` are the ADK-relevant ones)
28. https://github.com/ferdiii778/t3n-trusted-travel-agent — community T3N ADK travel-agent repo ("keeps provider credentials and passenger data outside the operational agent… Terminal 3 enforces delegated contract/function/host access") — worth skimming for host-side conventions
29. https://github.com/mansi0xc/aidlink/blob/main/BUGS.md — community "wall hit" log for `@terminal3/t3n-sdk@3.9.0` testnet — useful pitfall list

**Notable absences (verified):** no official `host/` directory in any public Terminal-3 repo; the SDK's exact profile schema (whether `iban`/`swift_bic` are profile fields) is not published in the fetched docs and must be confirmed against the installed SDK / live cluster.
