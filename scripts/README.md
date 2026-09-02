# scripts

Deterministic, git-bash compatible helpers for the MANDATE demo.

| Script | Purpose |
|---|---|
| `build-contract.sh` | Build the Rust contract to a WASM component (`contract/target/wasm32-wasip2/release/z_mandate.wasm`). Adds the `wasm32-wasip2` target on first run. No MSVC linker needed. |
| `start-rail.sh` | Boot the mock money rail on `:8787` (`RAIL_PORT` overrides). Appends every received payload to `mock-rail/rail.log`. |
| `demo.sh` | Deterministic Beats 0-5 demo: repo-clean preflight → KYC → pay (magic moment) → revoke → egress-denied → after-proof. `DEMO_DRY=1 bash scripts/demo.sh` prints the trace without executing anything live. |

Notes:

- `seed-secrets.ts` (early plan) is obsolete: `host` `npm run register` now creates
  the `z:<tid>:secrets` map (contract-only ACL, re-pointed on re-registration)
  and seeds `rail_api_key` via the control plane in one step.
- Live demo prerequisites: `host/.env` with real keys, a prior
  `npm run register` (writes `host/.contract-record.json`) and a user-signed
  grant (`npm run grant -- grant`).
