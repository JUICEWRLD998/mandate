# MANDATE

> An enterprise agent that verifies a new customer and moves their first payment — without ever seeing the identity or the bank details.

**Status:** Phase 0 scaffold complete. Full build plan: [implementation.md](implementation.md)

## What it is

MANDATE is an agent built on Terminal 3 (T3N) that onboards a customer (identity verification) and executes their first payment. The agent, the LLM, the developer, and the application server never see the customer's raw identity, documents, or bank details: the Rust contract only ever sends `{{profile.*}}` placeholder markers, and the T3N enclave (Intel TDX, Wasmtime) substitutes the real values at the last instant, under a scoped, revocable grant the customer signed.

## Architecture

```
Tenant (enterprise dev)  → registers the TEE contract, seeds z:<tid>:secrets (rail API key)
TEE (Intel TDX · Wasmtime) → Rust contract → WASM: onboard-customer, pay-invoice
                            sends {{profile.*}} markers; real values substituted inside the enclave
Agent host (TypeScript)   → its OWN DID; orchestrates under a scoped grant (contract × functions × host)
Data owner (customer)     → verified identity in profile; signs a revocable delegation grant
Mock money rail (Express) → logs the real payload it receives; returns scrubbed responses
```

## Repository layout

```
contract/     Rust TEE contract (world.wit, WASM component)
host/         TypeScript agent host (@terminal3/t3n-sdk)
mock-rail/    Express mock money rail
scripts/      build / demo scripts
 docs/         architecture, demo script, submission, research dossiers
tests/        e2e assertions
```

## Status & plan

- [x] Phase 0 — repo scaffold, environment, plan (implementation.md)
- [ ] Phase 1 — quickstart + walkthrough on testnet, bug log
- [ ] Phase 2 — Rust TEE contract
- [ ] Phase 3 — TypeScript agent host
- [ ] Phase 4 — mock money rail
- [ ] Phase 5 — integration + revocation demo
- [ ] Phases 6–9 — docs, bug report, submission, hardening

## License

MIT
