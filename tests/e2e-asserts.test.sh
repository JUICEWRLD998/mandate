#!/usr/bin/env bash
# =============================================================================
# e2e-asserts.test.sh — self-verifying harness for tests/e2e-asserts.sh.
#
# Run from the repo root:   bash tests/e2e-asserts.test.sh
#
# Every helper in the library gets a POSITIVE and a NEGATIVE case (negative =
# the helper must return 1). The harness prints 'PASS <case>' per case plus a
# final summary, and exits 0 only when every case passes. Fixtures live in a
# mktemp dir that is removed on exit.
# =============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/e2e-asserts.sh"

# Source the library (twice — the double-source guard must be idempotent).
source "$LIB" || { echo "FAIL cannot source $LIB" >&2; exit 1; }
source "$LIB"

FAILURES=0
TOTAL=0

pass_case() { echo "PASS $1"; }
fail_case() {
    echo "FAIL $1" >&2
    FAILURES=$((FAILURES + 1))
}

# expect_pass DESC CMD...        — case must succeed (rc 0)
expect_pass() {
    local desc="$1"
    shift
    TOTAL=$((TOTAL + 1))
    local out rc
    out=$("$@" 2>&1)
    rc=$?
    if [[ $rc -eq 0 ]]; then
        pass_case "$desc"
    else
        fail_case "$desc (expected rc 0, got $rc): $(printf '%s' "$out" | head -n 3)"
    fi
}

# expect_fail DESC CMD...        — case must fail (rc != 0)
expect_fail() {
    local desc="$1"
    shift
    TOTAL=$((TOTAL + 1))
    local out rc
    out=$("$@" 2>&1)
    rc=$?
    if [[ $rc -ne 0 ]]; then
        pass_case "$desc"
    else
        fail_case "$desc (expected non-zero rc, got 0)"
    fi
}

# expect_fail_msg DESC PATTERN CMD... — case must fail AND stderr/stdout must
#                                       contain PATTERN (asserts the FAIL detail)
expect_fail_msg() {
    local desc="$1" pat="$2"
    shift 2
    TOTAL=$((TOTAL + 1))
    local out rc
    out=$("$@" 2>&1)
    rc=$?
    if [[ $rc -ne 0 && "$out" == *"$pat"* ]]; then
        pass_case "$desc"
    else
        fail_case "$desc (rc=$rc, wanted pattern '$pat' in output; got: $(printf '%s' "$out" | head -n 2))"
    fi
}

# expect_out DESC EXPECTED CMD... — case must succeed AND print exactly EXPECTED
expect_out() {
    local desc="$1" expected="$2"
    shift 2
    TOTAL=$((TOTAL + 1))
    local out rc
    out=$("$@" 2>&1)
    rc=$?
    if [[ $rc -eq 0 && "$out" == "$expected" ]]; then
        pass_case "$desc"
    else
        fail_case "$desc (rc=$rc, expected output '$expected', got '$out')"
    fi
}

# ---- fixtures --------------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

f3="$TMP/three.txt"      # exactly 3 lines
printf 'alpha\nbeta\ngamma\n' > "$f3"
printf '' > "$TMP/empty.txt"

fc="$TMP/contains.txt"   # IBAN on line 2, clean last line
printf 'first line\nGB29 NWBK 6016 1331 9268 19 present here\nlast line\n' > "$fc"

fn="$TMP/absent.txt"     # needle nowhere
printf 'nothing sensitive\nall clean here\n' > "$fn"

fl="$TMP/lastline.txt"   # needle on the FINAL line only
printf 'plain line one\nfinal marker GB29 NWBK\n' > "$fl"

fj="$TMP/data.json"      # one-line JSON, value with spaces
printf '%s\n' '{"payment_id":"pay_1","iban":"GB29 NWBK 6016 1331 9268 19","iban_sha256":"e5e9fa1ba31ecd1ae84f75caaa474f3a663f05f4"}' > "$fj"

# ---- e2e_require -----------------------------------------------------------
expect_pass "require: existing readable file" \
    e2e_require "$f3" "require pos"
expect_fail "require: missing file returns 1" \
    e2e_require "$TMP/does-not-exist.txt"

# ---- e2e_assert_file_contains / _not_contains ------------------------------
expect_pass "contains: needle present" \
    e2e_assert_file_contains "$fc" "GB29 NWBK" "contains pos"
expect_fail "contains: needle absent returns 1" \
    e2e_assert_file_contains "$fn" "GB29 NWBK"
expect_pass "not_contains: needle absent" \
    e2e_assert_file_not_contains "$fn" "GB29 NWBK" "not_contains pos"
expect_fail "not_contains: needle present returns 1" \
    e2e_assert_file_not_contains "$fc" "GB29 NWBK"

# ---- e2e_assert_last_line_contains -----------------------------------------
expect_pass "last_line_contains: needle on final line" \
    e2e_assert_last_line_contains "$fl" "GB29 NWBK" "last_line pos"
expect_fail "last_line_contains: needle earlier, not on last line" \
    e2e_assert_last_line_contains "$fc" "GB29 NWBK"
expect_fail "last_line_contains: needle absent returns 1" \
    e2e_assert_last_line_contains "$fn" "GB29 NWBK"

# ---- e2e_assert_file_line_count --------------------------------------------
expect_pass "line_count: exact match (3)" \
    e2e_assert_file_line_count "$f3" "3" "line_count pos"
expect_fail "line_count: mismatch returns 1" \
    e2e_assert_file_line_count "$f3" "4"
expect_fail "line_count: non-integer EXPECTED returns 1" \
    e2e_assert_file_line_count "$f3" "lots"
expect_pass "line_count: empty file counts 0" \
    e2e_assert_file_line_count "$TMP/empty.txt" "0"

# ---- e2e_count_lines (getter) ----------------------------------------------
expect_out "count_lines: trimmed count is 3" "3" \
    e2e_count_lines "$f3"
expect_out "count_lines: empty file counts 0" "0" \
    e2e_count_lines "$TMP/empty.txt"
expect_fail "count_lines: missing file returns 1" \
    e2e_count_lines "$TMP/does-not-exist.txt"

# ---- e2e_extract_json_field (getter) ---------------------------------------
expect_out "extract_json_field: value with spaces" \
    'GB29 NWBK 6016 1331 9268 19' \
    e2e_extract_json_field "$fj" iban
expect_out "extract_json_field: absent field echoes empty, rc 0" "" \
    e2e_extract_json_field "$fj" status
expect_fail "extract_json_field: missing file returns 1" \
    e2e_extract_json_field "$TMP/does-not-exist.txt" iban

# ---- e2e_assert_sha256_matches ---------------------------------------------
PLAIN='GB29 NWBK 6016 1331 9268 19'
DIGEST="$(printf '%s' "$PLAIN" | sha256sum | cut -d' ' -f1)"
NL_DIGEST="$(printf '%s\n' "$PLAIN" | sha256sum | cut -d' ' -f1)"

expect_pass "sha256: exact match (printf %%s semantics)" \
    e2e_assert_sha256_matches "$PLAIN" "$DIGEST" "sha pos"
expect_fail "sha256: wrong digest returns 1" \
    e2e_assert_sha256_matches "$PLAIN" "0000000000000000000000000000000000000000000000000000000000000000"
expect_fail "sha256: newline-suffixed digest must not match (no trailing NL)" \
    e2e_assert_sha256_matches "$PLAIN" "$NL_DIGEST"
expect_fail "sha256: missing digest returns 1" \
    e2e_assert_sha256_matches "$PLAIN" ""

# ---- e2e_assert_repo_no_plaintext_iban --------------------------------------
# (1) src/ok.rs — IBAN hits only INSIDE a #[cfg(test)] module  -> must PASS.
mkdir -p "$TMP/repo_ok/src"
cat > "$TMP/repo_ok/src/ok.rs" <<'EOF'
// production code first — no PII here
pub fn settle() -> u64 { 42 }

#[cfg(test)]
mod tests {
    use super::*;
    // fake-but-plausible fixture PII is legal ONLY inside #[cfg(test)]
    const FAKE_IBAN: &str = "GB29 NWBK 6016 1331 9268 19";
    const FAKE_IBAN_DUP: &str = "GB29 NWBK 6016 1331 9268 19";
    const FAKE_BANK: &str = "Ada Bank";

    #[test]
    fn fixture_stays_in_tests() {
        assert!(FAKE_IBAN.len() > 10);
    }
}
EOF
cat > "$TMP/repo_ok/src/app.ts" <<'EOF'
// benign production file — no IBAN, only the bank brand name is fine alone
export const BANK_BRAND = "Ada Bank";
EOF
expect_pass "repo: .rs IBAN under cfg(test) accepted (multiple hits)" \
    e2e_assert_repo_no_plaintext_iban "$TMP/repo_ok" "repo ok"

# (2) src/bad.rs — IBAN line ABOVE any #[cfg(test)] marker  -> must FAIL,
#     with '<path>:<line>' naming the offending line.
mkdir -p "$TMP/repo_badrs/src"
cat > "$TMP/repo_badrs/src/bad.rs" <<'EOF'
const LEAKED_IBAN: &str = "GB29 NWBK 6016 1331 9268 19";
pub fn go() {}

#[cfg(test)]
mod tests {
    // marker arrives too late for line 1; nothing here anyway
}
EOF
expect_fail_msg "repo: .rs IBAN above cfg(test) rejected (per-line)" \
    'bad.rs:1 plaintext IBAN in non-test code' \
    e2e_assert_repo_no_plaintext_iban "$TMP/repo_badrs" "repo badrs"

# (3) tests/ + fixtures/ dirs, *.log, package-lock.json  -> all exempt: PASS.
mkdir -p "$TMP/repo_exempt/tests" "$TMP/repo_exempt/fixtures" \
         "$TMP/repo_exempt/logs" "$TMP/repo_exempt/deps"
cat > "$TMP/repo_exempt/tests/exempt.test.ts" <<'EOF'
// host/tests-style fixture: fake PII is allowed in test-only files
export const fixture = {
    iban: "GB29 NWBK 6016 1331 9268 19",
    bank: "Ada Bank",
};
EOF
printf '{"iban":"GB29 NWBK 6016 1331 9268 19","bank":"Ada Bank"}\n' \
    > "$TMP/repo_exempt/fixtures/note.json"
printf '2026-09-02T10:00:00Z settle pay_1 iban=GB29 NWBK 6016 1331 9268 19 ok\n' \
    > "$TMP/repo_exempt/logs/rail.log"
printf '{"name":"dep","version":"1.0.0","lock":true}\nGB29 NWBK 6016 1331 9268 19\n' \
    > "$TMP/repo_exempt/deps/package-lock.json"
printf 'dummy\nGB29 NWBK 6016 1331 9268 19\n' > "$TMP/repo_exempt/deps/vendor.lock"
expect_pass "repo: tests/ + fixtures/ dirs, *.log, *.lock exempt" \
    e2e_assert_repo_no_plaintext_iban "$TMP/repo_exempt" "repo exempt"

# (4) non-test, non-.rs authored files (run.sh, src/app.ts) -> must FAIL,
#     naming each offending file.
mkdir -p "$TMP/repo_nonrs/src"
cat > "$TMP/repo_nonrs/run.sh" <<'EOF'
#!/usr/bin/env bash
echo "bank: Ada Bank, iban: GB29 NWBK 6016 1331 9268 19"
EOF
cat > "$TMP/repo_nonrs/src/app.ts" <<'EOF'
export const ACCOUNT = "GB29 NWBK 6016 1331 9268 19";
EOF
expect_fail_msg "repo: plain script with IBAN rejected (names run.sh)" \
    'run.sh:' \
    e2e_assert_repo_no_plaintext_iban "$TMP/repo_nonrs" "repo nonrs"
expect_fail_msg "repo: plain .ts source with IBAN rejected (names app.ts)" \
    'app.ts:' \
    e2e_assert_repo_no_plaintext_iban "$TMP/repo_nonrs" "repo nonrs"

# (4b) markdown docs + docs/ dir -> EXEMPT (docs quote the demo payload to
#      illustrate the magic moment; the invariant guards executable source).
mkdir -p "$TMP/repo_docs/docs/research"
cat > "$TMP/repo_docs/README.md" <<'EOF'
The rail receives `{"iban":"GB29 NWBK 6016 1331 9268 19"}` (fixture).
EOF
cat > "$TMP/repo_docs/docs/research/note.md" <<'EOF'
payload example: GB29 NWBK 6016 1331 9268 19
EOF
cat > "$TMP/repo_docs/docs/spec.txt" <<'EOF'
plain-text doc under docs/ with GB29 NWBK 6016 1331 9268 19
EOF
expect_pass "repo: *.md and docs/ dir exempt (markdown illustration)" \
    e2e_assert_repo_no_plaintext_iban "$TMP/repo_docs" "repo docs"

# ---- double-source guard ---------------------------------------------------
TOTAL=$((TOTAL + 1))
if source "$LIB" >/dev/null 2>&1 && declare -F e2e_assert_file_contains >/dev/null 2>&1; then
    pass_case "double-source guard: re-sourcing is idempotent"
else
    fail_case "double-source guard broken (re-source failed or lost definitions)"
fi

# ---- summary ----------------------------------------------------------------
if [[ $FAILURES -eq 0 ]]; then
    echo "PASS all $TOTAL e2e-assert cases"
    exit 0
fi
echo "FAIL $FAILURES of $TOTAL e2e-assert cases" >&2
exit 1
