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

## Pre-seeded candidates (unverified — confirm on live testnet during the walkthrough)

These come from the research dossiers in `docs/research/`; each must be confirmed, refuted, or marked N/A as the walkthrough runs. Keep them as checklist items with a checkbox:

1. [ ] OpenAPI spec URLs return 404: https://docs.terminal3.io/api-reference/openapi.json and https://docs.terminal3.io/terminal-3-openapi.yml are linked from /llms.txt and the ADK reference page (which claims '21 paths, 24 operations, OpenAPI 3.0.3') but return 404.
2. [ ] setEnvironment default contradiction: the Quickstart page says the public SDK defaults to testnet; the SDK reference page says it defaults to production. Always calling setEnvironment('testnet') explicitly.
3. [ ] SDK naming drift: ADK reference lists getScriptVersion(nodeUrl, scriptName); the walkthrough (runnable example) uses getContractVersion(nodeUrl, TENANT_SCRIPT).
4. [ ] Stale capability-manifest docs: the z-tenant-flight repo README/lib.rs shows a JSON host_capabilities manifest; the docs say capabilities come only from WIT imports ('there is no separate manifest').
5. [ ] Host API table vs WIT drift: the reference page's http-with-placeholders gating column mentions a per-contract placeholder_allowlist; the vendored WIT comment says the only gate is the hard 'profile' namespace plus the delegation grant.
6. [ ] getAuditEvents(): docs mark it 'reported to exist but undocumented'; it IS a typed T3nClient method in 5.5.0.
7. [ ] tenant_did() raw-bytes gotcha: docs warn the contract's tenant_did() returns raw bytes and must be hex-encoded before building z-prefixed tid paths; missing OR double hex-encoding both produce a path that matches nothing.
8. [ ] readers ACL deny-by-default: maps.create without explicit readers creates a map nobody (not even the owner's contract) can read, with no error (silent deny-all; only a console.warn).
9. [ ] Re-registration allocates a NEW contract_id at the same tail with no API to fetch the tail's current id — stale map ACLs possible after re-registering (docs admit the gap).
10. [ ] Profile-schema gap (D1): {{profile.iban}}, {{profile.swift_bic}}, {{profile.legal_name}} are NOT in the documented profile fields (docs list first_name, last_name, date_of_birth, gender, verified_contacts.email.value). Verify against the live cluster; decide marker strategy.

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
