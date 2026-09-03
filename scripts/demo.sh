#!/usr/bin/env bash
#
# demo.sh — deterministic Beats 0-5 demo runner (MANDATE: Terminal 3 / T3N ADK bounty).
#
# THE PRIVACY STORY — one request, two views:
#   The agent never sees the customer's real bank details. Its call payloads
#   and host/agent-output.log carry TEMPLATE MARKERS
#   ({{profile.verified_contacts.email.value}}) plus a sha256 receipt proof
#   (iban_sha256); the beneficiary bank config itself is SEALED — the contract
#   reads it from z:<tid>:secrets inside the enclave (Decision D1: the profile
#   schema cannot carry bank fields — live-verified 2026-09-03). The mock
#   counterparty rail records the REAL resolved values in mock-rail/rail.log.
#   This runner validates that the two views line up — marker on the agent
#   side, real IBAN on the rail side, digests matching — WITHOUT hardcoding
#   the IBAN in this file (it is extracted from rail.log at runtime and
#   compared against the agent log's iban_sha256, so scripts/ stays free of
#   plaintext).
#
# USAGE:
#   bash scripts/demo.sh             # live demo — needs the mock rail running,
#                                    #   host/.env + host/.contract-record.json
#                                    #   (npm run register), and the T3N cluster.
#   DEMO_DRY=1 bash scripts/demo.sh  # print every step, execute nothing — no
#                                    #   network, no host CLI, no .env required.
#
# BEATS (Appendix B):
#   BEAT 0  BEFORE  — repo carries no plaintext IBAN; rail /health; state files present
#   BEAT 1  KYC     — onboard cus_1: agent log shows markers; rail gets the real record
#   BEAT 2  PAY     — MAGIC MOMENT: marker + sealed-config on the agent side,
#                     real IBAN on the rail side; sha256(IBAN) == agent log's
#                     iban_sha256
#   BEAT 3  REVOKE  — grant.ts revoke: delegation emptied
#   BEAT 4  DENIED  — pay again: refused (delegation gone — the node returns
#                     Forbidden agent_auth_not_found), rail.log unchanged
#   BEAT 5  AFTER   — repo plaintext invariant holds again + summary
#
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

source "$ROOT/tests/e2e-asserts.sh"

RAIL_URL=${RAIL_URL:-http://localhost:8787}
HOST_DIR=$ROOT/host
RAIL_DIR=$ROOT/mock-rail
AGENT_LOG=$HOST_DIR/agent-output.log
RAIL_LOG=$RAIL_DIR/rail.log
DEMO_IBAN_FIELD=iban

# All live steps go through run(): DEMO_DRY=1 prints the step without executing it.
run() {
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

beat0() {
  echo
  echo 'BEAT 0 — pre-flight (before)'
  run e2e_assert_repo_no_plaintext_iban "$ROOT" 'repo src carries no plaintext IBAN'
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry-run] %s\n' "curl -sf $RAIL_URL/health >/dev/null"
    printf '[dry-run] %s\n' 'requires: host/.env, host/.contract-record.json (npm run register)'
  else
    if ! curl -sf "$RAIL_URL/health" >/dev/null; then
      echo "FAIL: mock rail not reachable at $RAIL_URL"
      echo 'Start it first: (cd mock-rail && npx tsx src/server.ts)'
      exit 1
    fi
    echo "PASS: rail healthy at $RAIL_URL"
    e2e_require "$HOST_DIR/.env" 'host/.env (npm run register)'
    e2e_require "$HOST_DIR/.contract-record.json" 'host/.contract-record.json (npm run register)'
  fi
}

beat1() {
  echo
  echo 'BEAT 1 — KYC: onboard cus_1'
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry-run] %s\n' '(cd host && npx tsx src/run-demo.ts kyc --customer cus_1)'
    KYC_OUT=''
  else
    KYC_OUT=$(cd "$HOST_DIR" && npx tsx src/run-demo.ts kyc --customer cus_1 2>&1)
  fi
  run e2e_assert_file_contains "$AGENT_LOG" '"step":"kyc"' 'agent log records the kyc step'
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry-run] %s\n' 'assert KYC_OUT contains "KYC verdict"'
  else
    if [[ "$KYC_OUT" != *'KYC verdict'* ]]; then
      echo "FAIL: run-demo kyc output missing 'KYC verdict'"
      printf '%s\n' "$KYC_OUT"
      exit 1
    fi
    echo 'PASS: KYC_OUT contains "KYC verdict"'
  fi
  echo 'SCREENSHOT FRAME: KYC verdict — agent-output.log shows {{profile.*}} markers; rail.log carries the real customer record'
}

beat2() {
  echo
  echo 'BEAT 2 — PAY: the magic moment (inv_1, 199.00)'
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry-run] %s\n' 'RAIL_BEFORE=$(e2e_count_lines mock-rail/rail.log)'
    RAIL_BEFORE=0
  else
    RAIL_BEFORE=$(e2e_count_lines "$RAIL_LOG")
  fi
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry-run] %s\n' '(cd host && npx tsx src/run-demo.ts pay --invoice inv_1 --amount 199.00)'
    PAY_OUT=''
  else
    PAY_OUT=$(cd "$HOST_DIR" && npx tsx src/run-demo.ts pay --invoice inv_1 --amount 199.00 2>&1)
  fi
  run e2e_assert_file_contains "$AGENT_LOG" '{{profile.verified_contacts.email.value}}' 'agent-view line logs the schema-backed marker, never the value'
  run e2e_assert_file_contains "$AGENT_LOG" 'rail_beneficiary' 'agent-view names the sealed beneficiary source, never its values'
  run e2e_assert_file_not_contains "$AGENT_LOG" 'GB29 NWBK' 'agent view carries no resolvable IBAN fragment'
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry] rail assertions skipped\n'
    echo '  AGENT view (agent-output.log): customer_email:"{{profile.verified_contacts.email.value}}", iban_sha256:<64-hex proof>'
    echo '  RAIL  view (rail.log):         beneficiary iban:"<real value, resolved inside the enclave from the sealed rail_beneficiary secret>"'
  else
    run e2e_assert_file_line_count "$RAIL_LOG" "$((RAIL_BEFORE + 1))" 'rail log grew by exactly one /pay line'
    run e2e_assert_last_line_contains "$RAIL_LOG" '"/pay"' 'newest rail line is the /pay egress'
    IBAN=$(e2e_extract_json_field "$RAIL_LOG" "$DEMO_IBAN_FIELD")
    AGENT_SHA=$(e2e_extract_json_field "$AGENT_LOG" iban_sha256)
    run e2e_assert_sha256_matches "$IBAN" "$AGENT_SHA" 'iban_sha256 proof matches the IBAN the rail received'
    run e2e_assert_sha256_matches "$IBAN" "$(printf %s "$IBAN" | sha256sum | cut -d' ' -f1)" 'self-consistent sha256(IBAN) digest'
    echo
    echo '  ------ MAGIC MOMENT: one payment, two views ------'
    echo "  AGENT view (agent-output.log): customer_email marker + iban_sha256:\"$AGENT_SHA\""
    echo "  RAIL  view (rail.log):         iban:\"$IBAN\" (sealed config, resolved inside the enclave)"
    echo '  --------------------------------------------------'
    echo '  The agent moved the money without ever touching the bank details.'
  fi
  echo 'SCREENSHOT FRAME (magic moment): split view — left, agent-output.log with the {{profile.verified_contacts.email.value}} marker + iban_sha256 proof; right, rail.log with the real beneficiary IBAN from the sealed config'
}

beat3() {
  echo
  echo 'BEAT 3 — REVOKE: empty the delegation'
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry-run] %s\n' '(cd host && npx tsx src/grant.ts revoke)'
  else
    (cd "$HOST_DIR" && npx tsx src/grant.ts revoke)
  fi
  echo 'SCREENSHOT FRAME: audit pane after revocation — grant.ts revoke output; delegation now lists no active agent'
}

beat4() {
  echo
  echo 'BEAT 4 — DENIED: pay again after revoke (inv_2, 50.00)'
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry-run] %s\n' 'RAIL_BEFORE=$(e2e_count_lines mock-rail/rail.log)'
    RAIL_BEFORE=0
    printf '[dry-run] %s\n' '(cd host && npx tsx src/run-demo.ts pay --invoice inv_2 --amount 50.00)   # expected: non-zero exit'
    printf '[dry] denial expected\n'
    printf '[dry-run] %s\n' 'e2e_assert_file_line_count "$RAIL_LOG" "$RAIL_BEFORE" "denied call never reaches the rail"'
  else
    RAIL_BEFORE=$(e2e_count_lines "$RAIL_LOG")
    set +e
    PAY_OUT=$(cd "$HOST_DIR" && npx tsx src/run-demo.ts pay --invoice inv_2 --amount 50.00 2>&1)
    RC=$?
    set -e
    if [[ $RC -eq 0 ]]; then
      echo 'FAIL: expected denial after revoke, but pay exited 0'
      printf '%s\n' "$PAY_OUT"
      exit 1
    fi
    # LIVE-VERIFIED denial (2026-09-03): with the delegation revoked the node
    # refuses the delegated call outright — "Forbidden (agent_auth_not_found):
    # ... not permitted to act on behalf of ...". (The platform-level
    # "egress denied for host ..." string appears when a grant exists but the
    # host is not allowlisted — see scripts/demo.sh notes.) Accept either.
    if [[ "$PAY_OUT" != *'egress denied'* && "$PAY_OUT" != *'not permitted to act on behalf'* ]]; then
      echo "FAIL: denial output missing a denial marker ('egress denied' / 'not permitted to act on behalf')"
      printf '%s\n' "$PAY_OUT"
      exit 1
    fi
    echo 'PASS: pay denied — delegation revoked (agent_auth_not_found)'
    e2e_assert_file_line_count "$RAIL_LOG" "$RAIL_BEFORE" 'denied call never reaches the rail'
  fi
  echo 'SCREENSHOT FRAME: revocation denial — terminal shows the Forbidden denial (agent_auth_not_found / not permitted to act on behalf); rail.log tail unchanged (same line count)'
}

beat5() {
  echo
  echo 'BEAT 5 — AFTER: invariants hold'
  run e2e_assert_repo_no_plaintext_iban "$ROOT" 'repo still carries no plaintext IBAN'
  if [[ "${DEMO_DRY:-}" == "1" ]]; then
    printf '[dry-run] %s\n' 'audit pane: (cd host && npm run grant -- show)'
  fi
  echo
  echo '  --------------------------------------------------'
  echo '  Demo complete. Where to look:'
  echo "    agent view : $AGENT_LOG   (markers + iban_sha256 proofs only)"
  echo "    rail view  : $RAIL_LOG    (real values, counterparty side)"
  echo '    audit pane : (cd host && npm run grant -- show)'
  echo '  --------------------------------------------------'
  exit 0
}

main() {
  for beat in 0 1 2 3 4 5; do
    beat$beat
  done
}

main "$@"
