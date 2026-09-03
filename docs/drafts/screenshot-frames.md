# Screenshot capture guide — the 6 frames (docs/SUBMISSION.md §5)

Status of this guide: **LIVE RUN LANDED 2026-09-03** — `bash scripts/demo.sh` ran green **twice** on testnet (Beats 0-5, exit 0, 16 PASS each). The frames below now describe **real evidence already on disk** plus the exact recipe to (re)capture it. Both run artifacts exist and carry the live payloads:

- `host/agent-output.log` — 9 lines: the KYC verdict for `cus_1` (`kyc_9755fb78` / `verified` / `risk_score 12`), the live `/pay` verdict for `inv_1` (`pay_5265da78` / `settled` / `iban_sha256 513740128f95b1e09615d6fed53bfce2a0fa0b87f782f6121bc8725ae6d5a35b`), matching `agent-view` template lines (sealed beneficiary + `{{profile.verified_contacts.email.value}}` marker), then the 10:22–10:26 audit-probe pays (`inv_audit`, `inv_audit2`, `inv_audit4`).
- `mock-rail/rail.log` — 7 lines: the **two live hits** of the first green run — `2026-09-03T10:21:11.340Z` `POST /kyc` (`customer_id cus_1`, real record `first_name:"Ada"` `last_name:"Bank"` `date_of_birth:"1990-01-15"`) and `2026-09-03T10:21:22.869Z` `POST /pay` (`amount "199.00"`, beneficiary `iban "GB29 NWBK 6016 1331 9268 19"` / `legal_name "Ada Bank"` / `swift "NWBKGB2L"`, `customer_email "mandatelxngrr9l@emalupe.com"`, `reference "inv_1"`) — followed by the audit-probe `/kyc` + `/pay` lines (10:22:57–10:26:00, `inv_audit*`, `cus_audit2`).

**Gitignored run artifacts (not tracked files):** `rail.log` (`.gitignore` line 5) and `agent-output.log` (line 6; `*.log` line 4 covers both) are created by the live beats — they are the demo's evidence trail, deliberately never committed. Screenshots, if saved, are *new* files under `docs/screenshots/` (never edits to tracked files).

**Test fixtures (never real customer data):** the bank details `GB29 NWBK 6016 1331 9268 19` / `Ada Bank` / `NWBKGB2L` and the disposable-OTP mailbox `mandatelxngrr9l@emalupe.com` are fixtures. The mailbox is the one-time-address that verified the demo user's email so the schema-backed marker `{{profile.verified_contacts.email.value}}` resolves in-enclave (see buglog BUG-012 + D1-RESOLVED). Fixture values may appear **rail-side only** (rail.log + the demo terminal's RAIL view); the agent side (agent-output.log, run-demo output) must never show them — the runner asserts this.

**Honesty rule (SUBMISSION.md):** every frame must come from a real run of the commands below — never fabricate, hand-edit, or stage a log tail. "No fabricated verdicts, payment ids or screenshots appear in this document." The frames may show the existing live lines above *or* a fresh run's lines — both are real.

**Magic-moment model (D1, resolved 2026-09-03 — the drafts/frames were updated):** the profile schema **cannot carry bank fields** (user-upsert rejects `iban`/`legal_name`/`swift_bic` — `UnrecognizedKeys`, see buglog D1-RESOLVED). The beneficiary bank config is therefore **sealed** in `z:<tid>:secrets` as `rail_beneficiary` (written once by the enterprise, read only inside the enclave), the payer's contact rides as the real schema-backed marker `{{profile.verified_contacts.email.value}}` (resolved host-side in-enclave at egress), and the rail receipt carries an `iban_sha256` proof. **There is no `{{profile.iban}}` literal anywhere** — do not reintroduce it in captions; `contract/src/pay.rs` asserts bodies never contain it. `sha256("GB29 NWBK 6016 1331 9268 19")` = `513740128f95b1e09615d6fed53bfce2a0fa0b87f782f6121bc8725ae6d5a35b` — the digest in the agent log, verified by the runner (beat 2) against the rail's IBAN.

## How to run (once, before capturing)

```bash
# prerequisites (from repo root): host/.env + host/.contract-record.json (npm run register —
# record now: contract_id 874, version 0.3.0, registered 2026-09-03T10:11:02Z), a written
# delegation grant (npm run grant -- grant), and the mock rail running on localhost:8787
# AND reachable from the enclave at a PUBLIC url:
bash scripts/start-rail.sh             # terminal 1 — rail on :8787 (endpoints /health /kyc /pay)
# NOTE — the enclave runs on the T3N node and CANNOT reach your loopback (buglog BUG-010/R15):
# every localhost/127.0.0.1 egress is denied on either grant surface. The live runs exposed the
# local rail through a public quick tunnel (trycloudflare) with RAIL_URL set in host/.env to the
# tunnel URL; npm run register seeds that rail_url secret and the grant allowlists the tunnel's
# public hostname (host/src/grant.ts defaultHosts() parses RAIL_URL). A fresh capture needs its
# own tunnel + RAIL_URL + re-seed + re-grant — the logs below are the evidence from the landed run.
cd .. && bash scripts/demo.sh          # terminal 2 — runs Beats 0-5, emits a 'SCREENSHOT FRAME:' hint per beat
```

`demo.sh` is deterministic and self-asserting. To capture frame-by-frame you can run the individual beat commands below instead of the whole script — the logs are **append-only**, so you can also run the full script and capture afterwards (each green run appends one `/kyc cus_1` pair + one `/pay inv_1` pair; beat 4's denied call writes nothing to rail.log).

**Windows capture notes (apply to all frames):**
- All runs happen in **git-bash** (the repo's shell; the host is Windows 11 / Node 24). Do not run the demo commands in PowerShell or cmd.
- **Win+Shift+S** → region snip → image goes to the clipboard → **Ctrl+V** pastes it directly into the Google Doc at the anchor listed under (d). No file saved unless you want one (suggested local names below; if saved, they are *new* files under `docs/screenshots/`, never edits to tracked files).
- Before snipping: maximize the terminal, enlarge the font (Ctrl+Shift+= or right-click title bar → Properties → Font), widen columns so no log line wraps. Log lines are long JSON — wrapped lines look broken in the doc.
- For side-by-side log views use **VS Code split editor** (open `host/agent-output.log`, then Ctrl+Enter / "Open to the Side" for `mock-rail/rail.log`) or two snapped windows (Win+← / Win+→) and snip across both.
- Where the fixture IBAN `GB29 NWBK 6016 1331 9268 19` legitimately appears is the **rail side only** (mock-rail/rail.log + the demo terminal's RAIL-view echo). The agent side (host/agent-output.log, run-demo output) must never show it — the runner asserts this.

---

## Frame 1 — KYC verdict

(a) **Must show:** the KYC request seen from both sides. Agent side: the `host/agent-output.log` `"step":"kyc"` record — operational ids only (`customer_id cus_1` → `kyc_id kyc_9755fb78`, `status "verified"`, `risk_score 12`), **no name, DOB, email or IBAN anywhere** — that absence is the point: the agent never holds the customer's PII. Optionally include the run-demo terminal's `KYC verdict: {...}` line. Rail side: the matching `mock-rail/rail.log` `"endpoint":"/kyc"` entry (`2026-09-03T10:21:11.340Z`) whose payload carries the **real resolved customer record** (`first_name "Ada"`, `last_name "Bank"`, `date_of_birth "1990-01-15"`). The literal markers that produced those values (`{{profile.first_name}}`, `{{profile.last_name}}`, `{{profile.date_of_birth}}`) are visible in `contract/src/kyc.rs` (frame 3 territory) — cite them in the doc caption if useful. The frame must contain no IBAN at all (KYC carries no bank fields).

(b) **Command/file:**
```bash
(cd host && npx tsx src/run-demo.ts kyc --customer cus_1)   # then open the two logs
# or run the whole demo and capture at the beat-1 hint:  bash scripts/demo.sh
# files: host/agent-output.log (first line)  |  mock-rail/rail.log (first line, 2026-09-03T10:21:11.340Z /kyc)
```

(c) **Windows:** VS Code split editor (agent-output.log left, rail.log right), zoom text, one Win+Shift+S snip across both panes. Terminal-only alternative: snip the beat-1 terminal output including the `PASS:` lines, then a second snip of the rail.log `/kyc` line — but the split view is the canonical proof.

(d) **Google Doc:** §5 "Screenshot frames" list, **first bullet** — paste under `KYC verdict — agent-output.log shows {{profile.*}} markers; rail.log carries the real customer record.` and drop the "(screenshot pending)" prefix. (Caption tip: the agent line itself is marker-free by design — pair it with the kyc.rs markers from frame 3 so the doc's "markers vs real values" claim is explicit.) Optional reuse beside §5 BEAT 1.

---

## Frame 2 — Magic moment, split view (the hero shot)

(a) **Must show:** one payment, two views. Left: `host/agent-output.log` — the `"step":"pay"` verdict for `inv_1`/`199.00` (`payment_id pay_5265da78`, `status "settled"`, `iban_sha256 513740128f95b1e09615d6fed53bfce2a0fa0b87f782f6121bc8725ae6d5a35b`) **and** the following `"step":"agent-view"` template line naming the sealed source and the marker — `"beneficiary":"sealed z:<tid>:secrets rail_beneficiary (resolved inside the enclave)"`, `"customer_email":"{{profile.verified_contacts.email.value}}"` — with **no bank plaintext**. Right: `mock-rail/rail.log` `2026-09-03T10:21:22.869Z` `/pay` entry whose `payload.beneficiary` is the **real fixture IBAN** `GB29 NWBK 6016 1331 9268 19` (+ `legal_name "Ada Bank"`, `swift "NWBKGB2L"`, `customer_email "mandatelxngrr9l@emalupe.com"`) — the values resolved inside the enclave. Acceptance: `sha256("GB29 NWBK 6016 1331 9268 19")` == the agent log's `iban_sha256` — demo.sh beat 2 prints the `------ MAGIC MOMENT: one payment, two views ------` block (`AGENT view … iban_sha256:"51374012…"` / `RAIL view … iban:"GB29 …"`) only after asserting the digests match; the terminal block is an acceptable alternative to the split editor.

(b) **Command/file:**
```bash
(cd host && npx tsx src/run-demo.ts pay --invoice inv_1 --amount 199.00)
# files: host/agent-output.log (pay + agent-view lines)  |  mock-rail/rail.log (2026-09-03T10:21:22.869Z /pay line)
```

(c) **Windows:** split-editor snip (frame 1 instructions) is the frame itself here — left pane must show the sealed-source template + marker + digest, right pane the real beneficiary payload, all visible in one region snip. If using the terminal block instead, maximize the git-bash window and snip the whole block including the divider lines.

(d) **Google Doc:** §5 frames list, **second bullet** — paste and drop "(screenshot pending)". **The bullet's label text is stale** (it still reads "left: agent-output.log with `{{profile.iban}}` + iban_sha256 proof"): update it to the D1-accurate wording, e.g. "Magic moment, split view — left: agent-output.log with the sealed `rail_beneficiary` source + `{{profile.verified_contacts.email.value}}` marker + `iban_sha256` proof; right: rail.log with the real beneficiary IBAN." **Also:** §6 criterion-5 (bonus) row, and the attachment for the X post (`docs/drafts/x-post.md`). This is the single most persuasive image — keep it high-res, un-cropped, line-wrapped cleanly.

---

## Frame 3 — Contract source, marker-only bodies (pay.rs + kyc.rs)

(a) **Must show:** the outbound bodies are built from markers and the **sealed** config, never literal bank data:
- `contract/src/pay.rs` `fn build_pay_body` (~lines 87–104): the `/pay` JSON whose `beneficiary.legal_name` / `iban` / `swift` come from `ben: &crate::RailBeneficiary` — the struct read inside the enclave from the sealed `rail_beneficiary` secret (`crate::get_rail_beneficiary`, `contract/src/lib.rs` ~142–150) — while `customer_email` is `crate::MARKER_EMAIL`. The module header (lines 3–30) states the D1 outcome ("the cluster's profile schema CANNOT carry bank fields…") — a strong caption.
- `contract/src/kyc.rs` outbound body: markers only (`{{profile.first_name}}`, `{{profile.last_name}}`, `{{profile.date_of_birth}}`) per its header comment.
- Optionally `contract/src/lib.rs` `MARKER_*` consts (lines 84–87: `MARKER_FIRST_NAME` / `MARKER_LAST_NAME` / `MARKER_DATE_OF_BIRTH` / `MARKER_EMAIL`) — **no bank markers exist**, and `pay.rs`'s unit test asserts the body never contains `{{profile.iban}}` / `{{profile.legal_name}}` (`build_pay_body_carries_sealed_beneficiary_and_email_marker_only`). No plaintext IBAN anywhere in the frame (fixture values appear only in `#[cfg(test)]` fixtures).

(b) **File:** open `contract/src/pay.rs` (e.g. `code contract/src/pay.rs` from repo root) and scroll to `build_pay_body`; open `contract/src/kyc.rs` (marker body) and `contract/src/lib.rs` (MARKER_* consts + `get_rail_beneficiary`) beside it. Static source — no command to run.

(c) **Windows:** editor snip with Win+Shift+S. Widen the editor pane, disable the minimap if it crowds the marker lines, keep line numbers visible so reviewers can jump to the lines; Ctrl+= to zoom until the constant names read clearly.

(d) **Google Doc:** §5 frames list, **third bullet** (`Contract source showing marker-only bodies`). Optional reuse beside §2 primitive 1 and §4's contract bullet ("Outbound bodies are built from the MARKER_* constants only") — add the sealed-`rail_beneficiary` wording where the doc still says profile markers carry the bank fields.

---

## Frame 4 — Revocation

(a) **Must show:** the delegation emptied on **both** surfaces. Terminal: the output of `npx tsx src/grant.ts revoke` — `grant revoked (legacy agents: [] + modern member-delegation: empty doc)` — then the `npm run grant -- show` pane (the `getMemberDelegation()` read-back, JSON) listing **no active grant** for the agent. Acceptance: the `show` pane's `grants` array is empty after the revoke. (Live context: enforcement of delegated calls consults the legacy `tee:user/contracts` doc while the read-back APIs read the modern doc — buglog BUG-011/R16 — so revoke clears both, and the denial in frame 5 follows.)

(b) **Command/file:** run both in the same terminal so one snip tells the story:
```bash
(cd host && npx tsx src/grant.ts revoke)
(cd host && npm run grant -- show)      # grants: [] — no active agent
```

(c) **Windows:** one Win+Shift+S snip of the git-bash terminal covering both commands' output; run them back-to-back and scroll so the revoke result and the empty `show` pane are in the same view.

(d) **Google Doc:** §5 frames list, **fourth bullet** (`Revocation — grant.ts revoke output; delegation now lists no active agent`). Optional reuse beside §3 / §2's "revocable grant — no permanently trusted agent" claim.

---

## Frame 5 — Revocation denial

(a) **Must show:** the same payment *after* revoke failing at the enclave boundary, plus proof it never reached the rail. Terminal: `pay --invoice inv_2 --amount 50.00` exits non-zero with the **live 2026-09-03 denial** — the platform's `Forbidden (agent_auth_not_found)` error (`RPC Error: Forbidden (agent_auth_not_found): did:t3n:… not permitted to act on behalf of did:t3n:… for z:8e3547bce411fd4f51fe1f25df033d83acccc869:mandate-contracts pay-invoice …`) — see buglog BUG-011/R16; demo.sh beat 4 accepts either that or the `egress denied` family and prints `PASS: pay denied — delegation revoked (agent_auth_not_found)` and `PASS: denied call never reaches the rail`. The rail is untouched: `wc -l mock-rail/rail.log` shows the same count before and after the attempt, and/or the rail.log tail shows no new `/pay` line.

(b) **Command/file:**
```bash
wc -l mock-rail/rail.log                       # before
(cd host && npx tsx src/run-demo.ts pay --invoice inv_2 --amount 50.00)   # expected: non-zero exit, Forbidden agent_auth_not_found
wc -l mock-rail/rail.log                       # after — identical count
# or:  bash scripts/demo.sh  → capture beat-4 terminal segment (PASS lines included)
```

(c) **Windows:** run in git-bash (the denial is the CLI's stderr/stdout — PowerShell would not reproduce the run); snip the terminal region with Win+Shift+S covering the `Forbidden (agent_auth_not_found)` / `not permitted to act on behalf` error **and** both `wc -l` counts so the unchanged number is visible in the same frame.

(d) **Google Doc:** §5 frames list, **fifth bullet** — the label text still says "terminal shows `egress denied`"; the live denial is `agent_auth_not_found` (rail never receives it), so update the bullet wording when pasting, e.g. `Revocation denial — terminal shows Forbidden (agent_auth_not_found); rail.log tail unchanged`. Supports §5 BEAT 4's claim that "the denial happens at the enclave boundary, not in the agent's code."

---

## Frame 6 — Audit pane

(a) **Must show:** the real compact audit pane printed at the end of the pay step — `Audit pane: {"ok":true,"summary":{"batches":…,"events":…,"actions":[…]}}` (or the honest `{"ok":false,"summary":{"error":…}}` form) from `getAuditEvents()` (SDK type `AuditPage { batches, next_cursor }`). **Live 2026-09-03 facts (buglog BUG-013/R18):** a fresh-session read on testnet returns an **empty ledger** — `{"batches":[],"next_cursor":null}` — so the pane legitimately shows `summary` with zero batches/events, and an immediate in-session read right after a delegated execute can throw `TypeError: Cannot read properties of undefined (reading status)` (run-demo retries once after ~500 ms and reports `{ok:false, summary:{error}}` if it persists). **Do not stage or fabricate ledger content** — the frame evidences the integrity surface's *mechanics* and the empty-ledger/race reality stated in the doc's §4 caveat; capturing whatever the real run prints is the honest evidence.

(b) **Command/file:** the pane is part of the pay step output:
```bash
(cd host && npx tsx src/run-demo.ts pay --invoice inv_1 --amount 199.00)   # tail: "Audit pane: {...}"
# demo.sh beat 2 runs this same pay step; beat 5's summary names the audit pane location
```

(c) **Windows:** Win+Shift+S snip of the terminal showing the `Audit pane:` JSON line; widen the window / bump the font if the object wraps awkwardly, and prefer a snip that also shows the trailing demo summary lines (`logs at host/agent-output.log (+ rail.log Phase 4)`) for context.

(d) **Google Doc:** §5 frames list, **sixth bullet** (`Audit pane — compact {ok, summary: {batches, events, actions}} from getAuditEvents()`). Supports §4's audit-ledger actor and the honesty caveat — refreshed on 2026-09-03: "the append-only guarantee lives in the audit ledger (`logging::audit` / `getAuditEvents`); on testnet today the ledger reads empty and an immediate in-session read can race (R18) — the demo points at the mechanics, not at fabricated events."

---

## Capture checklist (run order)

| # | Frame | Run/capture at | Anchor in Google Doc §5 |
|---|---|---|---|
| 1 | KYC verdict | beat 1 (`… run-demo.ts kyc --customer cus_1`) — or existing agent-output.log L1 + rail.log L1 (10:21:11Z) | bullet 1 |
| 2 | Magic moment split | beat 2 (`… run-demo.ts pay --invoice inv_1 --amount 199.00`) — or existing L2/L3 + rail.log L2 (10:21:22Z) | bullet 2 (label refresh: drop `{{profile.iban}}`, add sealed config; + §6 row 5, X post) |
| 3 | Marker-only source | static: `contract/src/pay.rs` (`build_pay_body`) + `kyc.rs` + `lib.rs` MARKER_* consts | bullet 3 |
| 4 | Revocation | beat 3 (`… grant.ts revoke` + `npm run grant -- show`) | bullet 4 |
| 5 | Denial | beat 4 (`… pay --invoice inv_2 --amount 50.00` + `wc -l`) | bullet 5 (label refresh: `agent_auth_not_found`) |
| 6 | Audit pane | pay step tail (`Audit pane:` line from run-demo.ts / demo.sh beat 2) | bullet 6 |

Save pattern if files are wanted (optional — pasting straight into the Google Doc is the default): `docs/screenshots/frame-1-kyc.png` … `frame-6-audit.png` (new, untracked files). After capture, flip the six "(screenshot pending)" prefixes in the Google Doc (and the mirror in `docs/SUBMISSION.md`), refresh the two stale bullet labels noted in frames 2 and 5 (D1: no `{{profile.iban}}`; live denial = `agent_auth_not_found`), and re-check §5's "Live evidence" block — the live-run details (2026-09-03, demo.sh exit 0 twice) supersede this guide's earlier status notes.
