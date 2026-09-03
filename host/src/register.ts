import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TenantClient } from "@terminal3/t3n-sdk";
import { connectAll, createTenantClient, requireEnv } from "./connect.js";
import { saveContractRecord } from "./lib/records.js";

/**
 * Contract version registered on the node. Bump in lockstep with
 * contract/src/lib.rs CONTRACT_VERSION and wit/world.wit
 * (package z:mandate@0.3.0) — the node keys registrations by tail + version.
 */
export const CONTRACT_VERSION = "0.3.0";

/**
 * Local mirror of the SDK's `ContractRegisterResult` (field names verified
 * against node_modules/@terminal3/t3n-sdk/dist/index.d.ts: name + contract_id).
 */
interface ContractRegisterResult {
  /** Canonical `z:<tid>:<tail>` name the node assigned at registration. */
  name: string;
  /** Stable monotonic numeric contract id used in the secrets-map ACLs. */
  contract_id: number;
}

/**
 * Absolute path of the phase-2 component build to register:
 * host/src → up two → contract/target/wasm32-wasip2/release/z_mandate.wasm
 * (i.e. <repo>/contract/target/wasm32-wasip2/release/z_mandate.wasm).
 * `WASM_PATH` overrides (lets CI/scratch point at a fresh build). Pure — no
 * fs access; separators are normalised to '/' so the path is portable.
 */
export function resolveWasmPath(): string {
  const override = process.env.WASM_PATH;
  if (override) return override;
  const here = dirname(fileURLToPath(import.meta.url));
  const wasmPath = join(
    here,
    "../../contract/target/wasm32-wasip2/release/z_mandate.wasm"
  );
  return wasmPath.replace(/\\/g, "/");
}

/**
 * Read a wasm component into a Uint8Array, refusing files that are not real
 * wasm: every wasm binary starts with the `\0asm` magic bytes
 * (0x00 0x61 0x73 0x6d). Catches pointing the register step at a wrong file
 * (e.g. a stale/incomplete build or a non-wasm path).
 */
export function readContractWasm(path: string): Uint8Array {
  const bytes = new Uint8Array(readFileSync(path));
  const hasMagic =
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d;
  if (!hasMagic) {
    throw new Error("not a wasm component (missing magic bytes): " + path);
  }
  return bytes;
}

/**
 * Register the z-mandate component under `tail` at `version`. Thin wrapper
 * over tenant.contracts.register that normalises the wire result into a plain
 * { contract_id: number; name: string } for the contract record + ACLs.
 */
export async function registerContract(
  tenant: TenantClient,
  opts: { tail: string; version: string; wasm: Uint8Array }
): Promise<ContractRegisterResult> {
  const result = await tenant.contracts.register({
    tail: opts.tail,
    version: opts.version,
    wasm: opts.wasm,
  });
  return { contract_id: Number(result.contract_id), name: String(result.name) };
}

/**
 * Create the contract-only `secrets` map (readers/writers = { only: [id] }),
 * or detect that a previous run already created it.
 *
 * readers/writers MUST be explicit — the KV governor defaults to DENY, so an
 * omitted reader set creates a map nobody — not even the tenant — can read,
 * with no error.
 *
 * Re-registration caveat (handled, not just warned): an EXISTING secrets map
 * keeps its ACLs pointing at the OLD contract_id — re-registering allocates a
 * NEW id and there is no API to fetch the tail's current id (known platform
 * gap). ensureSecretsMap therefore re-points the map's readers/writers at the
 * new contract_id via tenant.maps.update ('updated'); if even the re-point
 * fails it reports 'stale' and the caller warns that the contract's KV read
 * will fail.
 */
export async function ensureSecretsMap(
  tenant: TenantClient,
  contractId: number
): Promise<"created" | "updated" | "stale"> {
  try {
    await tenant.maps.create({
      tail: "secrets",
      visibility: "private",
      writers: { only: [contractId] },
      readers: { only: [contractId] },
    });
    return "created";
  } catch (err) {
    // The node's map-create is idempotent on an existing tail: it replies
    // "map already exists" instead of throwing a second create.
    if (!(err instanceof Error) || !/map already exists/i.test(err.message)) {
      throw err;
    }
    // Re-registration path: the EXISTING map's readers/writers still point at
    // the PREVIOUS contract_id (the node allocates a new id per registration
    // with no API to fetch the current one). Re-point the ACL at the new id
    // via tenant.maps.update so the freshly registered contract can read the
    // secrets map; if that fails, report 'stale' and let the caller warn.
    try {
      await tenant.maps.update("secrets", {
        writers: { only: [contractId] },
        readers: { only: [contractId] },
      });
      return "updated";
    } catch (updateErr) {
      return "stale";
    }
  }
}

/**
 * Seed one key into the canonical z:<tid>:secrets map via the tenant control
 * plane (map-entry-set). The control plane bypasses ACLs — the only path to
 * the values afterwards is the contract code itself, because the map's
 * readers are contract-only.
 */
export async function seedSecret(
  tenant: TenantClient,
  key: string,
  value: string
): Promise<void> {
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("secrets"),
    key,
    value,
  });
}

/** Seed `rail_api_key` — the Authorization bearer the contract sends on egress. */
export async function seedRailApiKey(
  tenant: TenantClient,
  apiKeyValue: string
): Promise<void> {
  await seedSecret(tenant, "rail_api_key", apiKeyValue);
}

/**
 * Seed `rail_url` — the contract's egress target, resolved at call time via
 * `crate::rail_base()`. MUST be a PUBLIC URL reachable from the T3N node's
 * enclave (loopback is never reachable from the enclave — live-verified
 * 2026-09-03); local dev that omits it falls back to the contract's
 * `RAIL_BASE` localhost constant.
 */
export async function seedRailUrl(
  tenant: TenantClient,
  railUrl: string
): Promise<void> {
  await seedSecret(tenant, "rail_url", railUrl);
}

/**
 * Seed `rail_beneficiary` — the sealed JSON payment config
 * ({legal_name, iban, swift}) the contract reads inside the enclave for the
 * /pay egress (Decision D1: the profile schema cannot carry bank fields —
 * live-verified 2026-09-03; the docs' payroll model stores payment info once
 * in T3N). The TS host only ever holds the env value at seed time; the value
 * lives in the contract-only secrets map afterwards.
 */
export async function seedRailBeneficiary(
  tenant: TenantClient,
  json: string
): Promise<void> {
  // Validate JSON before seeding — a malformed value would fail every pay.
  JSON.parse(json);
  await seedSecret(tenant, "rail_beneficiary", json);
}

/**
 * One-shot tenant-side registration (CLI: `npx tsx src/register.ts`):
 * connect the tenant session → register the wasm component under the
 * CONTRACT_TAIL → ensure the contract-only secrets map → seed rail_api_key
 * through the control plane → persist the canonical contract record to
 * host/.contract-record.json for grant.ts / run-demo.ts.
 */
async function main(): Promise<void> {
  const { tenant: tenantSession } = await connectAll();
  const tenant = await createTenantClient(tenantSession);

  const tail = process.env.CONTRACT_TAIL ?? "mandate-contracts";
  const wasmPath = resolveWasmPath();
  const wasm = readContractWasm(wasmPath);

  const { contract_id, name } = await registerContract(tenant, {
    tail,
    version: CONTRACT_VERSION,
    wasm,
  });

  const mapState = await ensureSecretsMap(tenant, contract_id);
  if (mapState === "updated") {
    console.log(
      `secrets map already existed — readers/writers re-pointed to contract_id ${contract_id}`
    );
  } else if (mapState === "stale") {
    console.warn(
      "secrets map already exists AND its ACL could not be re-pointed (readers/writers still name the previous contract_id) — the contract will fail its KV read; delete/recreate the map or use a clean tenant"
    );
  }

  await seedRailApiKey(
    tenant,
    process.env.RAIL_API_KEY ?? requireEnv("RAIL_API_KEY")
  );
  await seedRailUrl(
    tenant,
    process.env.RAIL_URL ?? "http://localhost:8787"
  );
  await seedRailBeneficiary(tenant, requireEnv("RAIL_BENEFICIARY"));

  saveContractRecord({
    contract_id,
    name,
    tail,
    version: CONTRACT_VERSION,
    tenant_did: tenantSession.did,
    registered_at: new Date().toISOString(),
  });

  console.log(
    `contract registered: id=${contract_id} name=${name} (tail=${tail} v${CONTRACT_VERSION})`
  );
  console.log(`secrets map: ${mapState} (contract-only readers/writers)`);
  console.log("rail_api_key + rail_url + rail_beneficiary seeded via control plane");
  console.log("record saved to host/.contract-record.json");
  console.log("next: npm run grant");
}

// Run only when executed directly (npx tsx src/register.ts) — never on import,
// so vitest and the other scripts can import these helpers without triggering
// a live tenant connection (same gating as connect.ts).
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err: unknown) => {
    console.error("register failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
