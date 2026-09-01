# Terminal 3 (T3N) Superteam Bounty — Full Dossier

**Compiled:** 2026-09-01 (all URLs fetched live on this date)

---

## 1. The Superteam Listing

| Field | Value |
|---|---|
| **Listing URL** | `https://superteam.fun/earn/listing/t3n-agent-build-challenge` |
| **Listing name (exact title)** | "Try out new docs to build a trusted agent with T3N that we can distribute / host" |
| **Sponsor** | Terminal 3 Network (`slug: "terminal3io"`, `entityName: "Terminal 3"`, `url: "https://terminal3.io"`) |
| **Type / status** | `"type": "bounty"`, `"status": "OPEN"` |
| **Reward** | **290 USDC total** (`"token": "USDC"`, `"rewardAmount": 290`) |
| **Prize split** | JSON `"rewards": {"1": 100, "2": 50, "3": 50, "4": 30, "5": 30, "6": 30}` → 1st **100 USDC**, 2nd **50**, 3rd **50**, 4th–6th **30** each (= 290) |
| **Deadline** | `"deadline": "2026-09-16T15:59:59.999Z"` → **2026-09-16, 15:59:59 UTC** (16:59 WAT / 11:59 ET) |
| **Winner announcement** | `"commitmentDate": "2026-09-23T15:59:59.999Z"` (Sep 23, 2026 UTC) |
| **Published** | `"publishedAt": "2026-08-26T02:27:16.013Z"` |
| **Region** | `"region": "Global"` |
| **Compensation** | `"compensationType": "fixed"`, `"isFndnPaying": false` (sponsor pays) |
| **Agent access** | `"agentAccess": "HUMAN_ONLY"` (AI agents cannot submit) |
| **Bonus spots** | `"maxBonusSpots": 0` |
| **Skills** | `[{"skills": "Backend", "subskills": ["Javascript"]}]` |
| **Contact** | `"pocSocials": "https://t.me/wardumb"`; listing note: "if more tokens are required DM me at https://t.me/wardumb with your DID and quote Superteam." |
| **Submissions so far** | 62 (`submissionCount` from page data, fetched 2026-09-01) |

**Listing description, verbatim (first line):**
> "Docs are refreshed from the prev challenge. Now looking for devs to build useful agents for enterprises on Terminal 3 that can be easily maintained"

**Scope Detail (verbatim):**
> - "Follow this LINK to sign up via SSO" (link: `https://go.terminal3.io/adk-community`)
> - "Obtain DID & API key, complete Quickstart and Walkthrough in Docs" (docs: `https://docs.terminal3.io/developers/adk/get-started/quickstart`)
> - "Build and submit an enterprise agent with T3N with focus on usefulness & ease of maintenance & running post challenge"
> - "Include in submission if you would want to continue running it or prefer to hand it over to us to maintain (+handover process). \* we have a startup program & listing page if you would want to continue running it"

**Reward Structure (verbatim, from description):**
> "1st place 100 USDC / 2nd / 3rd place 50USDC / 4-6 place 30USDC"

### Eligibility rules
- **Who can apply:** Anyone (region `Global`). The only listing-specific eligibility gate is a 3-question application form (JSON `eligibility` array, all `"optional": false`):
  1. `"question": "Email address"`
  2. `"question": "What is your DID generated from the page?"`
  3. `"question": "Would you want to continue running this / pass it to us to run it?"`
- **Geo restriction:** none — `"region": "Global"`.
- **Experience restriction:** none — `"requirements": null`. Skills needed are shown as Backend/Javascript but that is a "skills needed" tag, not a hard gate.
- **Existing T3N builders excluded?** **No.** No exclusion exists anywhere in the listing JSON or copy. On the contrary, the listing opens with "Docs are refreshed from the prev challenge" and re-invites devs to build — it is an explicit follow-up to the earlier T3N onboarding challenge, so prior/returning builders are clearly welcome (and the DID question in the form implies you must have completed the SSO signup regardless).
- **Human-only:** `"agentAccess": "HUMAN_ONLY"` — the Superteam Agent API tier is not available for this listing; a human must submit.
- Platform-level requirements (Superteam Earn profile/account) apply as for any listing.

---

## 2. Judging Criteria (exact text + JSON)

The listing JSON embeds the criteria only as HTML in `description` (there is no separate structured `judgingCriteria` field in this listing's payload — I quote the rendered text verbatim; the `eligibility`, `rewards`, `deadline` fields are structured and quoted above):

> **Judging Criteria**
> 1. "Time to submit (earlier, faster and more efficient the better)"
> 2. "**VERY IMPORTANT** - Build quality with focus on **usefulness and ease to maintain** post challenge"
> 3. "Documentation quality"
> 4. "Bug submission quality"
> 5. "Bonus : Sharing it on social media and tagging @terminal3io on X"

Interpretation for scoring (in order listed — order is meaningful on Superteam listings):
1. **Time to submit** — speed criterion; earlier/faster/more efficient submissions score higher. With 62 submissions already in (Sep 1) and a Sep 16 deadline, this is the highest-leverage non-quality lever left.
2. **Build quality (VERY IMPORTANT)** — explicitly flagged as the top-weight criterion: usefulness + ease to maintain *post challenge* (i.e., after the bounty ends, someone must be able to run it).
3. **Documentation quality** — README + Google Doc quality.
4. **Bug submission quality** — quality of bug reports submitted during onboarding/build.
5. **Bonus** — sharing on social media and tagging `@terminal3io` on X (a bonus, not a requirement).

There are **no numeric weights** in this listing (unlike some listings that carry explicit percentages); the only explicit weight marker is the "VERY IMPORTANT" tag on criterion 2.

---

## 3. The Sponsor / Who is Judging

- **Sponsor entity:** Terminal 3 Network — `sponsor.name: "Terminal 3 Network"`, `sponsor.url: "https://terminal3.io"`, `sponsor.slug: "terminal3io"` (note: `"isVerified": false` on the sponsor badge — they are a known protocol but have not completed Superteam's verified-sponsor badge process).
- **Point of contact (judge):** JSON `poc`: `firstName: "Ian"`, `lastName: "Chong"`, `username: "iancrj"` — **Ian Chong**, the same devrel lead who ran the previous T3N onboarding bounty (the prior listing's description note points to the same Telegram `@wardumb` for extra tokens). Public contact: `https://t.me/wardumb`.
- **What the sponsor explicitly says they want** (verbatim):
  - Title: "…build a trusted agent with T3N **that we can distribute / host**" — the sponsor wants deployable, hostable agents.
  - "Now looking for devs to build **useful agents for enterprises** on Terminal 3 that can be **easily maintained**"
  - "Include in submission if you would want to continue running it or prefer to **hand it over to us to maintain (+handover process)**."
  - "we have a **startup program & listing page** if you would want to continue running it" — winners who keep running their agent are offered a startup program / listing-page slot on Terminal 3.
  - Extra tokens on request: "if more tokens are required DM me at https://t.me/wardumb with your DID and quote Superteam."

---

## 4. Submission Requirements

**Exact text:** "A public Google Doc with public github repo, screenshots and any bug faced will be considered a completed submission"

Required deliverables (no more, no less):
1. **Public Google Doc** — narrative submission (per prior challenge convention: scope walkthrough, screenshots, bugs encountered, run/handover preference).
2. **Public GitHub repo** — the agent source.
3. **Screenshots** — proof of completing Quickstart/Walkthrough steps and the agent working.
4. **Bug reports** — "any bug faced" documented as part of the submission.

**Not required** (explicitly absent from this listing — do not over-engineer):
- ❌ No demo video requirement (unlike the DoraHacks T3 ADK challenge, which required one).
- ❌ No deployed testnet URL requirement.
- ❌ No X post requirement — posting and tagging `@terminal3io` is only a *bonus* criterion.
- ✅ Must have completed signup via `https://go.terminal3.io/adk-community` (SSO) and hold a DID + API key (this is an eligibility form question).

**Eligibility form (from JSON, all required):** Email address · DID generated from the signup page · "Would you want to continue running this / pass it to us to run it?"

---

## 5. Bug Reports: Reward & Scoring

- **There is no separate cash reward for bug reports** in this bounty. `"maxBonusSpots": 0` (no extra bonus prize spots), and the reward structure is exactly the 6-place 100/50/50/30/30/30 split.
- Bugs are scored through the **"Bug submission quality"** judging criterion, and bug documentation is part of **submission completeness**: "screenshots and any bug faced will be considered a completed submission".
- Practical implication: file bugs with high-quality write-ups (repro steps, screenshots, severity) — they count toward both criterion #4 and the documentation-quality impression, but do not earn separate payout.
- The previous onboarding challenge (`ai-id`, Aug 2026) used the identical mechanics ("Screenshot completion and highlight any bugs as a completed submission" + "Bug submission quality" criterion) — precedent confirms bugs are scored within the submission, not paid separately.

---

## 6. What Terminal 3 Is (official, README-ready)

**Official one-paragraph summary (docs.terminal3.io/intro/about-t3.md):**
> "Terminal 3 is a **data freedom company**. We want to empower a more **equitable digital future**, where users and enterprises have equal rights and protections across all platforms. Our technology makes **fully private data freely composable**, securing the world's most important asset while realizing its full value. Terminal 3 powers identity and trust infrastructure across enterprises, governments, and Web3 platforms worldwide."

**T3N (docs.terminal3.io/t3n/overview/what-is-t3n.md):**
> "T3 Network (T3N) is a **confidential computing network**. It is a cluster of nodes running inside hardware Trusted Execution Environments (TEEs) that **store and process private data confidentially, verifiably, and operator-blind**. Clients can prove their data reached genuine TEE hardware and was processed by audited code, and no single party (including node operators) can read or alter it. T3N addresses critical challenges in AI agent identity, permission and delegation, data privacy, and auditability challenges, making it suitable for high-stakes and inter-enterprise workflows."

**T3 Verify (terminal3.io/products/verify):**
> "Issue credentials that prove everything but reveal nothing. Convert KYC status, government IDs, asset ownership, certifications, or any other identity proof into a privacy-preserving Verifiable Credential. Prove your claims cryptographically while data remains encrypted in a Regulatory Vault and retrievable by permission for compliance."
- **190+ countries:** not on the current terminal3.io product page; it appears in third-party registries describing T3 Verify — "enterprise KYC/AML with real-time identity and liveness verification across **190+ countries** and reusable verifiable credentials" (apis.io provider listing; same wording on IQ.wiki, Oct 2025). Attribute carefully in a README (e.g., "KYC/AML verification in 190+ countries" with a soft source) or drop it.

**Agent Command (terminal3.io/solutions/agentic/ai-governance):**
> "Agent Command issues cryptographically-scoped mandates to AI agents. Every action is bounded, logged, and provable, satisfying the requirements of MAS AI Risk Guidelines, MindForge, and enterprise governance frameworks."
> "Every AI agent receives a signed, cryptographically-scoped credential (Smart VC) that identifies it, names its principal, and bounds what it can do. KYA brings the same rigour to machine identity that KYC brings to human identity."

**eIDAS 2.0:** I could **not** find the exact phrase "eIDAS 2.0" on any current terminal3.io or docs.terminal3.io page (checked home, verify, identity, T3N, docs index `llms.txt`, About). Closest verified link: DIF Newsletter #55 reports Terminal 3 CEO Gary Liu's presentation on decentralized identity for AI agents "sparked discussions on wallet interoperability and **EIDAS compliance**". If the README wants the EU-regulation angle, tie it to Smart VCs / verifiable credentials and cite the EUDI Wallet/eIDAS 2.0 regulatory context generically — do not attribute an "eIDAS 2.0 compliant" claim to Terminal 3's current official pages.

**ADK (five ideas, docs.terminal3.io/developers/adk/overview/adk-tour):** tenant identity (`did:t3n:...`), private tenant KV maps, TEE contracts (Rust→WASM in confidential hardware), delegated permission via Agent Auth (no blanket trust), and PII placeholders substituted inside the enclave.

---

## 7. Strategy Notes

- **Time-to-submit is criterion #1** and submissions are already at **62** (Sep 1). Submitting days before the Sep 16 15:59 UTC deadline costs points on an explicitly listed criterion; earlier is strictly better. "earlier, faster and more efficient the better."
- **The "VERY IMPORTANT" criterion is usefulness + ease to maintain *post challenge*.** Optimize the submission around: a boring, well-structured, documented repo; clear ops/run instructions; a running demo (screenshots/recording in the Google Doc); and an explicit **handover or continued-run statement** (the eligibility form asks this exact question).
- **Distribute/host is the sponsor's stated intent** — frame MANDATE as an enterprise agent T3N can host: hardware-TEE-sealed secrets, delegated agent auth (Agent Auth grant model), and audit logging are exactly the platform's selling points. Aligning MANDATE's pitch with T3 Verify / Agent Command / T3N audit-ledger language directly matches "useful agents for enterprises… easily maintained."
- **X post tagging @terminal3io is a bonus** — cheap points, do it at submission time.
- **Bug quality counts** — if you hit ADK bugs (docs refresh = real bug surface), file structured reports (steps, screenshots, expected vs actual); they feed criterion #4.
- **Token top-up path:** if 20,000 starter test tokens run short, DM `t.me/wardumb` with your DID and "Superteam".
- **Startup program / listing page:** winners who want to keep running their agent get an off-platform follow-up ("we have a startup program & listing page if you would want to continue running it") — a stronger prize than the USDC for a serious project. Say you want to continue running it (or offer handover) in the submission.
- **Previous challenges for reference** (what won before):
  - Superteam `ai-id` onboarding bounty (Aug 2026, 200 USDC total, same sponsor/POC): 1st 50, 2nd–6th 30. "Bonus: Willingness to go beyond the first contract and provide us an initial use case."
  - DoraHacks "Terminal 3 Agent Dev Kit Bounty Challenge (Launch Ed)" (June 2026): $2,000 cash pool + $3,000 GCP credits; 105 hackers, 67 projects; winners: **1st $1,000 Thia-Term** (payment infra for agents), **2nd $500 TrialMatch**, **3rd $500 Verigate** (counterparty DD agent); Agent Auth SDK winners included Gatekeeper Agent, Verigate, On the Record, T3Pay, Thia-Term. Pattern: delegated-auth agents with TEE-secured payments/verification won.
- **Deadline math:** Sep 16 15:59:59 UTC = Sep 16 16:59 WAT (UTC+1) = Sep 16 11:59 ET. Don't test it — submit 24h+ early.
- **Winner announcement:** by Sep 23, 2026 ("as scheduled by the sponsor").

---

## SOURCES (all fetched live on 2026-09-01)

1. **https://superteam.fun/earn/listing/t3n-agent-build-challenge** — listing page; full structured payload extracted from embedded `__NEXT_DATA__` JSON (listing id `657bf11b-89e4-42ea-bd96-c4339df44f2e`). This is the authoritative source for title, rewards, deadline, eligibility, judging text, POC, sponsor.
2. **https://superteam.fun/api/listings?query=terminal&take=50** — Superteam Earn public JSON search endpoint (earn.superteam.fun 308-redirects here); confirmed listing slug/reward/deadline/status. Used to discover the slug.
3. **https://superteam.fun/earn/listing/ai-id/** — previous T3N onboarding bounty ("Create Agent ID, claim free tokens, & deploy first RUST contract on the network", 200 USDC, deadline 2026-08-18, In Review) — `__NEXT_DATA__` payload extracted for comparison.
4. **https://earn.superteam.fun/api/listings/ai-id** — attempted JSON endpoint; fetch failed (CRAWL_NOT_FOUND via extractor; the host 308-redirects to superteam.fun). Noted as a dead endpoint shape.
5. **https://docs.terminal3.io/** — official docs index (About page).
6. **https://docs.terminal3.io/llms.txt** — full docs map (57 entries).
7. **https://docs.terminal3.io/intro/about-t3.md** — official About ("data freedom company" paragraph).
8. **https://docs.terminal3.io/intro/platform.md** — Platform Overview (T3N, T3 Identity, T3 Verify, ADK, Agent Command).
9. **https://docs.terminal3.io/t3n/overview/what-is-t3n.md** — What is T3N (TEE confidential computing definition).
10. **https://docs.terminal3.io/t3n/use-cases/delegate-access-to-agent.md** — delegated agent access use case.
11. **https://docs.terminal3.io/developers/adk/overview/what-is-adk.md** — ADK overview.
12. **https://docs.terminal3.io/developers/adk/overview/adk-tour** — ADK Tour (five ideas; tenant DID, KV maps, TEE contracts, Agent Auth, placeholders).
13. **https://docs.terminal3.io/developers/adk/get-started/quickstart** — Quickstart (claim key, skill file, first authenticated call).
14. **https://docs.terminal3.io/developers/adk/overview/agent-auth-adk** — Agent Auth (agent DID, delegated grants, auth vs authorization).
15. **https://www.terminal3.io/** — homepage ("data freedom company", products list, 10M+ users claim).
16. **https://terminal3.io/products/verify** — T3 Verify product page (fetched via curl after extractor 403; full text extracted).
17. **https://terminal3.io/solutions/agentic/ai-governance** — Agent Command / enterprise AI governance page (fetched via curl).
18. **https://docs.terminal3.io/documentation/products/verify** — attempted; returns client-rendered shell (~3 bytes text) — noted as not directly extractable.
19. **https://dorahacks.io/hackathon/t3adkdevchallenge** and **https://dorahacks.io/hackathon/t3adkdevchallenge/report** — previous T3 ADK launch-edition hackathon (prizes, winners, organizer blurb).
20. **https://iq.wiki/wiki/terminal-3** — third-party profile (T3 Verify "over 190 countries" wording; last updated Oct 2025).
21. **https://apis.io/providers/terminal-3/** — third-party provider listing ("190+ countries", Agent Command, T3N Intel TDX description).

*Verification notes:* All quotes marked verbatim were copied from the fetched payloads above. The "190+ countries" figure is third-party-sourced (items 20–21), not current official site copy. The phrase "eIDAS 2.0" was not found on any official Terminal 3 page fetched; closest link is DIF Newsletter #55 (Gary Liu presentation, "EIDAS compliance" discussion), found via search but not listed as a fetched source.
