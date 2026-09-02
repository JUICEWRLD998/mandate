# MANDATE — a payment agent that never sees the bank details

**One-line pitch:** an enterprise agent that onboards a customer (KYC) and executes their first payment while the agent, the LLM, the developer and the application host never see the customer's identity or bank plaintext — the values travel as `{{profile.*}}` markers and are substituted only inside an Intel TDX enclave, under a scoped, revocable grant the customer signed.

**Submission for:** Terminal 3 × Superteam — "Try out new docs to build a trusted agent with T3N that we can distribute / host" (T3N Agent Build Challenge)

| | |
|---|---|
| Project name | MANDATE |
| Public repository | https://github.com/JUICEWRLD998/mandate |
| Docs in this repo | [README.md](README.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/buglog.md](docs/buglog.md) |
| Submitted | 2026-09-02 (bounty deadline 2026-09-16 15:59:59 UTC) |
| Applicant email | <YOUR-EMAIL> |
| Applicant T3N DID | <YOUR-DID> |

This document is the Google Doc submission; the repository it describes is the working artifact. Everything below that claims live behavior is real and reproduced in the repo; the one thing not yet executed end-to-end on testnet — a full KYC-then-payment run, which needs the applicant's credits — is marked *pending* rather than claimed.

---

## 1. Problem — the agent standing risk

The standing risk with agentic software is that the agent *must be trusted with the data it acts on*. An agent that onboards employees or runs payroll is handed, in one way or another, the company's crown jewels — and the T3N docs state the breach framing plainly:

> "AI agents must not be given direct access to employee PII, bank account details, payroll provider credentials, or treasury payment keys."

Every hop is an exposure: the LLM prompt context, the application server's memory, the developer's logs, the agent's own storage. The usual fixes (redaction, masking, "don't log") all fail the same way — the plaintext existed in the agent's world at some point, so a compromise of the agent is a compromise of the data.

**Why delegated TEE execution changes this:** Terminal 3 runs untrusted contract code as a WASM component inside an Intel TDX enclave. The agent does not call the bank; it calls a contract in the enclave, and the enclave — under a delegation grant signed by the *data owner* — performs the outbound call. That turns the problem on its head: instead of "how do we protect the data the agent holds", the question becomes "how do we let the agent act on data it never holds".

## 2. Insight — use data you never hold, under a grant you can revoke

Two primitives do the work:

**1. `http-with-placeholders`.** A contract's outbound request body can contain literal template markers — `{{profile.iban}}`, `{{profile.swift_bic}}`, `{{profile.legal_name}}` — instead of values. The platform resolves those markers *inside the enclave at egress time* against the calling user's verified profile, and only then sends the request to the money rail. The marker is a string in a struct the agent built; the plaintext never enters the agent process, the LLM context, the developer's machine, or the contract's logs. The agent can *use* the data without ever *holding* it. Only the `profile` namespace is substitutable — there is no path for a contract to reach secrets or other namespaces through placeholders.

**2. Delegation, not blanket trust.** The agent only becomes able to do any of this when the data owner signs a grant that scopes exactly three things: **contract × functions × host** (`allowedHosts`). No grant, no egress — the contract still runs, but its outbound call fails with `host/http.egress_denied`. Revocation is equally simple: empty the delegation and the next outbound call is denied; the agent's key is unchanged, its access is gone. There is no "permanently trusted agent" state to maintain — trust is a revocable credential, not a config file.

## 3. MANDATE in one paragraph

MANDATE is an enterprise agent built on Terminal 3 that onboards a new customer (identity verification) and executes that customer's first payment. The enterprise registers a small Rust contract — `z-mandate` v0.1.0 — that exports exactly two operations, `onboard-customer` and `pay-invoice`, and seeds a money-rail API key into a sealed `z:<tid>:secrets` map. The customer, who holds a verified T3N profile (including their bank details), signs a scoped delegation grant authorizing the agent to call *those two functions* against *one egress host*. The TypeScript agent host — running under its own DID — then orchestrates: it sends `onboard-customer(cus_1)`, gets back a scrubbed KYC verdict; it sends `pay-invoice(inv_1, 199.00)`, and the contract's outbound body to the rail carries only markers — `{{profile.iban}}` etc. — which the enclave substitutes at the last instant. The rail receives the customer's real IBAN and settles the payment; the agent receives only a scrubbed verdict plus `iban_sha256`, a digest proving the rail got exactly the profile's value. Neither the agent, the LLM, the developer, nor the host ever saw the plaintext. Then the demo revokes the grant and shows the same payment call fail at the enclave boundary.

## 4. Architecture

Four actors, one enclave, one counterparty:

```
Enterprise tenant ── registers the contract, seeds z:<tid>:secrets (rail key)
Intel TDX enclave ── runs z-mandate WASM; resolves {{profile.*}} at egress; scrubs verdicts
Agent host (TS)  ── its own DID; orchestrates onboard → pay; sees markers only
Data owner       ── verified profile (identity + bank); signs the scoped, revocable grant
Audit ledger     ── append-only, encrypted; the host reads a compact pane via getAuditEvents()
Mock money rail  ── the counterparty: records the real payload it receives, returns scrubbed responses
```

- **Contract** (`contract/`): Rust → WASM component, world `z:mandate@0.1.0`, importing only `tenant-context`, `logging`, `kv-store` and `http-with-placeholders` (WIT imports are the entire capability set — there is no manifest). Request structs carry no PII fields and `deny_unknown_fields`, so inline PII in an input is rejected at parse time (`bad input: unknown field …`). Outbound bodies are built from the `MARKER_*` constants only; rail responses are parsed into scrubbed verdict structs and raw bodies are never forwarded, logged or returned.
- **Host** (`host/`, TypeScript, `@terminal3/t3n-sdk@5.5.0` pinned): three independent sessions (tenant / agent / user); `register.ts` publishes the contract and seeds the secrets map; `grant.ts` writes and revokes the delegation; `run-demo.ts` orchestrates the demo and logs markers + ids only (`agent-output.log`).
- **Rail** (`mock-rail/`, Express, ~80 lines): the legitimate counterparty. It records the *exact* payload it receives — including the resolved real values — into `rail.log`, and returns responses that never echo PII back (scrubbed by construction, test-asserted), plus `iban_sha256` as a deterministic proof of receipt.
- **Marker strategy**: fields resolve only if the calling user's profile carries them. The documented fields were verified on testnet during the walkthrough (`first_name`/`last_name` resolve; `date_of_birth` failed with `user profile missing field: date_of_birth` when the profile didn't carry it — see BUG-006). `legal_name`/`iban`/`swift_bic` are provisioned into the demo user's profile and swap at a single edit point — the `MARKER_*` constants in `contract/src/lib.rs` — per the documented fallback (the z-tenant-flight precedent of contract-supplied values) if any field fails to resolve on the live cluster.

For the full diagram and data-flow writeup, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 5. The demo — Beats 0–5, one request two views

The runner is `scripts/demo.sh` (deterministic; `DEMO_DRY=1` prints the whole trace and touches nothing — verified green). It runs six beats; the fixture customer is a fake-but-plausible test identity (name "Ada Bank", DOB 1990-01-15, IBAN `GB29 NWBK 6016 1331 9268 19`, BIC `NWBKGB2L`) that lives only in test fixtures and this documentation, never in executable source — that invariant is itself asserted every run.

**BEAT 0 — Before.** Preconditions for a trustworthy demo: the repository carries no plaintext IBAN anywhere outside exempt test fixtures (asserted by `e2e_assert_repo_no_plaintext_iban`), the rail answers `/health`, and the contract record + delegation grant exist. *Verified live.*

**BEAT 1 — KYC.** The agent calls `onboard-customer(cus_1)`:
`(cd host && npx tsx src/run-demo.ts kyc --customer cus_1)`
The contract reads the rail key from `z:<tid>:secrets` inside the enclave and POSTs a KYC request whose identity fields are markers. The agent's log shows the markers; `rail.log` shows the real customer record that arrived. The rail answers with a scrubbed verdict — `{kyc_id, status: "verified", risk_score, checks: ["identity","sanctions"]}`.

**BEAT 2 — PAY: the magic moment.**
`(cd host && npx tsx src/run-demo.ts pay --invoice inv_1 --amount 199.00)`
The agent's payload carries `invoice_id` + `amount` only; the contract's outbound body is the marker template:

```
{"beneficiary":{"legal_name":"{{profile.legal_name}}","iban":"{{profile.iban}}",
 "swift":"{{profile.swift_bic}}"},"amount":"199.00","currency":"GBP", ...}
```

The enclave substitutes the real values and the rail logs what it actually received — the real IBAN and legal name — then settles and returns `{payment_id, status: "settled", trace: "T3N-MANDATE-DEMO", iban_sha256}`. The demo extracts the real IBAN from `rail.log` and sha256-compares it against the returned `iban_sha256`: the digest proves the rail received exactly the profile's value.

> **The magic moment: the same request, two views — the agent's log shows `{{profile.iban}}`; the rail's log shows the real IBAN that arrived; `iban_sha256` proves the rail received exactly the profile's value without ever revealing it.** The secret moved without touching the mover.

**BEAT 3 — Revoke.** The delegation is emptied:
`(cd host && npx tsx src/grant.ts revoke)`
`grant.ts show` now lists no active agent. The customer's access decision is the entire control surface — no key rotation, no agent-side setting.

**BEAT 4 — Denied.** The agent tries to pay a second invoice:
`(cd host && npx tsx src/run-demo.ts pay --invoice inv_2 --amount 50.00)`
The contract still runs — the denial happens at the enclave boundary, not in the agent's code — and the call fails with the real platform error `egress denied for host localhost` (the host string is reported port-stripped; see the bug report on host matching). Asserted: `rail.log` line count is unchanged — the request never reached the rail.

**BEAT 5 — After.** The repository plaintext invariant is re-asserted (still no IBAN outside fixtures), and the run summarizes where the evidence lives: `agent-output.log` (markers + proofs), `rail.log` (real values, counterparty side), audit pane via `npm run grant -- show`.

**Screenshot frames** (each emitted by the runner; captures pending the final live run below):
- *(screenshot pending)* KYC verdict — `agent-output.log` shows `{{profile.*}}` markers; `rail.log` carries the real customer record.
- *(screenshot pending)* Magic moment, split view — left: `agent-output.log` with `{{profile.iban}}` + `iban_sha256` proof; right: `rail.log` with the real IBAN.
- *(screenshot pending)* Contract source showing marker-only bodies (`contract/src/pay.rs`, `MARKER_*` consts).
- *(screenshot pending)* Revocation — `grant.ts revoke` output; delegation now lists no active agent.
- *(screenshot pending)* Revocation denial — terminal shows `egress denied`; `rail.log` tail unchanged.
- *(screenshot pending)* Audit pane — compact `{ok, summary: {batches, events, actions}}` from `getAuditEvents()`.

**Live evidence, 2026-09-02 — what is real right now:**
- Contract **registered on testnet as id 862**, canonical name `z:8e3547bce411fd4f51fe1f25df033d83acccc869:mandate-contracts` v0.1.0 (tenant DID is the 40-hex suffix).
- Delegation grant written; register → rail pipeline verified; the mock rail's HTTP layer curl-verified live: `/kyc` and `/pay` return scrubbed responses and the `iban_sha256` returned for the fixture IBAN matched a locally computed digest.
- Test suites green: 21 contract (Rust, native) + 46 host (vitest) + 12 rail (supertest) + a 30-assertion e2e harness; `DEMO_DRY=1` trace exits 0.
- Real errors observed and quoted in this document come from live testnet runs (buglog BUG-001…009).

**Pending — stated plainly:** the full KYC-then-payment run through the enclave is not yet executed end-to-end on testnet. It needs the applicant's real keys + metered credits in `host/.env` (this machine's walkthrough keys exist; the run and its screenshots are the next action, not something already done). Everything in Beats 1–4 that is not in the verified list above is *designed and scripted*, with the dry-run runner and unit suites proving the assertion logic — and the moment the live run lands, the frames above are filled in and this section updated. No fabricated verdicts, payment ids or screenshots appear in this document.

## 6. How this is scored → what we built

The listing's criteria, in order, and the evidence for each:

| # | Criterion (as listed) | What we built / evidence |
|---|---|---|
| 1 | Time to submit | Scaffold → working demo runner in **two days** (2026-09-01 research, quickstart, walkthrough, buglog; 2026-09-02 contract, host, rail, e2e runner). Submitted ~2026-09-02, roughly two weeks before the 2026-09-16 15:59:59 UTC deadline, when the listing already showed 60+ entries. |
| 2 | VERY IMPORTANT — usefulness and ease to maintain (the sponsor wants to host/distribute the winner) | Built for handover, not demo-only: one env contract (`host/.env.example`), no secrets in the repo, `npm run register` / `npm run grant` / `bash scripts/demo.sh` as the whole surface; a contract-record file bridges steps; the money rail is config-swappable (Duffel pattern — point `RAIL_URL` + the grant's `allowedHosts` at a real processor and nothing else changes); profile markers swap at one edit point (`MARKER_*` consts); a version-bump procedure ties contract ↔ WIT ↔ host; a dry-run mode makes the demo verifiable with zero credits or network. See §9 Handover. |
| 3 | Documentation quality | This Google Doc; [README.md](README.md) (entry point, run-it-yourself, troubleshooting, known deviations); [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); [docs/buglog.md](docs/buglog.md). Every command and quoted error is real; pending live evidence is marked pending, not claimed. |
| 4 | Bug submission quality | [docs/buglog.md](docs/buglog.md): **9 findings (BUG-001…009)** — 7 walkthrough findings plus 2 newer live findings (delegation docs drift; egress host matching) — each with verbatim error, environment, severity, reproduction from clean state and suggested fix. Strongest findings summarized in §8. |
| 5 | Bonus — X post tagging @terminal3io | *(pending)* Post planned with the magic-moment screenshot once the live run lands; tagged @terminal3io. |

**Evidence summary:** contract registered on testnet (id 862, `z:…:mandate-contracts` v0.1.0); 21 + 46 + 12 + 30 tests green; WASM component builds at 171,304 bytes (under the registration cap); real error strings reproduced; audit primitives exercised. Repository is public and MIT-licensed.

## 7. Run it yourself

Five steps from a clean clone (testnet only; all commands are real — this is exactly how the demo was built):

```bash
# 0. One-time: testnet keys from the claim page (https://www.terminal3.io/claim-page)
#    for THREE identities: T3N_API_KEY (tenant), AGENT_KEY (agent), USER_KEY (data owner)
cp host/.env.example host/.env        # fill the three keys + RAIL_URL + CONTRACT_TAIL

# 1. Register the contract + seed the secrets map (writes host/.contract-record.json)
cd host && npm install && npm run register

# 2. Sign the scoped delegation grant (customer authorizes agent: 2 functions, one host)
cd host && npm run grant -- grant

# 3. Start the mock money rail (localhost:8787)
cd mock-rail && npm install && npm start

# 4. Run the whole demo, Beats 0–5, with assertions
cd .. && bash scripts/demo.sh
#    preview without touching the network:
#    DEMO_DRY=1 bash scripts/demo.sh
```

Tests:

```bash
cd contract  && cargo test --target x86_64-pc-windows-gnu --lib   # 21 native tests (markers, hygiene, scrubbing); the --target override is required because contract/.cargo/config.toml defaults to wasm32-wasip2 (on macOS/Linux use your host triple)
cd host      && npm run typecheck && npm test   # tsc strict + 46 vitest cases
cd mock-rail && npm run typecheck && npm test   # 12 supertest cases
bash tests/e2e-asserts.test.sh                  # 30-assertion e2e harness
```

Troubleshooting essentials (details in README + buglog): the quickstart trust-anchor fetch fails on testnet (BUG-002) — the host code uses the documented dev escape hatch; three claim-page keys collapse to one DID (BUG-003) — agent/user identities are distinct keys with their own credits (BUG-004: a zero-credit DID fails metered calls with `InsufficientCreditError`); egress requires the grant's `allowedHosts` to name the rail host.

## 8. Bug reports — strongest findings

Full reproductions for every entry — steps, verbatim output, environment (Windows 11 / Node 24 / SDK 5.5.0 / docs URL), severity, suggested fix — live in [docs/buglog.md](docs/buglog.md). Summary:

| Finding | What happens | Impact | Workaround |
|---|---|---|---|
| BUG-002 — trust manifest rejected | `fetchTrustedManifest("testnet")` throws "Trust manifest … is malformed": SDK 5.5.0 requires `rtmr1_allowlist`; the cluster manifest serves only `rtmr3_allowlist` | Documented quickstart fails out of the box; no pinned trust anchor on the happy path | Documented dev escape hatch `trustAnchor: { unsafe_trust_server: true }` (carried in all host code) |
| BUG-003 — claim-page keys collapse | Three claim-page keys from one account all bind to the same DID; a fresh random key gets its own DID | Agent/tenant/user separation collapses; walkthrough's three-session demo becomes a self-grant | Distinct secp256k1 keys for agent/user identities |
| BUG-004 — zero-credit gating | Fresh DID with no credits fails metered invoke: `InsufficientCreditError: InsufficientCredit (account=f663b6d4005efe2ecac5a9486b5426b8499924d3, required=10000000000, available=0)` | Bring-your-own-key agent flows blocked until credits are minted for the agent DID; grant writes unaffected | Use credit-bearing identities; request test tokens for the demo DID |
| BUG-006 — empty-profile gap | Placeholder resolution against a profile missing a field: `user profile missing field: date_of_birth` | Fields must exist in the *calling user's* profile; docs' documented field list is narrower than flows assume | Provision demo profile fields via user-upsert; one-point marker swap in the contract |
| BUG-007 — SDK stdout dump | ~2.1 MB of whitespace / SDK source dumped to stdout on every failing RPC | Breaks log pipelines; noise in every error path | Cosmetic — matched on error substrings, not stdout |
| NEW — delegation docs drift (D2) | The legacy `agent-auth-update` delegation documented in the walkthrough no longer arms egress on the current testnet — the grant writes successfully but outbound calls stay denied; the modern `member-delegation-*` surface (`tee:authorisations/contracts`) is functional | A dev following today's docs builds a "successful" grant that silently cannot egress | Use the member-delegation surface; the grant module is one internal shape, so the swap is one module |
| NEW — egress host matching | Denial is reported port-stripped: a call to `localhost:8787` fails with `egress denied for host localhost` | `allowedHosts` entries and denial messages disagree about ports — port-scoped grants are ambiguous to debug | Match on host; log the grant's effective host list at grant time |
| NEW — docs 404s + naming drift | `/api-reference/openapi.json` and `/terminal-3-openapi.yml` (linked from `llms.txt` and the reference page, claimed "21 paths, 24 operations, OpenAPI 3.0.3") return 404; reference page says `getScriptVersion`, the runnable walkthrough uses `getContractVersion` (the one that works live); quickstart and reference disagree on the `setEnvironment` default; the sample repo still shows a `host_capabilities` manifest that current docs say doesn't exist | Wrong assumptions for newcomers; broken spec links | Follow the runnable walkthrough variants; always call `setEnvironment("testnet")` explicitly |

Honest caveats that belong next to the wins: the demo rail is a mock (deliberately — same pattern as the reference Duffel example; the rail is the config-swap point for a real processor), and tenant KV maps are not tamper-proof against their own owner — the append-only guarantee lives in the audit ledger (`logging::audit` / `getAuditEvents`), which is where the demo points for integrity.

## 9. Handover & eligibility

**Eligibility form:**
- Email: <YOUR-EMAIL>
- DID: <YOUR-DID>
- "Would you want to continue running this / pass it to us to run it?" — **Continue running it.** MANDATE is structured as a startup-able product (agentic customer onboarding + first payment with zero PII exposure is a sellable wedge for regulated rails), and the handover note below is written so the Terminal 3 team can run or distribute it unchanged if they prefer to take it over.

**Handover note (structured for the sponsor to run / host / distribute):**
- **Config-swap rail.** The mock rail implements the reference Duffel pattern: point `RAIL_URL` (host env) and the grant's `allowedHosts` at a real KYC provider / payment processor and nothing in the contract or host changes. The rail API key is seeded into the sealed `z:<tid>:secrets` map via the tenant control plane; the contract is the only reader inside the enclave and it never logs the key.
- **Env contract.** `host/.env.example` names every variable; `host/.env` is gitignored; the repo contains no secrets. `.contract-record.json` (also gitignored) is the single source of truth bridging register → grant → demo — it stores the canonical `z:` map name and the numeric contract id, because re-registration allocates a new id.
- **Scripts.** `npm run register` (publish + seed), `npm run grant` (write/show/revoke), `npm start` in `mock-rail`, `bash scripts/demo.sh` (Beats 0–5, self-asserting), `DEMO_DRY=1` (no-network preview). `tests/e2e-asserts.sh` encodes the trust invariants as reusable assertions.
- **Maintenance — markers.** Profile-field strategy is reversible at one edit point: the `MARKER_*` constants in `contract/src/lib.rs`. Swap a constant, rebuild, re-register — call sites and tests stay untouched.
- **Maintenance — versions.** Version bump procedure: bump `CONTRACT_VERSION` in `contract/src/lib.rs`, the package version in `contract/wit/world.wit`, and the `version` passed to `tenant.contracts.register(...)` in lockstep — the node rejects a registered version that is not higher than the current one. Re-registration creates a new contract id: update the secrets map ACLs (`readers`/`writers` are `{only: [contractId]}` and the KV governor denies by default) and the record file.
- **Testnet only.** Built and verified against testnet; three identities need their own metered credits (see BUG-004) — the sponsor's distribution should mint credits per agent DID.
- **Known deviations, stated:** single repository with everything in-tree (docs layout: README / ARCHITECTURE / buglog / this doc); the demo user's bank fields are provisioned into the profile (the platform's documented profile schema does not yet list `iban`-style fields — filed as a follow-on primitive suggestion); SDK pinned to 5.5.0.

## License

MIT — see [LICENSE](LICENSE) in the repository. Demo fixture data is fake-but-plausible and appears only in test fixtures and documentation.
