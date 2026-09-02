import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * rail.log — the MOCK COUNTERPARTY's view of every request it receives.
 *
 * DELIBERATE INVERSION OF THE HOST LOGGING RULES: this file logs the EXACT
 * payload the rail received, INCLUDING the resolved plaintext values the
 * enclave substituted for {{profile.*}} markers. That is the whole point —
 * the demo's "magic moment" is the side-by-side:
 *
 *   mock-rail/rail.log      → real values  (GB29 NWBK 6016 1331 9268 19 …)
 *   host/agent-output.log   → markers only ({{profile.iban}} …)
 *
 * The same request, two views: the secret moved without touching the mover.
 * rail.log is gitignored (repo *.log rule) and local-only.
 *
 * The rail is the legitimate counterparty — it is SUPPOSED to hold the data.
 * What it must NOT do is echo it back in responses (see app.ts: scrubbed
 * response bodies, no PII reflection).
 */

/** One received-request record, as the rail saw it. */
export interface RailLogEntry {
  ts: string;
  endpoint: string;
  /** The full request body exactly as received (resolved values included). */
  payload: unknown;
  /** Raw Authorization header value when present (Bearer <rail_api_key> from KV). */
  authorization?: string;
}

export interface RailLogger {
  logReceived(entry: RailLogEntry): void;
}

/** mock-rail/rail.log (relative to this file: src/rail-log.ts → ../rail.log). */
export function defaultRailLogPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../rail.log");
}

/** Short human line for the console (endpoint + any id-ish fields). */
function summarize(entry: RailLogEntry): string {
  const p = entry.payload as Record<string, unknown> | null;
  if (entry.endpoint === "/kyc" && p && typeof p.customer_id === "string") {
    return `POST /kyc customer=${p.customer_id}`;
  }
  if (entry.endpoint === "/pay" && p && typeof p.reference === "string") {
    return `POST /pay reference=${p.reference}`;
  }
  return `POST ${entry.endpoint}`;
}

/**
 * Default logger: one JSON line appended to mock-rail/rail.log (created on
 * first write) plus a short console line. Pass a custom `logPath` in tests.
 */
export function createRailLogger(
  logPath: string = defaultRailLogPath()
): RailLogger {
  return {
    logReceived(entry: RailLogEntry): void {
      appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
      console.log(summarize(entry));
    },
  };
}

/** A no-op logger for tests that only assert on responses. */
export function silentRailLogger(): RailLogger {
  return { logReceived: () => undefined };
}

/** True when `logPath` already exists (tests may assert log growth). */
export function railLogExists(logPath: string = defaultRailLogPath()): boolean {
  return existsSync(logPath);
}
