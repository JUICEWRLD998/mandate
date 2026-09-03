#!/usr/bin/env bash
# =============================================================================
# e2e-asserts.sh — reusable end-to-end assertion library for the T3N ADK
# bounty demo (MANDATE / Terminal 3).
#
# This file is SOURCED, never executed. scripts/demo.sh sources it and calls
# the helpers below at top level under `set -euo pipefail`; the self-verifying
# harness tests/e2e-asserts.test.sh sources it too.
#
# API CONTRACT for every e2e_assert_* / e2e_require helper:
#   * on success  -> prints one line  'PASS <label-or-description>'  to stdout
#                    and returns 0;
#   * on failure  -> prints one line  'FAIL <details>'  to stderr and RETURNS 1.
#                    Helpers NEVER call exit(): the demo caller runs under
#                    `set -e` and aborts itself on the non-zero return, while
#                    the test harness inspects return codes directly.
#   * every helper is safe to call under `set -euo pipefail` (no unguarded
#     failing command may sit outside a conditional context).
#
# The two getters (e2e_count_lines, e2e_extract_json_field) are the exception
# to the PASS/FAIL rule: they print ONLY their value to stdout (nothing else),
# so their output can be captured with $( ... ). They return 1 with a FAIL line
# on stderr only when the underlying file cannot be read.
#
# Why this library exists: the demo's scored trust assertions are
#   * markers in the agent log            -> file contains / not-contains,
#                                              last-line checks;
#   * real values in rail.log             -> JSON field extraction + the
#                                              'rail.log unchanged after the
#                                              denied beat' line-count check;
#   * iban_sha256 proof of receipt        -> sha256 match of the real IBAN;
#   * no plaintext IBAN in production code -> e2e_assert_repo_no_plaintext_iban.
# They must be reusable, deterministic, and self-tested without any live
# testnet — hence this library + tests/e2e-asserts.test.sh.
# =============================================================================

# Guard against double-source: sourcing twice is a no-op (demo.sh may re-source
# after re-loading config).
if declare -F e2e_assert_file_contains >/dev/null 2>&1; then
    return 0
fi

# ---------------------------------------------------------------------------
# e2e_require FILE [LABEL]
#   Passes when FILE exists and is readable.
# ---------------------------------------------------------------------------
e2e_require() {
    local file="${1:-}" label="${2:-}"
    if [[ -z "$file" ]]; then
        echo "FAIL e2e_require: missing FILE argument" >&2
        return 1
    fi
    if [[ ! -f "$file" || ! -r "$file" ]]; then
        echo "FAIL ${label:+$label: }file '$file' does not exist or is not readable" >&2
        return 1
    fi
    echo "PASS ${label:-e2e_require: '$file' exists and is readable}"
    return 0
}

# ---------------------------------------------------------------------------
# e2e_assert_file_contains FILE NEEDLE [LABEL]
#   Passes when NEEDLE (fixed string, not regex) occurs anywhere in FILE.
# ---------------------------------------------------------------------------
e2e_assert_file_contains() {
    local file="${1:-}" needle="${2:-}" label="${3:-}"
    if [[ -z "$file" || -z "$needle" ]]; then
        echo "FAIL e2e_assert_file_contains: missing FILE or NEEDLE argument" >&2
        return 1
    fi
    if [[ ! -f "$file" || ! -r "$file" ]]; then
        echo "FAIL ${label:+$label: }file '$file' does not exist or is not readable" >&2
        return 1
    fi
    if grep -qF -- "$needle" "$file"; then
        echo "PASS ${label:-e2e_assert_file_contains: '$needle' found in '$file'}"
        return 0
    fi
    echo "FAIL ${label:+$label: }needle '$needle' not found in '$file'" >&2
    return 1
}

# ---------------------------------------------------------------------------
# e2e_assert_file_not_contains FILE NEEDLE [LABEL]
#   Passes when NEEDLE (fixed string) occurs nowhere in FILE.
# ---------------------------------------------------------------------------
e2e_assert_file_not_contains() {
    local file="${1:-}" needle="${2:-}" label="${3:-}"
    if [[ -z "$file" || -z "$needle" ]]; then
        echo "FAIL e2e_assert_file_not_contains: missing FILE or NEEDLE argument" >&2
        return 1
    fi
    if [[ ! -f "$file" || ! -r "$file" ]]; then
        echo "FAIL ${label:+$label: }file '$file' does not exist or is not readable" >&2
        return 1
    fi
    if grep -qF -- "$needle" "$file"; then
        echo "FAIL ${label:+$label: }needle '$needle' unexpectedly found in '$file'" >&2
        return 1
    fi
    echo "PASS ${label:-e2e_assert_file_not_contains: '$needle' absent from '$file'}"
    return 0
}

# ---------------------------------------------------------------------------
# e2e_assert_last_line_contains FILE NEEDLE [LABEL]
#   Passes when NEEDLE occurs on the FINAL line of FILE (tail -n1 semantics;
#   a hit on any earlier line does not count).
# ---------------------------------------------------------------------------
e2e_assert_last_line_contains() {
    local file="${1:-}" needle="${2:-}" label="${3:-}"
    if [[ -z "$file" || -z "$needle" ]]; then
        echo "FAIL e2e_assert_last_line_contains: missing FILE or NEEDLE argument" >&2
        return 1
    fi
    if [[ ! -f "$file" || ! -r "$file" ]]; then
        echo "FAIL ${label:+$label: }file '$file' does not exist or is not readable" >&2
        return 1
    fi
    if tail -n 1 "$file" | grep -qF -- "$needle"; then
        echo "PASS ${label:-e2e_assert_last_line_contains: last line of '$file' contains '$needle'}"
        return 0
    fi
    echo "FAIL ${label:+$label: }last line of '$file' does not contain '$needle'" >&2
    return 1
}

# ---------------------------------------------------------------------------
# e2e_assert_file_line_count FILE EXPECTED [LABEL]
#   Passes when FILE has exactly EXPECTED lines (wc -l semantics). Used for
#   'rail.log unchanged after the denied beat'.
# ---------------------------------------------------------------------------
e2e_assert_file_line_count() {
    local file="${1:-}" expected="${2:-}" label="${3:-}"
    if [[ -z "$file" ]]; then
        echo "FAIL e2e_assert_file_line_count: missing FILE argument" >&2
        return 1
    fi
    if [[ -z "$expected" ]]; then
        echo "FAIL ${label:+$label: }e2e_assert_file_line_count: missing EXPECTED argument" >&2
        return 1
    fi
    if [[ ! "$expected" =~ ^[0-9]+$ ]]; then
        echo "FAIL ${label:+$label: }expected line count '$expected' is not a non-negative integer" >&2
        return 1
    fi
    if [[ ! -f "$file" || ! -r "$file" ]]; then
        echo "FAIL ${label:+$label: }file '$file' does not exist or is not readable" >&2
        return 1
    fi
    local actual
    actual=$(wc -l < "$file" | tr -d '[:space:]') || {
        echo "FAIL ${label:+$label: }could not count lines in '$file'" >&2
        return 1
    }
    if [[ "$actual" -eq "$expected" ]]; then
        echo "PASS ${label:-e2e_assert_file_line_count: '$file' has exactly $expected lines}"
        return 0
    fi
    echo "FAIL ${label:+$label: }'$file' has $actual lines, expected $expected" >&2
    return 1
}

# ---------------------------------------------------------------------------
# e2e_count_lines FILE
#   GETTER: echoes the trimmed line count of FILE (and nothing else, so it can
#   be captured: n=$(e2e_count_lines rail.log)). Fails (rc 1, FAIL on stderr)
#   only when FILE cannot be read.
# ---------------------------------------------------------------------------
e2e_count_lines() {
    local file="${1:-}"
    if [[ -z "$file" ]]; then
        echo "FAIL e2e_count_lines: missing FILE argument" >&2
        return 1
    fi
    if [[ ! -f "$file" || ! -r "$file" ]]; then
        echo "FAIL e2e_count_lines: file '$file' does not exist or is not readable" >&2
        return 1
    fi
    local n
    n=$(wc -l < "$file" | tr -d '[:space:]') || {
        echo "FAIL e2e_count_lines: could not count lines in '$file'" >&2
        return 1
    }
    printf '%s\n' "$n"
    return 0
}

# ---------------------------------------------------------------------------
# e2e_extract_json_field FILE FIELD
#   GETTER: echoes the value of the FIRST occurrence of  "FIELD":"<value>"
#   in FILE. FIELD is passed WITHOUT quotes. Echoes an empty string (rc 0)
#   when the field is absent; fails (rc 1, FAIL on stderr) only when FILE
#   cannot be read. Used to pull the real IBAN out of rail.log and
#   iban_sha256 out of agent-output.log.
# ---------------------------------------------------------------------------
e2e_extract_json_field() {
    local file="${1:-}" field="${2:-}"
    if [[ -z "$file" || -z "$field" ]]; then
        echo "FAIL e2e_extract_json_field: missing FILE or FIELD argument" >&2
        return 1
    fi
    if [[ ! -f "$file" || ! -r "$file" ]]; then
        echo "FAIL e2e_extract_json_field: file '$file' does not exist or is not readable" >&2
        return 1
    fi
    local value
    value=$(grep -o "\"$field\":\"[^\"]*\"" "$file" | head -n 1 | sed 's/^"[^"]*":"//; s/"$//') || true
    printf '%s\n' "$value"
    return 0
}

# ---------------------------------------------------------------------------
# e2e_assert_sha256_matches PLAINTEXT DIGEST [LABEL]
#   Passes when the sha256 of PLAINTEXT equals DIGEST. PLAINTEXT is hashed with
#   printf '%s' (NO trailing newline), matching the host's iban_sha256
#   proof-of-receipt computation. DIGEST comparison is case-insensitive.
# ---------------------------------------------------------------------------
e2e_assert_sha256_matches() {
    local plaintext="${1:-}" digest="${2:-}" label="${3:-}"
    if [[ -z "$digest" ]]; then
        echo "FAIL ${label:+$label: }e2e_assert_sha256_matches: missing DIGEST argument" >&2
        return 1
    fi
    local actual
    actual=$(printf '%s' "$plaintext" | sha256sum | cut -d' ' -f1) || {
        echo "FAIL ${label:+$label: }could not compute sha256 of plaintext" >&2
        return 1
    }
    if [[ "${actual,,}" == "${digest,,}" ]]; then
        echo "PASS ${label:-e2e_assert_sha256_matches: sha256 of plaintext matches $digest}"
        return 0
    fi
    echo "FAIL ${label:+$label: }sha256 mismatch: expected '$digest', computed '$actual' for plaintext '$plaintext'" >&2
    return 1
}

# ---------------------------------------------------------------------------
# e2e_assert_repo_no_plaintext_iban ROOT [LABEL]
#   The big invariant: no plaintext demo IBAN may exist outside test-only
#   code in the tree under ROOT.
#
#   Demo fixture PII — IBAN 'GB29 NWBK 6016 1331 9268 19', 'Ada Bank' — is
#   fake-but-plausible and intentionally appears ONLY in test locations:
#     * contract/src/*.rs keep their fixtures INSIDE #[cfg(test)] mods;
#     * host/tests/, mock-rail/tests/ and any fixtures/ directory hold the
#       TypeScript fixture files.
#   Every other EXECUTABLE/authored file (.sh, .ts, ...) must never carry the
#   plaintext IBAN — that is the scored privacy invariant of the demo.
#   Markdown documentation is deliberately EXEMPT: README / plan / dossiers
#   quote the demo payload to illustrate the magic moment (the IBAN there is
#   visibly a fixture in a prose example, not code that runs).
#
#   Walk rules (mirror the fixture policy exactly):
#     * directories SKIPPED entirely: .git, node_modules, target, .hermes,
#       docs, and ANY directory named tests or fixtures (test fixtures are
#       exempt by design — includes this tests/ dir itself and host/mock-rail
#       test suites);
#     * files SKIPPED by name: *.log (rail.log / agent-output.log are runtime
#       evidence the demo deliberately writes live values into), *.wasm,
#       *.md (markdown illustration, see above), *.lock and
#       package-lock.json (generated/vendored artifacts, not authored source);
#     * every remaining FILE that contains the demo IBAN (fixed-string
#       grep -lF) is judged:
#         (a) *.rs  -> hits are legal only when a '#[cfg(test)]' line appears
#                      EARLIER in the file than the hit (last-seen marker line
#                      tracked per file with awk; a hit before any marker is a
#                      violation, printed as '<path>:<line>');
#         (b) any other type -> immediate violation.
#   Prints 'PASS' when clean; on violation prints one
#   'FAIL <path>:<line> plaintext IBAN in non-test code' per offending line to
#   stderr and returns 1.
# ---------------------------------------------------------------------------
e2e_assert_repo_no_plaintext_iban() {
    local root="${1:-}" label="${2:-}"
    local iban='GB29 NWBK 6016 1331 9268 19'
    local bad=0

    if [[ -z "$root" || ! -d "$root" ]]; then
        echo "FAIL ${label:+$label: }e2e_assert_repo_no_plaintext_iban: ROOT '$root' is not a directory" >&2
        return 1
    fi

    local f
    while IFS= read -r f; do
        [[ -n "$f" ]] || continue
        if [[ "$f" == *.rs ]]; then
            # .rs: every IBAN hit needs a #[cfg(test)] marker strictly earlier.
            # awk checks the hit against the last marker seen on PREVIOUS
            # lines only, so a marker on the same line cannot legalize a hit.
            local violations
            violations=$(awk -v needle="$iban" '
                index($0, needle) && lastmark == 0 { print FILENAME ":" NR; bad = 1 }
                index($0, "#[cfg(test)]") { lastmark = NR }
                END { exit bad ? 1 : 0 }
            ' "$f") || true
            if [[ -n "$violations" ]]; then
                while IFS= read -r line; do
                    echo "FAIL $line plaintext IBAN in non-test code" >&2
                done <<< "$violations"
                bad=1
            fi
        else
            # Non-.rs, non-exempt file: any hit is a violation.
            local hits
            hits=$(grep -nF -- "$iban" "$f") || true
            if [[ -n "$hits" ]]; then
                local lineno
                while IFS= read -r line; do
                    lineno=${line%%:*}
                    echo "FAIL $f:$lineno plaintext IBAN in non-test code" >&2
                done <<< "$hits"
                bad=1
            fi
        fi
    done < <(find "$root" \
        \( -name .git -o -name node_modules -o -name target -o -name .hermes \
           -o -name docs -o -name tests -o -name fixtures -o -name .env \) -prune -o \
        -type f ! -name '*.log' ! -name '*.wasm' ! -name '*.md' ! -name '*.lock' \
               ! -name 'package-lock.json' -print)

    if [[ $bad -eq 0 ]]; then
        echo "PASS ${label:-e2e_assert_repo_no_plaintext_iban: no plaintext demo IBAN outside exempt test code under '$root'}"
        return 0
    fi
    return 1
}
