# Terminal 3 (T3N) ADK — Host/Auth Technical Dossier (for MANDATE agent host)

Research date: 2026-09-01. All quotes verbatim from the pages in SOURCES. SDK facts verified against the published npm package `@terminal3/t3n-sdk@5.5.0` (installed locally, types inspected). URLs that 404'd are flagged in SOURCES — nothing in this dossier is guessed.

> MANDATE mapping: our TypeScript agent host authenticates as its **own** DID (own `AGENT_KEY`, own credit balance), the data owner signs a scoped grant (`agent-auth-update` / modern `member-delegation-update`) naming exactly which contract functions + which outbound host we may use, and PII (`{{profile.*}}`) is substituted inside the TEE via `http-with-placeholders` — the agent never holds secrets. Every claim below is what the official docs + installed SDK types actually say.

---

## 1. SDK — package, version, install, minimal client

- **Package (exact):** `@terminal3/t3n-sdk` — "T3n TypeScript SDK - A minimal SDK that mirrors the server's RPC handler approach" (npm registry metadata). The `t3n` CLI ships inside it (`bin: { t3n: "dist/cli/index.js" }`). Source repo per npm: `git+https://github.com/Terminal-3/trinity.git`, directory `client/t3n-sdk`.
- **Version:** latest = **5.5.0** (npm `dist-tags.latest`, registry modified 2026-08-31; package created 2026-04-09). `engines: { node: ">=18.0.0" }`. Docs changelog notes: "Hackathon integrations have referenced `@terminal3/t3n-sdk` versions `3.5.2`, `3.9.0`, and `3.11.0` in the wild" (docs admit they have not confirmed an official release history). The org-agent writer verbs need **4.25.0 or newer** (see §8).
- **Install (docs Quickstart):**
  ```bash
  mkdir my-t3n-app && cd my-t3n-app
  npm init -y
  npm pkg set type=module        # required — the code below uses top-level await
  npm install @terminal3/t3n-sdk tsx
  ```
  CLI install (Register a Public Agent): `pnpm add -g @terminal3/t3n-sdk` then `t3n --help`; zero-install: `npx @terminal3/t3n-sdk --help` ("always runs the latest published version"). npm readme shows `pnpm add @terminal3/t3n-sdk`.
- **Minimal client (Quickstart, verbatim):**
  ```typescript
  import {
    T3nClient, setEnvironment, loadWasmComponent, eth_get_address,
    metamask_sign, createEthAuthInput, fetchTrustedManifest,
  } from "@terminal3/t3n-sdk";

  setEnvironment("testnet"); // the public SDK defaults to testnet — set it explicitly so your target cluster is unambiguous (and switch to "production" when you go live)

  const T3N_API_KEY = process.env.T3N_API_KEY!;
  const wasmComponent = await loadWasmComponent(); // all crypto runs inside this component
  const address = eth_get_address(T3N_API_KEY);

  const t3n = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"), // pins the node's attestation; node URL comes from setEnvironment above
    wasmComponent,
    handlers: {
      EthSign: metamask_sign(address, undefined, T3N_API_KEY),
    },
  });

  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));
  const tenantDid = did.value; // did:t3n:... — you'll reuse this exact variable in every later step
  ```
- **Confirmed exports in installed 5.5.0 types** (from `dist/index.d.ts` export list): `T3nClient`, `TenantClient` (+ `TenantNamespace`, `TenantMapsNamespace`, `TenantContractsNamespace`, `TenantTokenNamespace`), `setEnvironment`, `loadWasmComponent`, `eth_get_address`, `metamask_sign`, `createEthAuthInput`, `createOidcAuthInput`, `createEmailOtpAuthInput`, `createWorkloadAuthInput`, `fetchTrustedManifest`, `getNodeUrl`, `getContractVersion`, `invoke`, `getAuditEvents` (via `T3nClient`), `OrgDataClient`, `SessionOrgDataClient`, `createOrgDataClientFromSession`, `AGENT_CARDS_SCOPE`, `deriveAgentCardEntryId`, `parseAgentAuthGet`, `parseAgentAuthPolicy`, `mergeAgentAuthEntries`, `toAgentAuthUpdateWire`, `parseMemberDelegationDoc`, `mergeGrants`, `mergeDiscoverDids`, `discoverWhoami`, `discoverListContracts`, `discoverCheckDelegation`, `discoverDescribeContract`, `discoverDescribeFunction`, `createDefaultHandlers`, `UserUpsertError`, `KycStatusTimeoutError`, `TERMINAL_KYC_STATUSES`, `DEFAULT_KYC_POLL_CADENCE`, `Z_PAYROLL_AUDIT_READ_FUNCTIONS`, `Z_PAYROLL_RUN_FUNCTIONS`, `NODE_URLS`, `DEFAULT_ENVIRONMENT`, `tenantDidHex`, `validateTail`, `canonicalTenantName`.
- **Environment naming quirk:** docs Quickstart uses `setEnvironment("testnet")`; npm readme says `setEnvironment("sandbox" | "production")` with "`sandbox` — the public test network"; SDK type is `type Environment = "sandbox" | "testnet" | "production"`. Provision-org-agent docs: "All commands that talk to the network accept `--env sandbox|testnet|production`… `sandbox` and `testnet` are the same test network." Product page says "Set to sandbox". Treat `testnet`/`sandbox` as aliases of the same test cluster.
- **Node URL:** `getNodeUrl()` returns "the active cluster URL for the current environment" (reference table). `T3nClient` takes no `baseUrl` — "it's always resolved from the active environment" (common-errors gotcha). The **npm readme**, however, shows an optional `baseUrl` on `T3nClient` ("`baseUrl` takes precedence over the environment default") — the docs' gotcha table explicitly warns `TenantClient` *does* need `baseUrl: getNodeUrl()` (see §8).

---

## 2. Authentication flow — handshake → authenticate → read DID back

Three-step, identical for tenant, agent, and user sessions ("An agent authenticates the same way any T3N client does: handshake, then authenticate, then read its own DID back from the session. There's nothing tenant-specific to configure here." — Agent Auth page).

1. **Construct client** — `new T3nClient({ trustAnchor: await fetchTrustedManifest("testnet"), wasmComponent, handlers: { EthSign: metamask_sign(address, undefined, key) } })`. `trustAnchor` is required; "`fetchTrustedManifest` returns an operator-signed anchor, verified against a public key pinned in this package — it never returns an unverified one" (npm readme).
2. **`await client.handshake()`** — "Opens the encrypted session. Must be called before `authenticate()`." (SDK & API Reference table). Returns `HandshakeResult { sessionId }`; the session id is "Server-minted… Client code cannot set it — a client-supplied session id is rejected, closing the session-fixation vector" (SDK types).
3. **`const did = await client.authenticate(createEthAuthInput(address))`** — "Authenticates and returns your DID — always read `did.value` rather than constructing it yourself" (reference table). `Did { readonly value: string; toString(): string }`. "The network binds it to your key the first time you authenticate — so you don't compute it yourself, you read it back" (Register a Public Agent).
4. **Read the DID** — `const agentDid = did.value;` / `tenantDid = did.value;`. Format: `did:t3n:<40 hex characters>` — "an opaque, platform-assigned tenant or agent DID. Always read it back from the authenticated session — never construct or derive it" (reference table, naming conventions).

Hard warnings (Agent Auth page):
> "Never hard-code or derive an agent's DID any more than you would a tenant's — always read it back from the authenticated session… And generate `AGENT_KEY` as its own separate credential (the same way you'd generate any Ethereum-style keypair) — don't reuse your tenant's `T3N_API_KEY` for an agent."

And Quickstart: "**Never hardcode or derive your tenant DID.** It's not related to your wallet address — it's an opaque ID the platform assigns you the first time you sign in."

Other auth inputs confirmed in 5.5.0 types: `createOidcAuthInput({ provider, getIdToken(nonce) })` (npm readme example, Google provider), `createEmailOtpAuthInput`, `createWorkloadAuthInput(provider, idToken)`. Additional session methods: `addAuthMethod(authInput: EthAuthInput): Promise<Did>`, `getSelfEthAddress()`, `listUserWallets()`. SIWE-style challenge: "The key never leaves your machine; it's used locally to sign the login challenge" (npm readme).

**Agent session (verbatim, Agent Auth page §1):**
```typescript
import { T3nClient, loadWasmComponent, createEthAuthInput, eth_get_address, metamask_sign, fetchTrustedManifest } from "@terminal3/t3n-sdk";

const agentKey = process.env.AGENT_KEY!; // a separate key for the agent — never reuse your tenant's T3N_API_KEY
const agentAddress = eth_get_address(agentKey);

const agentClient = new T3nClient({
  trustAnchor: await fetchTrustedManifest("testnet"),
  wasmComponent,
  handlers: { EthSign: metamask_sign(agentAddress, undefined, agentKey) },
});

await agentClient.handshake();
const agentDid = await agentClient.authenticate(createEthAuthInput(agentAddress));
```

**Stateless alternative for org-minted agents (5.5.0):** `invoke<T>({ baseUrl, apiKey, request: { contract_id, contract_version, function_name, pii_did?, input? }, timeoutMs? }, schema?)` — "Execute a `z:` contract as an org agent, authenticating with an opaque API key — one request, no handshake, no session." The agent's key `t3n_key_<...>` is "relayed verbatim in the `X-T3N-Api-Key` header"; baseUrl "Must be `https:` unless the host is a local-dev loopback". `InvokeError` messages are fixed/generic and "NEVER contains the raw api key, the response body text, or the underlying network error's message".

---

## 3. Agent identity — creating a SEPARATE agent DID (distinct from the tenant key)

Two onboarding paths (docs): **public self-registered agent** and **organization-owned agent**. Both: *"This page gives an agent an identity and a card. It does not grant the agent access to anything — no user data, no contract functions. That's a separate step the data owner performs afterwards."*

### 3a. Public agent (self-registered) — `t3n` CLI
Flow (Register a Public Agent): "1. Download the SDK 2. Get the agent's key 3. Get the agent's DID 4. Scaffold the agent card 5. Host the agent card on T3N 6. Verify the registration".

- **Key:** "The agent's identity key is a standard Ethereum-style **secp256k1 private key** (32 bytes, `0x`-prefixed hex)." Get it from the claim page: "it issues a fresh key together with metered test credits every time, so you can revisit it once per agent, not just once for yourself. A key generated any other way (there is no `t3n keygen` command, but any tool that generates an Ethereum keypair produces a technically-usable one) starts with **zero** credits and can't pay for this step." Export: `export T3N_API_KEY="0x<the agent's private key>"`.
- **DID:** `t3n whoami --env testnet` → `did:t3n:1a2b3c...` ("Always read the DID back from `t3n whoami` (or `--json` for `{"did": "..."}`)").
- **Card:** `t3n agent create-card --did "$AGENT_DID"` → `agent-card.json`, ERC-8004 registration format, A2A/MCP/DID service entries, "Keep the whole card under **16 KiB**".
- **Host:** `t3n agent host-card --file agent-card.json --env testnet` → "card published: https://<node>/api/agent-card/did:t3n:1a2b3c..." — "stores the card **privately** under your DID, then publishes a public copy"; served byte-for-byte at `GET /api/agent-card/<did>`; takedown `t3n agent card-unpublish`; URI-only variant `t3n agent set-card --uri "<https url>"` records an `AgentService` endpoint (with `--no-card` to skip the default card).
- **Verify:** `curl https://<node>/api/agent-card/"$AGENT_DID"` and `t3n agent registry "$AGENT_DID" --env testnet`. DID document: `verificationMethod` of type `EcdsaSecp256k1RecoveryMethod2020` binding `blockchainAccountId: "eip155:1:0x<owner address>"`, plus `service` of `type: "AgentService"`. Under the hood, `host-card` "runs two writes on the built-in `tee:org-data/contracts` TEE contract" (stores card in self-owned `agent-cards` scope, then `agent-card-publish` copies it into the world-readable `public:agent_cards` map).

### 3b. Organization-owned agent (agent minted in the TEE — MANDATE-relevant)
Flow (Register an Organization-owned Agent): `t3n org create --name "Acme Robotics" --env testnet --json | jq -r .organisationDid` (⚠ "**not** idempotent — every call mints a *new* organization"), then:

```bash
t3n agent create \
  --org "$ORG_DID" \
  --name "Booking Bot" \
  --card agent-card.json \
  --env testnet
# agent created: did:t3n:1a2b3c...
# ⚠ API key (shown ONCE — store it now, it is the agent's credential):
#   t3n_key_43c008200b3a6c2c.6aab9ce6be8f33ba...
#   key id: 43c008200b3a6c2c
```

Critical quote:
> "The agent's secp256k1 key is minted **inside the TEE and never leaves it**; you never see a private key. What you get instead is an opaque bearer token, `t3n_key_<key-id>.<secret>`, of which only a hash is stored on-ledger — which is why it is unrecoverable rather than merely inconvenient to look up. The agent presents it verbatim in the `X-T3N-Api-Key` header of a stateless `POST /api/invoke`."

- **The API key is printed exactly once and cannot be recovered** — "Store it now — it is the agent's *own* credential". Scripting: `--json`, capture `.apiKey` + `.keyId` (the 16-hex id "safe to log"; the secret half is not).
- Card is hosted **privately** under the org; read back as admin: `t3n agent card-get --owner "$ORG_DID" --agent "$AGENT_DID" --env testnet`; public discovery is opt-in via `t3n agent card-publish` (reversible `card-unpublish`).
- **SDK equivalent (5.5.0 types):** `client.createAgent(organisationDid: string, name: string, options?: { agentUri?, card?, defaultCard? }): Promise<{ agentDid: Did; apiKey; keyId; agentUri?; cardEntryId? }>` — dispatched on `tee:organisation/contracts` (`organisation-create-self` for orgs). `createOrganisation(name): Promise<Did>`, `updateOrganisation`, `deleteOrganisation`, `addOrganisationMember`, `removeOrganisationMember`.
- **Credits:** "Registration is a write operation that consumes credits, and an agent's credit balance is separate from its tenant's" (Register a Public Agent). Agent Auth page: "That identity also needs its **own** test credits before any metered call on this page will work — an agent DID's balance is separate from its tenant's and starts at zero." Meters: `client.getBalance(): Promise<BalanceRow>`, `client.getUsage(opts): Promise<UsagePage>`, `formatTokens`/`toBaseUnits` (`TOKEN_DECIMALS`, `BASE_UNITS_PER_TOKEN`). Tokens are "currently non-transferable" (Tokens page). DID page: "Each DID can hold a T3N token balance."

---

## 4. Delegation / grants — `agent-auth-update` and the modern member-delegation surface

### 4a. The documented grant write (Agent Auth page, verbatim)
"Before an agent can invoke a contract function — especially one that makes an outbound HTTP call — the **user who owns the data** (the "data owner," not the agent, and not you as the tenant developer) has to explicitly grant that agent access":

```typescript
// Signed by the user (data owner), not the agent.
await userClient.execute({
  contract_id: "tee:user/contracts",
  contract_version: userContractVersion,
  function_name: "agent-auth-update",
  input: {
    agents: [{
      agentDid: agentDid,                 // the agent being authorized
      scripts: [{
        scriptName: TENANT_SCRIPT,        // z:<tid>:your-contract-tail
        versionReq: scriptVersion,
        functions: ["search-offers", "book-offer"],   // exactly which functions
        allowedHosts: ["api.duffel.com"], // exactly which external hosts
      }],
    }],
  },
});
```

- Wire/execute shape is strict (5.5.0 types): `contract_id` / `contract_version` / `function_name` (+ optional `pii_did`, `input`) — "the server deserialises strictly into `contract_id` / `contract_version` / `function_name` — sending `contract` / `version` / `function` produces `Invalid action request: missing field …` 400s". `contract_version` must be real SemVer (a literal `"latest"` is resolved client-side via `GET /api/contracts/current?name=…`).
- **Scoping is three-way at once** (Agent Auth): "A grant is scoped three ways at once: which contract, which functions on it, and which external hosts it may reach."
- **Denial:** "An agent with no matching grant can still call the contract — the call just fails at the point it tries to reach the network, with `host/http.egress_denied`." Full string from Common Errors table: `host/http.egress_denied: host '<host>' is not in the authorised_hosts allowlist`.
- **Self-grants:** "Direct (self) calls work the same way… they just grant to their own DID (a self-grant) instead of an agent's."
- **Egress rule (Outbound HTTP page):** "A tenant contract's outbound HTTP egress is resolved, on every call, from the **calling user's authorization grant**… Delegated call → the subject user's grant. Direct (self) call → the caller's own self-grant." Contracts never declare hosts at registration.

### 4b. Modern delegation surface — `MemberDelegationDoc` / `BoundGrant` (SDK 5.5.0)
The legacy `agent-auth-*` vocabulary is in a **deprecation window** in the current SDK. The docs' own note (Agent Auth page):
> "Some SDK type definitions reference a broader delegation-credential API… That surface isn't confirmed or documented yet… ask in the developer Telegram."

The installed SDK tells a fuller story — both surfaces exist; the modern one is `member-delegation`:

- **`MemberDelegationDoc`** = "The full delegation policy document — the shape of BOTH the `member-delegation-get` output and the `member-delegation-update` input (they are identical)": `{ grants: BoundGrant[]; discover_dids: string[] }`. Reads (`member-delegation-get`) and writes (`member-delegation-update`) on `tee:authorisations/contracts` are **SelfOnly** — "only the member, authenticated as themselves, may read or write their own grants." "The document IS the new state on a write: an empty `grants` list revokes all delegated access."
- **`BoundGrant`** (snake_case wire, verbatim): `grantee` (the `did:t3n:<40-hex>` principal), `contract_id` ("Target contract id (canonical name, e.g. `tee:z-payroll/contracts`), or `"*"`"), `functions` (`["*"]` = all), `scopes` ("Data scope paths the grantee may access (e.g. `example/records`)"), plus agent-edge qualifiers: `version_req?`, `read_scopes?`, `allowed_hosts?`, `window?: { valid_from_secs?, valid_until_secs? }` — "Agent edge only: optional validity time-box."
- **Validity window enforcement:** "The ≤ cap *length* check is enforced contract-side at write time; the expiry gate is host-side at read time." (SDK types, both surfaces.)
- **`T3nClient` methods (5.5.0, exact):**
  - `getMemberDelegation(): Promise<MemberDelegationDoc>`
  - `updateMemberDelegation(grant: BoundGrant, options?: { discoverDids?: string[] }): Promise<{ preservedRows: string[] }>` — read-merge-write, "the caller MUST be the delegating user, authenticated as themselves"
  - `memberDelegationUpdate(input: MemberDelegationDoc): Promise<void>` — full-document write (deprecates `agentAuthUpdate`)
  - `getAgentAuth(): Promise<AgentAuthPolicy>` (legacy camelCase; dispatches `agent-auth-get` on `tee:authorisations/contracts`, SelfOnly)
  - `updateAgentAuth(agentDid, grant: AgentAuthScriptGrant, options?): Promise<{ preservedRows }>` (legacy; "note it drops the leading `agentDid` argument — the `grantee` lives on the grant")
  - `agentAuthUpdate(input: AgentAuthUpdateInput): Promise<void>` (legacy; "an empty `agents` array revokes all agent access")
  - `revokeAgentAuthForOrg(orgTid)` (deprecated) / `revokeMemberDelegationForOrg(orgTid): Promise<void>` — "every grant targeting a `z:<orgTid>:*` contract is removed from the caller's own delegation document"
  - `checkDelegation(params: GrantCheckParams): Promise<GrantCheckResult>`
  - `listContracts(params?)`, `getAgentAuth`, plus org-data: `OrgDataClient` / `SessionOrgDataClient` (writers, secrets, data scopes, roles, egress: `SetAgentEgressInput`, `AgentEgressGetResponse` from `org-agent-egress-get`).
- **Legacy wire shape** (`toAgentAuthUpdateWire`): emits `agents: [{ agent_did, scripts: [...] }]`, `discover_dids?`; each script row carries `script_name`, `version_req`, `read_scopes`, `valid_from_secs`, `valid_until_secs`, `allowed_hosts`. "`functions` and `allowed_hosts` are always emitted — the contract requires explicit functions (`["*"]` = all) and reads an absent `allowed_hosts` as deny-all egress."
- **Grant check (pre-flight), `delegation.check`:** `GrantCheckParams { contract, pii_did, functions, scopes }` → `GrantCheckResult { authorised, disclosed, satisfied: DelegationGrantRef[], missing: DelegationGrantRef[] }` — "the `member_delegation ∩ org_delegation` verdict." Anti-enumeration: "`disclosed` is `true` only when the agent is registered under `pii_did`… `false` yields the uniform, non-disclosive verdict (`authorised:false, satisfied:[], missing:[]`)". Stateless variant: `discoverCheckDelegation(opts, params)`.

### 4c. Dashboard path & revocation (Delegate Access data-owner guide)
Grant via dashboard (testnet.network.terminal3.io → `AI Agents` tab → `New agent` → Agent DID → Authorized TEE contract → optional functions → optional Allowed hosts): "If optional fields are not specified, the agent will have access to all functions and hosts." **Revocation:** `AI Agents` tab → find agent → `Remove`. Agent Auth "Under the Hood":
> "a user can revoke an agent's access without the agent's key changing at all — they just stop re-issuing the grant."

Programmatic revocation: empty `agents`/`grants` document write, `revokeMemberDelegationForOrg`, or omit the grant and let egress fail. **Note: there is no documented `agent-auth-query` page/function** — the read/query surfaces are `agent-auth-get` (`getAgentAuth()`), `member-delegation-get` (`getMemberDelegation()`), `delegation.check` (`checkDelegation`), and `org-agent-egress-get`.

---

## 5. Host-side KV — tenant maps, z-namespace, control-plane vs data-plane

### Naming
- Canonical form: `z:<tid>:<tail>` where `<tid>` is "40-hex suffix of your tenant DID, `did:t3n:<tid>`". "Never include `z:<tid>:` yourself — pass only the local `tail`" (reference table). Example: `z:8f3a0123456789abcdef0123456789abcdefc91d:secrets`.
- Tail rules (Register contract): "letters, digits, `_`, `-`, and `.` — but **not** `/`"; SDK regex `tail must match /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/`. Keep tails short — "a handful of teams have hit unexpectedly-strict length limits further down the pipeline when using long tails" (delegation grants).
- Public maps: `z:<tid>:public:<tail>` + `visibility = "public"`; "world-readable via `/api/dev/public-kv/<tid>/<tail>`" and "Never put PII here".

### Control plane (host/tenant side — MANDATE's host writes)
- Create (Create Tenant KV Maps, verbatim):
  ```typescript
  await tenant.maps.create({
    tail: "secrets",
    visibility: "private",
    writers: { only: [contractId] },
    readers: { only: [contractId] },  // REQUIRED — the kv-governor denies reads when omitted
  });
  ```
  "`readers` **must** be set explicitly — the KV governor defaults to **deny**, so leaving it off makes the contract's own secret read fail with `AccessDenied`."
- Seed a secret (Seed API key, verbatim) — runs on the authenticated `tee:tenant/contracts` path, "not an agent call":
  ```typescript
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("secrets"),
    key:      "duffel_api_key",
    value:    process.env.DUFFEL_API_KEY!,
  });
  ```
- Owner overrides ACLs: "`writers`/`readers` restrict your **contracts**, not you. As the map's owner you can always write its entries directly via the control plane (`tenant.executeControl("map-entry-set", …)`)… A contract-only map is **not** tamper-proof against its owner" (z-namespace Access model warning).
- Full `TenantMapsNamespace` (5.5.0): `create(MapCreateInput, opts?)`, `update(tail, patch, opts?)`, `delete(tail, opts?)`, `entrySet(tail, key, value, opts?)` (`map-entry-set`), `entryGet(tail, key, opts?): Promise<string | null>` (`map-entry-get`; "`null` is the deliberate 'key absent' signal"), `getStatus(tail): Promise<MapLifecycleStatus>` (`map-get-status`; `"active" | "deleting" | "absent"`). `TenantClient.canonicalName(tail)`, `canonicalNameForTarget(tail, tenantTarget?)`, `controlPayload(fn, input)`, `executeControl(fn, input)`, `executeBusinessContract(session, options)`.

### Data plane (inside the contract — what the TEE does with the map)
- `kv-store` host interface: "Read / write / delete entries in the contract's namespaced key-value maps. Writes participate in the same atomic transaction as the rest of the call." Reads take the **full canonical name** and a byte-string key:
  ```rust
  let tid = tenant_context::tenant_did();               // raw bytes (list<u8>)
  let map_name = format!("z:{}:secrets", hex::encode(&tid));
  let bytes = kv_store::get(&map_name, b"duffel_api_key")...;
  ```
- Isolation: "The cluster enforces one rule at hardware level: a contract can only read or write maps whose prefix matches its own `<tid>`… the check runs inside the TDX enclave at every transaction" (What is z-namespace). Cross-tenant reads "denied unless the map owner explicitly grants another tenant contract access".
- User PII (`users` system map) is **unreachable** from tenant contracts: "Do not expect tenant contracts to read platform maps directly" — PII flows only via `http-with-placeholders` (§7).

---

## 6. Logging & audit surfaces available to the host

Three distinct surfaces (SDK 5.5.0 types are explicit):

1. **In-enclave logging** — host interface `logging`: "Emit `info` / `debug` / `error` log lines" (Host API table; gating: None). SDK side: `createLogger`, `setGlobalLogLevel`, `getLogger`, `LogLevel`.
2. **Audit events** — `audit.get-mine` → `client.getAuditEvents(opts?: { pii_did?, limit?, cursor? }): Promise<AuditPage>`. "A tenant contract emits an audit event via the `logging::audit` host call; the host stamps the identity fields (`subject` / `actor` / `vc_id`) from the verified dispatch context, so a contract can never forge who acted or on whom. Events are permanent (encrypted, append-only)". Shapes:
   - `AuditEvent { ts_ms, subject, actor, vc_id?: string|null, action, target, outcome, details? }` — "On a self-call `actor === subject` and `vc_id` is `null`; on a delegated call `actor` is the agent and `vc_id` is the delegation credential."
   - `AuditBatch { key, committed: boolean, events }` — "`false` means the call rolled back or trapped, so an event's `outcome: "success"` in this batch is the contract's *claim*, not a committed fact."
   - `AuditPage { batches, next_cursor? }`.
   - With `pii_did` set: "read, as a delegated agent, the events you performed for them — admitted only while that user's delegation grant to you is live."
3. **Activity log (node `auditlog` RPC, org-scoped)** — `getActivityLog(opts): Promise<ActivityReport>`, `startActivityLogExport(opts): Promise<string>`, `getActivityLogExportStatus(exportId)`, `downloadActivityLogExport(exportId)`, `exportActivityLog(opts, poll?)`. `ActivityEntry { seq_no, hash, timestamp_ms, caller_type: "agent"|"human", actor, on_behalf_of, org, contract, function, outcome: "success"|"denied"|"error", roles? }` — "Entries are reconstructed from the append-only ledger on read, so `seq_no` (the ledger index) and `hash` are derived server-side… Scope is the caller's **own organisation**… Metadata only — DIDs, never display names, call arguments, or payloads." `seq_no` is the ordering key ("timestamp_ms is per-node wall clock… order by `seq_no`"); page until `next_seq` is `null`, "never on a short or empty page". Unknown filter fields are rejected (400) rather than ignored.
4. **Debug contract logs** — `getContractLogs`: "the evicting debug ring" (distinct from permanent audit).
5. **Metering/ledger** — `getUsage(): Promise<UsagePage { balance, entries, next_cursor? }>`, `getBalance()`; `TokenTxKind = "mint" | "burn" | "charge" | "transfer" | "bridge_mint_attest" | "bridge_burn_attest"`. Tokens: "the operation and its associated token charge are processed as a single atomic transaction"; "charge-on-attempt" — "If a contract starts and consumes cluster resources, the caller pays… even if the contract later returns an error, panics, or runs out of token" (Tokens page).

Docs narrative: "Every operation your contract performs lands in the cluster's append-only audit log with your tenant DID as a first-class field" (What is z-namespace); "The T3 ADK wraps every outbound action your agent takes — verifying identity, substituting sensitive references inside a TEE, and **writing an audit row to the ledger** — before it ever reaches the destination system" (products page).

---

## 7. Walkthrough example — Duffel flight booking (`z-tenant-flight`)

Repo: `git clone https://github.com/Terminal-3/z-tenant-flight.git` (docs say this is the reference implementation; the repo itself was not reachable anonymously from this environment — see SOURCES).

### 7a. Host-side (TypeScript) — the exact structure the MANDATE host mirrors
From "4. Invoke your TEE contract" (all code verbatim):

```typescript
// 1. Set up the agent's identity — a separate authenticated session with its own key
import { T3nClient, loadWasmComponent, createEthAuthInput, eth_get_address, metamask_sign, getContractVersion, getNodeUrl, fetchTrustedManifest } from "@terminal3/t3n-sdk";

const agentKey = process.env.AGENT_KEY!; // a separate credential — never reuse your tenant's T3N_API_KEY
const agentAddress = eth_get_address(agentKey);

const agentClient = new T3nClient({
  trustAnchor: await fetchTrustedManifest("testnet"),
  wasmComponent,   // node URL resolved from setEnvironment() — see set-up-dev-env
  handlers: { EthSign: metamask_sign(agentAddress, undefined, agentKey) },
});

await agentClient.handshake();
const agentAuth = await agentClient.authenticate(createEthAuthInput(agentAddress));
const agentDid = agentAuth.value; // reused below when the user authorizes this agent

const TENANT_SCRIPT = `z:${tenantDid.slice("did:t3n:".length)}:travel-contracts`;
const scriptVersion = await getContractVersion(getNodeUrl(), TENANT_SCRIPT);
```

```typescript
// 2. Authorize the contract's egress (as the user / data owner) — a THIRD session
const userKey = process.env.USER_KEY!; // stands in for the real data owner's own key
const userAddress = eth_get_address(userKey);
const userClient = new T3nClient({
  trustAnchor: await fetchTrustedManifest("testnet"),
  wasmComponent,
  handlers: { EthSign: metamask_sign(userAddress, undefined, userKey) },
});
await userClient.handshake();
await userClient.authenticate(createEthAuthInput(userAddress));

const userContractVersion = await getContractVersion(getNodeUrl(), "tee:user/contracts");
await userClient.execute({
  contract_id: "tee:user/contracts",
  contract_version: userContractVersion,
  function_name: "agent-auth-update",
  input: {
    agents: [{
      agentDid: agentDid,                               // from step 1
      scripts: [{
        scriptName: TENANT_SCRIPT,                      // z:<tid>:travel-contracts, from step 1
        versionReq: scriptVersion,
        functions: ["search-offers", "book-offer"],
        allowedHosts: ["api.duffel.com"],               // hosts the contract may dial
      }],
    }],
  },
});
```

```typescript
// 3. Invoke your contract (as the agent) — results handled via executeAndDecode
const search = await agentClient.executeAndDecode({
  contract_id: TENANT_SCRIPT,
  contract_version: scriptVersion,
  function_name: "search-offers",
  input: { origin: "LHR", destination: "JFK", departure_date: "2026-07-15", cabin_class: "economy", adult_count: 1 },
});
const offer = search.offers[0];

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

Key mechanics: three sessions (tenant, agent, user) built identically; "Agents call your contract via the same `execute` transport as any other T3N contract. The only difference is the `contract_id` starts with `z:<tid>:`"; registration/ACL on the tenant session; grant signed by user; invocation by agent. `executeAndDecode<T>(payload, schema?)` "JSON-parses the response and optionally validates it with a schema" (any `.parse(value)` validator, e.g. zod); raw string variant `execute(payload): Promise<string>`; `executeWithBlob(payload, blob)` for multipart.

### 7b. Contract-side (Rust) — the other half of the flow
- `world.wit`: imports `host:tenant/tenant-context@1.0.0`, `host:interfaces/logging@2.1.0`, `kv-store@2.1.0`, `http@2.1.0`, `http-with-placeholders@2.1.0`; exports `contracts` with `search-offers: func(req: generic-input) -> result<list<u8>, string>` and `book-offer`. "There is no central `dispatch` function and no `ContractError` enum — the function name *is* the export." "The interfaces you import here are your contract's entire capability set — there is no separate manifest."
- `search.rs` — synchronous `http::call(&Request { method: Verb::Post, url: "{DUFFEL_BASE}/air/offer_requests?return_offers=false", headers, payload })`; checks `resp.code != 201` → `Err(format!("Duffel offer-request failed: HTTP {} — {body}", resp.code))`.
- `booking.rs` — `http-with-placeholders`; PII markers resolved host-side inside the enclave:
  ```rust
  "given_name":  "{{profile.first_name}}",
  "family_name": "{{profile.last_name}}",
  "born_on":     "{{profile.date_of_birth}}",
  "email":       "{{profile.verified_contacts.email.value}}",
  ```
  Typed `hwp::HttpError` variants (match for clean messages): `EgressDenied(host)` → "egress denied for host {host}", `PlaceholderDenied(marker)` → "placeholder not permitted: {marker}", `PlaceholderUnknown(field)` → "user profile missing field: {field}", `PlaceholderNoUserContext`, `UpstreamError(reason)`. Errors never leak resolved PII.
- API key read: `kv_store::get(&format!("z:{}:secrets", hex::encode(&tenant_did())), b"duffel_api_key")` — contract-authored error when unseeded: `duffel_api_key not found in z:<tid>:secrets — populate it via the tenant SDK` (Common Errors note).

**MANDATE note on placeholders:** the documented profile fields are `{{profile.first_name}}`, `{{profile.last_name}}`, `{{profile.date_of_birth}}`, `{{profile.verified_contacts.email.value}}`. The `{{profile.iban}}` / `{{profile.id_document}}` style markers from our flow are *not* in the docs' placeholder list — the placeholders page says "Fields the schema doesn't carry yet (passport, title) are supplied by your contract directly." The SDK's `UserInputProfile` (slim `user-upsert` input) carries `first_name, last_name, country_of_residence, document_issuance_country, ssn, address, email_address, phone_number, campaign_code, role` + open `[key: string]: unknown` — so custom fields are storable, but a custom marker's resolvability depends on the cluster's user-profile contract schema. Verify against your target cluster before relying on `{{profile.iban}}`.

---

## 8. BUGS / GOTCHAS — every documented error code, quirk, and version pin

Error envelope (Common Errors): "Errors come back as a JSON-RPC **`bad_request`** (HTTP 400) with `{ code: "bad_request", detail, request_id }`. The SDK throws with `detail` — a human-readable message string, **not** a typed error object. Match on the substring shown below." "User-authentication failures additionally carry a **machine code at the front** of `detail` (e.g. `eth_authenticator_limit: …`), so the SDK can branch with a single `startsWith`."

| String (in `detail`) | Meaning / fix |
|---|---|
| `version <x> is not higher than current version <y>` | re-registering a contract at a non-greater version → bump `version` |
| `map already exists` | re-running `maps.create` — "Idempotent — safe to ignore on re-runs" |
| `map not found` | map tail mismatch between `maps.create` and Rust `kv_store::get`/`put` |
| `canonical map name invalid: <reason>` | tail empty, contains `..`, or **starts with `z:`** — pass only the local tail |
| `quota exceeded: <dim>` (e.g. `quota exceeded: max_contracts`) | per-tenant quota — ask cluster operator |
| `access denied: <caller> cannot <op> map "<map>"` | contract not on map's `readers`/`writers` ACL → `tenant.maps.update` |
| `tenant is suspended` | operator suspended the tenant |
| `host/http.egress_denied: host '<host>' is not in the authorised_hosts allowlist` | host not on the caller's grant's `allowed_hosts` (most common failure — "the code is fine, but no grant authorizes the host") |
| `InsufficientCreditError` (agent metered call) / `InsufficientCredit` (reads) | "Metered calls are charged against the **calling identity's own** T3N credit balance — an agent DID's balance is separate from its tenant's, and starts at zero" — get the agent its own claim-page key |
| `placeholder not permitted: <marker>` | marker not in the user's delegation / placeholder allowlist |
| `placeholder not permitted` / `host/http.egress_denied` | same egress rule applies to `http-with-placeholders` |
| Auth codes (prefix of `detail`): `eth_authenticator_limit`, `eth_auth_map_conflict`, `email_not_verified`, `user_not_found`, `legacy_field` | wallet cap (11th), wallet linked to another DID, profile upsert before email OTP, no profile, pre-2.0.0 dispatch field |

Bare **HTTP 500** triage (Common Errors): 1) grab `request_id`; 2) re-check egress + map ACLs first ("A missing outbound-host grant or a missing map ACL entry can surface as a 500"); 3) "Retry once, deliberately" (single unhealthy node); 4) if consistent, report with `request_id`.

**Integration gotchas (Common Errors table, verbatim):**
- `tenant_did()` returns raw bytes (`list<u8>`) — "Using it directly (or formatting it with `{}`) is wrong and won't compile" — must hex-encode: `format!("z:{}:secrets", hex::encode(&tenant_did()))`.
- `TenantClient` + `baseUrl`: "calls can still fail at request time without it, even after calling `setEnvironment()`" — always pass `baseUrl: getNodeUrl()` explicitly. (`T3nClient` doesn't take `baseUrl`; resolved from environment.)
- **Re-registration allocates a NEW `contract_id`** (Register contract warning): "there is currently no API to fetch a tail's current `contract_id` after re-registering, so if you created map ACLs scoped to the old `contract_id`, a re-registration can leave them pointing at a stale id. Keep a record of each `contract_id`." Unpinned calls resolve to latest via `getContractVersion()`; pinned versions honored by `contracts.execute()`.
- **Long tails** rejected further downstream (delegation grants) even though registration accepts up to 128 chars — keep tails short.
- **WASM/bundler:** "A handful of teams have hit WASM-loading errors under Next.js/Turbopack, Vite, and older Webpack setups — the SDK loads a WASM component, and some bundlers try to process it in ways that break it" — try plain Node first; Next.js: external-packages/no-bundle exception for `@terminal3/t3n-sdk`. "We're tracking this as a known rough edge."
- `readers` omitted on `maps.create` → map created but **deny-all** — "nobody — not even the creator — can read it, with no error" (5.5.0 `MapCreateInput` doc; `maps.create` emits a `console.warn`).
- **`agent-auth-*` deprecated in SDK 5.5.0** in favor of `member-delegation-*` (documented in types: "the delegation-vocabulary deprecation window"); `getAgentAuth`/`updateAgentAuth`/`agentAuthUpdate`/`revokeAgentAuthForOrg` all carry `@deprecated` — use `getMemberDelegation`/`updateMemberDelegation`/`memberDelegationUpdate`/`revokeMemberDelegationForOrg` and the flat `BoundGrant` shape.
- **`member-delegation` expiry/caps:** length cap enforced contract-side at write; **expiry enforced host-side at read** — a grant with `valid_until_secs` in the past silently stops working (no error surface documented).
- **`map-entry-get` version pin:** "Requires the paired contract-side 1.24.0-or-later registration for the `tenant` argument to be accepted — a node on an earlier contract rejects `tenant`-bearing requests with `deny_unknown_fields`" (5.5.0 types).
- **Org writer semantics** (provision-org-agent): `error: RPC Error: NotScopeWriter: signing user is not a writer for this scope` — "admins manage policy, writers manage data"; `org writers-add/remove` are merge ops, `writers-set` **replaces the whole list**, `writers-clear` removes everyone; "two admins editing the same scope at the same moment can overwrite each other"; SDK fallback `SessionOrgDataClient` + `AGENT_CARDS_SCOPE` — `setWriters` **replaces** ("read it first and merge, or you will revoke every other writer"). Writer verbs need SDK **4.25.0+**.
- **Org creation not idempotent:** "every call mints a *new* organization… re-running it because you lost the DID leaves an orphan org behind".
- **Environment aliases:** `sandbox` ≡ `testnet` (same test network); `--env sandbox|testnet|production` or `T3N_ENV`.
- **Docs-vs-SDK drift to be aware of:** docs reference page (as of 2026-07-06) marks `getAuditEvents()` as "Reported to exist but undocumented" — **it is a real, typed `T3nClient` method in 5.5.0**. The docs' "community-only, not confirmed" list (`buildDelegationCredential()`, `canonicaliseCredential()`, `signCredential()`, `buildInvocationPreimage()`, `signAgentInvocation()`, `DelegationCustodialClient`) — **none of these exist in the installed 5.5.0 export list/types**; treat as unverified (docs say ask in Telegram before using).
- **`InvokeRequest` field names are load-bearing:** "`contract` / `version` / `function` produce a 400" — must be `contract_id` / `contract_version` / `function_name`. `contract_version` must be SemVer (`"latest"` resolved via `GET /api/contracts/current?name=…`).
- **Stateless `invoke`:** HTTPS required except loopback; `InvokeError` fixed generic messages, never leaks the API key or response body.
- **Docs 404s found (do not rely on them):** `https://docs.terminal3.io/terminal-3-openapi.yml` → 404; `https://docs.terminal3.io/api-reference/openapi.json` → 404 ("Asset not found") — despite being linked from llms.txt and the reference page's claim of "21 paths, 24 operations, OpenAPI 3.0.3". Also `https://github.com/Terminal-3/trinity` contents (npm `repository` target) → 404 anonymously (private); `raw.githubusercontent.com/Terminal-3/trinity/main/client/t3n-sdk/README.md` → 404. Hackathon repos (e.g. `github.com/iamaanahmad/terminal3-adk`) are community material, not official docs.

---

## 9. Product-narrative quotes (README-ready)

- "**Agents act on delegated permission, not blanket trust.** An AI agent doesn't get standing access to anything… No grant, no access — the contract still runs, the outbound call just gets denied." (ADK Tour)
- "**PII moves through the enclave, never through your code.** … it sends a request with `{{profile.field}}` placeholder markers, and the host substitutes the real values inside the enclave at the last moment. Your contract — and anything logging or inspecting it — only ever sees the placeholder." (ADK Tour)
- "The T3 ADK wraps every outbound action your agent takes — verifying identity, substituting sensitive references inside a TEE, and writing an audit row to the ledger — before it ever reaches the destination system." (terminal3.io products page)
- "Splitting authentication from authorization means a compromised or misbehaving agent key doesn't automatically mean compromised data access — the blast radius of a leaked agent key is exactly whatever scripts, functions, and hosts a user has explicitly granted it, nothing more." (Agent Auth)
- "a user can revoke an agent's access without the agent's key changing at all — they just stop re-issuing the grant." (Agent Auth)
- "Being authenticated is not being authorized." (Agent Auth page title §2)
- "An agent has its own identity — its own key pair and its own DID — separate from the tenant that owns the contract it's calling." (Agent Auth)
- "The contract can process user PII and call third-party APIs on a user's behalf, without your infrastructure — or you — ever seeing the plaintext." (ADK Tour, TEE contract)
- "When the AI agent is about to initiate the last-mile transaction… instead of exposing the private user data to the agent, the AI agent interacts with T3N, which then securely delivers the required private user data directly to the third party." (Delegate Access to AI Agents — Individual flow)
- "T3N processes and sanitizes the execution responses before returning… ensuring sensitive employee and financial data is never exposed to the agent." (Delegate Access — Payroll flow)
- "The only path to the key is through your contract code — no external observer, not the agent, not the calling developer, can read it back out." (Seed API key page)
- "A T3N DID has the form `did:t3n:<40 hex characters>`… The network binds it to your key the first time you authenticate — so you don't compute it yourself, you read it back." (Register a Public Agent)
- "Metered calls are charged against the **calling identity's own** T3N credit balance — an agent DID's balance is separate from its tenant's, and starts at zero even when the tenant has plenty of test tokens." (Common Errors)
- "This is the most common reason a working contract can't reach its API: the code is fine, but no grant authorizes the host. Set the grant before you invoke." (Outbound HTTP page warning)

---

## SOURCES

Every URL fetched (HTTP status in parentheses; .md variants are the Mintlify-rendered markdown, identical content to the pretty pages):

Docs (all `https://docs.terminal3.io/...`, fetched via curl as `.md`, all 200 unless noted):
- `/llms.txt` (200) — documentation index
- `/developers/adk/overview` (200) — "What is T3 Agent Developer Kit (ADK)?"
- `/developers/adk/overview/adk-tour` (200) — ADK Tour (five ideas, narrative)
- `/developers/adk/overview/agent-auth-adk` (200) — **Agent Auth** (auth vs authorization, grant shape, egress_denied)
- `/developers/adk/overview/why-adk`, `/developers/adk/overview/what-is-adk` — linked in index, not fetched
- `/developers/adk/get-started/quickstart` (200) — install + minimal client
- `/developers/adk/get-started/prerequisites/request-test-tokens` (200) — claim page (key shown once)
- `/developers/adk/get-started/prerequisites/set-up-dev-env` (200) — TenantClient construction, `tenant.tenant.me()`
- `/developers/adk/get-started/what-is-z-namespace` (200) — z-namespace intro, audit-log claim
- `/developers/adk/get-started/walkthrough/write-contract` (200) — Duffel contract (world.wit, search.rs, booking.rs, secrets read)
- `/developers/adk/get-started/walkthrough/build-contract` — linked, not fetched
- `/developers/adk/get-started/walkthrough/register-contract` (200) — registration, tail rules, contract_id gotcha
- `/developers/adk/get-started/walkthrough/invoke-contract` (200) — **full host-side Duffel example** (agent/user sessions, agent-auth-update, search/book)
- `/developers/adk/get-started/walkthrough/test` — linked, not fetched
- `/developers/agents/register-agent` (200) — public agent onboarding (t3n CLI, card, host-card, credits)
- `/developers/agents/provision-org-agent` (200) — **org-owned agent** (TEE-minted key, t3n_key_, X-T3N-Api-Key, writers, NotScopeWriter, 4.25.0 pin)
- `/developers/adk/tips/create-kv-maps` (200) — maps.create, readers/writers ACL
- `/developers/adk/tips/seed-api-key` (200) — map-entry-set control call
- `/developers/adk/tips/capabilities-from-wit-import` (200) — capabilities = WIT imports
- `/developers/adk/tips/outbound-http-auth-by-user` (200) — egress from user grant, egress_denied
- `/developers/adk/tips/placeholders-outbound-calls` (200) — {{profile.*}} substitution, placeholder errors
- `/developers/adk/tips/common-errors` (200) — **full error-code table + gotchas**
- `/developers/adk/reference` (200) — SDK & API reference table, community-only list
- `/developers/adk/changelog` (200) — version history honesty (3.5.2/3.9.0/3.11.0)
- `/developers/adk/use-cases/payroll-agent` (200) — redirect stub to delegate-access
- `/t3n/data-owner-guide/delegate-access` (200) — dashboard grant/revoke UI steps
- `/t3n/use-cases/delegate-access-to-agent` (200) — procurement/payroll/individual narrative
- `/t3n/how-t3n-works/host-api` (200) — **Host API interface table** (kv-store, logging, http, http-with-placeholders, agent-auth, authorisation…)
- `/t3n/how-t3n-works/z-namespace` (200) — namespaces, access model, public maps
- `/t3n/how-t3n-works/tokens` (200) — metering, atomic charge, charge-on-attempt
- `/t3n/how-t3n-works/did` (200) — DID format
- `/t3n/how-t3n-works/tees` (200) — TEE node background (fetched, skimmed)
- `/t3n/overview/why-t3n`, `/t3n/how-t3n-works/architecture`, `/t3n/how-t3n-works/consensus`, `/t3n/how-t3n-works/data-encryption`, `/t3n/use-cases/delegate-access-to-human`, `/t3n/use-cases/mpc`, `/t3n/use-cases/reusable-user-data`, `/developers/adk/support/*` — linked from index, not fetched (not host/auth-relevant)

Docs pages that **404'd**:
- `https://docs.terminal3.io/terminal-3-openapi.yml` (404, HTML error page)
- `https://docs.terminal3.io/api-reference/openapi.json` (404, "Asset not found")

Other:
- `https://www.terminal3.io/products/agent-developer-kit` (200, web_extract) — sandbox pitch, narrative quotes
- `https://registry.npmjs.org/@terminal3/t3n-sdk` (200) — package metadata + full readme (install, environments, OIDC/OTP examples)
- `https://www.npmjs.com/package/@terminal3/t3n-sdk` — referenced by docs; metadata verified via registry endpoint above
- `https://api.github.com/repos/Terminal-3/trinity/contents/client/t3n-sdk` (404 — repo not publicly accessible)
- `https://raw.githubusercontent.com/Terminal-3/trinity/main/client/t3n-sdk/README.md` (404)
- Web search (discovery only): "Terminal 3 T3N ADK agent host", "terminal3.io host API agent auth", "Terminal 3 agent auth delegation docs.terminal3.io" — surfaced docs.terminal3.io, github.com/iamaanahmad/terminal3-adk (community bounty repo, not cited), github.com/Lukeknow0/terminal3-adk-bounty (community, not cited), x.com/terminal3io, docs.terminal3.com (⚠ a DIFFERENT site — store/game SDK, not T3N; do not confuse)

**Verification artifacts (local):** `@terminal3/t3n-sdk@5.5.0` installed at `C:\Users\fadhm\Desktop\terminal3\node_modules\@terminal3\t3n-sdk`; all quotes from `dist/index.d.ts` (6152 lines) verified by grep; all doc pages saved under `C:\Users\fadhm\Desktop\terminal3\docs\`.
