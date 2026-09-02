import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AGENT-side output ledger: every entry the agent observed during a demo run
 * (its OWN view of the world — markers literal, never resolved plaintext).
 *
 * BEAT 5 of the demo asserts: `grep "GB29" agent-output.log` finds NOTHING,
 * while `grep "{{profile.iban}}"` DOES. If this file ever contains a resolved
 * profile value, the privacy story is broken — keep it that way.
 */
const LOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../agent-output.log"
);

export function agentLogPath(): string {
  return LOG_PATH;
}

/**
 * Append one JSON line to host/agent-output.log (created on first write).
 * `entry` is logged as-is; callers are responsible for never passing resolved
 * PII — log the marker-bearing structures and operational ids only.
 */
export function writeAgentLog(entry: unknown): void {
  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
}
