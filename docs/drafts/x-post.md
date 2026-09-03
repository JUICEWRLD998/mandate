# X (Twitter) post drafts — MANDATE demo announcement

**Repo:** https://github.com/JUICEWRLD998/mandate (MANDATE — Terminal 3 × Superteam T3N Agent Build Challenge)
**Status: LIVE RUN LANDED (2026-09-03)** — `bash scripts/demo.sh` ran green twice on testnet (Beats 0-5, exit 0, 16 PASS each; evidence in `docs/buglog.md` BUG-010…BUG-013 + D1-RESOLVED). **Post-ready the moment frame 2 (magic moment) is captured** per `docs/drafts/screenshot-frames.md` and attached below. After publishing, flip `docs/SUBMISSION.md` §6 row 5 from *(pending)* to *posted* with the URL.

**Why the drafts changed (D1, resolved live 2026-09-03):** the previous drafts centered on `{{profile.iban}}` — a marker that **no longer exists**. The live cluster proved the profile schema **cannot carry bank fields**: user-upsert rejects them verbatim (`Profile validation failed: ValidationResult { issues: [ValidationIssue { path: [], error: UnrecognizedKeys { keys: ["iban", "legal_name", "swift_bic"] } }] }`). The landed magic moment is therefore:

1. **Sealed beneficiary config** — the enterprise writes the bank details once into the sealed `rail_beneficiary` secret (`z:<tid>:secrets`); only the enclave ever reads them (docs' payroll model).
2. **In-enclave marker resolution** — the payer's contact rides as the real schema-backed marker `{{profile.verified_contacts.email.value}}`, substituted host-side inside the enclave at egress (KYC person markers resolve the same way). Plaintext never enters WASM or the agent's logs.
3. **`iban_sha256` proof** — the rail's receipt carries the digest; `sha256(GB29 … 9268 19)` = `513740128f95b1e09615d6fed53bfce2a0fa0b87f782f6121bc8725ae6d5a35b` (asserted by the runner, not claimed in prose).

Both variants below describe only what the landed run verifies.

**Handle policy (checked against repo docs):** the bonus criterion and every checklist in this repo name **@terminal3io** only. No Superteam X handle appears anywhere in the repo docs, so per instructions both variants tag **@terminal3io only**. If the team confirms the Superteam handle (@superteam_fun, matching the superteam.fun listing host), both variants are budgeted with ample headroom — appending ` @superteam_fun` (16 chars) keeps each well under 280 (verified: A=220→236, D=203→219; see counts below).

**Attachment:** attach the magic-moment split screenshot (frames guide, **frame 2**) to whichever variant is posted.

---

## Variant A — "the secret moved without touching the mover" (220 chars)

> A payment agent that never sees the bank details. The config is sealed in @terminal3io tenant KV and resolved only inside a TDX enclave at egress — the agent logs markers and a sha256 proof; the rail logs the real value.
> github.com/JUICEWRLD998/mandate

- Angle: one payment, two views; agent/LLM/dev never hold the plaintext.
- Char count: **220** (≤280). With ` @superteam_fun` appended: **236**.

## Variant D — enterprise onboarding story (203 chars)

> Onboarding + first payment, executed by an agent that never once saw the customer's bank details. @terminal3io seals the config and resolves the markers in-enclave; the iban_sha256 proof closes the loop.
> github.com/JUICEWRLD998/mandate

- Angle: the enterprise outcome (onboard → pay) with the zero-exposure claim and the digest proof.
- Char count: **203** (≤280). With ` @superteam_fun` appended: **219**.

---

## Posting checklist (live run landed — screenshots remain)

1. ✅ Live run landed 2026-09-03: `bash scripts/demo.sh` Beats 0-5 exit 0 **twice** on testnet (16 PASS each); post-revoke denial = Forbidden `agent_auth_not_found`, rail untouched. Findings BUG-010…BUG-013 + D1-RESOLVED filed in `docs/buglog.md`; formal reports R15–R18 in `docs/BUG-REPORTS.md`.
2. ⬜ Capture frame 2 (magic moment split view: agent-output.log markers + `iban_sha256` left, rail.log real beneficiary payload right) per `docs/drafts/screenshot-frames.md` — attach it to the post.
3. Post from the applicant account; keep the copy verbatim (it contains no `{{profile.*}}` literal — D1 removed the bank markers; do not reintroduce `{{profile.iban}}`).
4. Tag @terminal3io (required by the bonus criterion). Add `@superteam_fun` only after confirming the handle — both drafts fit it within 280 chars.
5. Update `docs/SUBMISSION.md` §6 row 5 from *(pending)* to *posted* with the post URL after publishing.

**Fixture data only** (Ada Bank, `GB29 NWBK 6016 1331 9268 19`, `NWBKGB2L`; disposable-OTP mailbox `mandatelxngrr9l@emalupe.com`) — never appears in either draft; the frame-2 screenshot may show the rail side of the log with the fixture IBAN (fake-but-plausible, docs-allowed illustration, rail side only — the agent side never shows it).
