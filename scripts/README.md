# scripts

Planned helper scripts (landing in later phases):

- `build-contract.sh` — build the contract to wasm32-wasip2: `rustup target add wasm32-wasip2` + `cargo build --release`.
- `seed-secrets.ts` — create the `z:<tid>:secrets` zone and map-entry-set the rail API key into it.
- `start-rail.sh` — start the mock rail on `:8787`, writing output to `rail.log`.
- `demo.sh` — deterministic demo flow: kyc → pay → revoke → denied.
