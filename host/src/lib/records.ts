import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Contract registration record — the single source of truth for the canonical
 * z:<tid>:mandate-contracts name + numeric contract_id between `register.ts`
 * (writes) and `grant.ts` / `run-demo.ts` (read).
 *
 * WHY a file: re-registering the same tail with a greater version allocates a
 * NEW numeric contract_id and there is NO API to fetch the tail's current id
 * (docs admit the gap) — and the secrets-map ACLs are keyed by contract_id,
 * so every script must agree on the LATEST record. `register.ts` overwrites
 * this file on each successful registration.
 */
export interface ContractRecord {
  /** Numeric id the node assigned at registration (used in map ACLs). */
  contract_id: number;
  /** Canonical z:<tid>:<tail> name — used as contract_id in execute calls. */
  name: string;
  /** Registration tail (e.g. "mandate-contracts"). */
  tail: string;
  /** SemVer registered (matches the contract's CONTRACT_VERSION). */
  version: string;
  /** Full did:t3n:... of the registering tenant session. */
  tenant_did: string;
  /** ISO timestamp of this registration. */
  registered_at: string;
}

/** host/.contract-record.json (gitignored). */
const RECORD_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../.contract-record.json"
);

export function contractRecordPath(): string {
  return RECORD_PATH;
}

export function saveContractRecord(record: ContractRecord): void {
  writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2) + "\n", "utf8");
}

/** Returns the record, or null when missing/unparseable/not-yet-registered. */
export function loadContractRecord(): ContractRecord | null {
  if (!existsSync(RECORD_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as Partial<ContractRecord>;
    if (
      typeof raw.contract_id !== "number" ||
      typeof raw.name !== "string" ||
      typeof raw.tail !== "string" ||
      typeof raw.version !== "string"
    ) {
      return null;
    }
    return raw as ContractRecord;
  } catch {
    return null;
  }
}
