import { getContractVersion } from "@terminal3/t3n-sdk";
import type { BoundGrant } from "@terminal3/t3n-sdk";
import { pathToFileURL } from "node:url";
import { connectAll, type Session } from "./connect.js";
import { loadContractRecord } from "./lib/records.js";

/**
 * Grant / revoke / show the user-signed delegation grant that ARMS the MANDATE
 * contract for the agent session.
 *
 * DECISION D2 — RESOLVED LIVE 2026-09-02 (testnet): the documented legacy write
 * (`agent-auth-update` on `tee:user/contracts`, free) succeeds but NO LONGER
 * arms egress — invoking a granted contract still fails with
 * `egress denied for host <host>`. Egress is enforced from the MODERN
 * `member-delegation` document on `tee:authorisations/contracts` (SelfOnly,
 * METERED — ~1e10 per op), written via the SDK's read-merge-write
 * `updateMemberDelegation(BoundGrant)` and revoked with a full-doc
 * `member-delegation-update`. This contradicts the docs' walkthrough (docs
 * drift — buglog candidate). Strategy: write BOTH surfaces — legacy first for
 * docs parity (best-effort, its failure is a warning), modern as the
 * functional grant (its failure aborts). Host entries are matched WITHOUT
 * port (live error names `host localhost` for `http://localhost:8787`), so
 * the default host is `localhost`, not `localhost:8787`.
 *
 * Denial surface: with no (modern) grant the contract still runs — only the
 * outbound rail call fails with `host/http.egress_denied` (docs' #1 warning:
 * "set the grant before you invoke").
 */

/** Default grant shape: both MANDATE contract functions. */
const DEFAULT_FUNCTIONS = ["onboard-customer", "pay-invoice"];

/** Default egress host — host WITHOUT port (live-verified match semantics). */
const DEFAULT_HOSTS = ["localhost"];

/** Legacy (docs-surface) grants contract. */
const LEGACY_GRANTS_CONTRACT = "tee:user/contracts";
/** Modern (functional, metered) delegation contract. */
const MODERN_GRANTS_CONTRACT = "tee:authorisations/contracts";

/**
 * Parse the optional functions CSV into the grant's function allowlist.
 *
 * The three-way scope of a grant is contract × functions × hosts: this list is
 * the middle dimension — which of the MANDATE contract's WIT functions the
 * agent may invoke. Undefined → both functions; a blank CSV throws.
 */
export function parseFunctionsArg(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_FUNCTIONS];
  const functions = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (functions.length === 0) {
    throw new Error(
      `functions must name at least one function (got '${raw}')`
    );
  }
  return functions;
}

/**
 * Parse the optional hosts CSV into the grant's egress allowlist.
 *
 * Host strings carry NO scheme and NO port — the enclave matches the host
 * portion of the outbound URL (`http://localhost:8787` → host `localhost`;
 * verified live from the `egress denied for host localhost` error). Undefined
 * → `localhost` (matches the contract's RAIL_BASE); a blank CSV throws.
 */
export function parseHostsArg(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_HOSTS];
  const hosts = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (hosts.length === 0) {
    throw new Error(`hosts must name at least one host (got '${raw}')`);
  }
  return hosts;
}

export interface GrantInputOptions {
  agentDid: string;
  scriptName: string;
  versionReq: string;
  functions: string[];
  allowedHosts: string[];
}

/** grantScript options — the grant minus the agent DID. */
export type GrantScriptOptions = Omit<GrantInputOptions, "agentDid">;

/** revokeScript options — the record's identity; revoke needs no function/host lists. */
export interface RevokeScriptOptions {
  scriptName: string;
  versionReq: string;
}

/**
 * Build the exact legacy `agent-auth-update` input shape from the walkthrough
 * (camelCase `allowedHosts` — the DOCUMENTED shape; kept for docs parity, see
 * module doc: it no longer arms egress on testnet).
 */
export function buildGrantInput(opts: GrantInputOptions): unknown {
  return {
    agents: [
      {
        agentDid: opts.agentDid,
        scripts: [
          {
            scriptName: opts.scriptName,
            versionReq: opts.versionReq,
            functions: opts.functions,
            allowedHosts: opts.allowedHosts,
          },
        ],
      },
    ],
  };
}

/**
 * Build the legacy revocation input: an EMPTY agents array = revoke all
 * standing grants on the legacy surface (documented shape; kept for parity).
 */
export function buildRevokeInput(): unknown {
  return { agents: [] };
}

/**
 * Build the MODERN `BoundGrant` (snake_case, wire-verbatim — the SDK performs
 * NO casing transform): grantee = the agent DID, contract_id = the canonical
 * z: name, functions + egress allowed_hosts + version_req as given.
 * `scopes` is empty: MANDATE's functions grant no org-data scope paths —
 * they act on profile markers / KV / egress only. (If the live write rejects
 * empty scopes, the fallback is `["*"]` — tracked in the D2 note.)
 */
export function buildBoundGrant(opts: GrantInputOptions): BoundGrant {
  return {
    grantee: opts.agentDid,
    contract_id: opts.scriptName,
    functions: opts.functions,
    scopes: [],
    version_req: opts.versionReq,
    allowed_hosts: opts.allowedHosts,
  };
}

/**
 * Sign the grant on BOTH surfaces. Only the USER (data owner) may sign —
 * every delegation write is SelfOnly on the caller's own document.
 *   1. legacy `agent-auth-update` on tee:user/contracts (free; docs surface;
 *      failure here is a WARNING — it no longer gates egress);
 *   2. modern `updateMemberDelegation(BoundGrant)` on
 *      tee:authorisations/contracts (METERED; the functional grant — its
 *      failure aborts).
 * `allowedHosts` must include the contract's egress host (`localhost`) or
 * every rail call is denied.
 */
export async function grantScript(
  agent: Session,
  user: Session,
  nodeUrl: string,
  opts: GrantScriptOptions
): Promise<void> {
  // Legacy — best effort, docs parity only.
  try {
    const legacyVersion = await getContractVersion(
      nodeUrl,
      LEGACY_GRANTS_CONTRACT
    );
    await user.client.execute({
      contract_id: LEGACY_GRANTS_CONTRACT,
      contract_version: legacyVersion,
      function_name: "agent-auth-update",
      input: buildGrantInput({ agentDid: agent.did, ...opts }),
    });
  } catch (err) {
    console.warn(
      "legacy agent-auth-update write failed (non-fatal — it no longer arms egress):",
      err instanceof Error ? err.message : err
    );
  }

  // Modern — the functional grant (D2).
  await user.client.updateMemberDelegation(
    buildBoundGrant({
      agentDid: agent.did,
      ...opts,
    })
  );
}

/**
 * Revoke on BOTH surfaces. Legacy: empty agents array. Modern: a full-doc
 * `member-delegation-update` write with an EMPTY grants list on
 * tee:authorisations/contracts — the document IS the state, so empty grants
 * revoke every delegated grant (demo semantics: key unchanged, access gone).
 */
export async function revokeScript(
  agent: Session,
  user: Session,
  nodeUrl: string,
  opts: RevokeScriptOptions
): Promise<void> {
  // Legacy — best effort, docs parity only.
  try {
    const legacyVersion = await getContractVersion(
      nodeUrl,
      LEGACY_GRANTS_CONTRACT
    );
    await user.client.execute({
      contract_id: LEGACY_GRANTS_CONTRACT,
      contract_version: legacyVersion,
      function_name: "agent-auth-update",
      input: buildRevokeInput(),
    });
  } catch (err) {
    console.warn(
      "legacy agent-auth-update revoke failed (non-fatal):",
      err instanceof Error ? err.message : err
    );
  }

  // Modern — full-doc empty write (1 metered op).
  const modernVersion = await getContractVersion(nodeUrl, MODERN_GRANTS_CONTRACT);
  await user.client.execute({
    contract_id: MODERN_GRANTS_CONTRACT,
    contract_version: modernVersion,
    function_name: "member-delegation-update",
    input: { grants: [], discover_dids: [] },
  });
}

/**
 * Read the caller's own (modern) delegation document via the SDK's typed
 * `getMemberDelegation()` (SelfOnly, METERED). When the read is unavailable
 * (no credits / API absent) return a note instead of failing the CLI.
 */
export async function showGrant(
  user: Session,
  nodeUrl: string
): Promise<unknown> {
  try {
    return await user.client.getMemberDelegation();
  } catch (err) {
    return {
      note: "member-delegation read unavailable (credits or API) — verify by invoking (allowed/egress-denied behavior)",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * CLI entry: `npx tsx src/grant.ts <grant|revoke|show> [functionsCSV] [hostsCSV]`.
 * grant/revoke sign or clear the delegation via the USER session for the
 * contract named in host/.contract-record.json (written by `npm run register`).
 */
export async function main(): Promise<void> {
  const action = process.argv[2];
  if (action !== "grant" && action !== "revoke" && action !== "show") {
    console.error(
      "usage: npx tsx src/grant.ts <grant|revoke|show> [functionsCSV] [hostsCSV]"
    );
    process.exit(1);
  }

  const { agent, user, nodeUrl } = await connectAll();
  const record = loadContractRecord();
  if (!record) {
    console.error("no .contract-record.json — run `npm run register` first");
    process.exit(1);
  }
  const scriptName = record.name;
  const versionReq = record.version;

  if (action === "grant") {
    const functions = parseFunctionsArg(process.argv[3]);
    const allowedHosts = parseHostsArg(process.argv[4]);
    await grantScript(agent, user, nodeUrl, {
      scriptName,
      versionReq,
      functions,
      allowedHosts,
    });
    console.log(
      JSON.stringify(
        {
          agentDid: agent.did,
          scriptName,
          versionReq,
          functions,
          allowedHosts,
          surfaces: ["legacy agent-auth-update (docs parity)", "modern member-delegation (functional)"],
        },
        null,
        2
      )
    );
    console.log("hint: revoke with: `npm run grant -- revoke`");
  } else if (action === "revoke") {
    await revokeScript(agent, user, nodeUrl, { scriptName, versionReq });
    console.log("grant revoked (legacy agents: [] + modern member-delegation: empty doc)");
    console.log("hint: re-arm with: `npm run grant -- grant`");
  } else {
    console.log(JSON.stringify(await showGrant(user, nodeUrl), null, 2));
  }
}

// Run only when executed directly (npx tsx src/grant.ts) — never on import,
// so vitest and the other scripts can import these helpers safely.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error("grant failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
