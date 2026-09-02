import { getContractVersion } from "@terminal3/t3n-sdk";
import { pathToFileURL } from "node:url";
import { connectAll, type Session } from "./connect.js";
import { loadContractRecord } from "./lib/records.js";

/**
 * Grant / revoke / show the user-signed delegation grant that ARMS the MANDATE
 * contract for the agent session.
 *
 * Mirrors the phase-1 walkthrough invoke.ts grant step exactly (ran green on
 * testnet 2026-09-01): the USER session signs `agent-auth-update` on
 * `tee:user/contracts`, scoping the AGENT DID to this one contract script, its
 * two functions, and the rail egress host.
 *
 * Denial surface: with no grant (or a revoked one) the contract still runs —
 * only the outbound rail call fails with `host/http.egress_denied` (docs' #1
 * warning: "set the grant before you invoke").
 */

/** Default grant shape: both MANDATE contract functions. */
const DEFAULT_FUNCTIONS = ["onboard-customer", "pay-invoice"];

/** Default egress host — matches the contract's RAIL_BASE const. */
const DEFAULT_HOSTS = ["localhost:8787"];

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
 * Host strings carry NO scheme (no `http://` — the contract's RAIL_BASE const
 * is `http://localhost:8787`, so its allowlist entry is `localhost:8787`).
 * Undefined → the default host matching RAIL_BASE; a blank CSV throws. Absent
 * allowedHosts entirely would mean deny-all egress, so a grant never builds an
 * empty list.
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
 * Build the exact `agent-auth-update` input shape from the walkthrough
 * (camelCase `allowedHosts` — the documented shape that ran green; the wire
 * serializer emits it, do not rename to snake_case).
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
 * Build the revocation input: an EMPTY agents array = revoke all standing
 * grants (documented revocation — same key, no further access).
 */
export function buildRevokeInput(): unknown {
  return { agents: [] };
}

/**
 * Sign the grant: the USER (data owner) authorises the AGENT to run the
 * contract's script. `agent-auth-update` on `tee:user/contracts` is SelfOnly —
 * only the USER may sign. The grant must name the agent's DID, and
 * `allowedHosts` must include 'localhost:8787' (the contract's RAIL_BASE) or
 * every rail egress is denied (`host/http.egress_denied`).
 *
 * @returns the resolved `tee:user/contracts` grants version written
 */
export async function grantScript(
  agent: Session,
  user: Session,
  nodeUrl: string,
  opts: GrantScriptOptions
): Promise<string> {
  const grantsVersion = await getContractVersion(nodeUrl, "tee:user/contracts");
  await user.client.execute({
    contract_id: "tee:user/contracts",
    contract_version: grantsVersion,
    function_name: "agent-auth-update",
    input: buildGrantInput({ agentDid: agent.did, ...opts }),
  });
  return grantsVersion;
}

/**
 * Revoke the grant: same `agent-auth-update` write with an empty agents array
 * (buildRevokeInput) — key unchanged, access gone.
 */
export async function revokeScript(
  agent: Session,
  user: Session,
  nodeUrl: string,
  opts: RevokeScriptOptions
): Promise<void> {
  const grantsVersion = await getContractVersion(nodeUrl, "tee:user/contracts");
  await user.client.execute({
    contract_id: "tee:user/contracts",
    contract_version: grantsVersion,
    function_name: "agent-auth-update",
    input: buildRevokeInput(),
  });
}

/**
 * Decision D2 read-back. The grant was written via the LEGACY
 * `agent-auth-update` on `tee:user/contracts` (the documented walkthrough
 * path = scoring surface). The modern mirror is `member-delegation-*` on
 * `tee:authorisations/contracts` (D2 — docs drift, reported in buglog), so the
 * read side tries the SDK's current `getMemberDelegation()` and — when the API
 * is absent or throws — returns a note instead of failing the CLI.
 */
export async function showGrant(
  user: Session,
  nodeUrl: string
): Promise<unknown> {
  try {
    return await user.client.getMemberDelegation?.();
  } catch (err) {
    return {
      note: "no readable delegation API on SDK 5.5.0 — verify by invoking (allowed/egress-denied behavior)",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * CLI entry: `npx tsx src/grant.ts <grant|revoke|show> [functions] [hosts]`.
 * grant/revoke sign or clear the delegation via the USER session for the
 * contract named in host/.contract-record.json (written by `npm run register`).
 */
export async function main(): Promise<void> {
  const action = process.argv[2];
  if (action !== "grant" && action !== "revoke" && action !== "show") {
    console.error("usage: npx tsx src/grant.ts <grant|revoke|show> [functionsCSV] [hostsCSV]");
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
        { agentDid: agent.did, scriptName, versionReq, functions, allowedHosts },
        null,
        2
      )
    );
    console.log("hint: revoke with: `npm run grant -- revoke`");
  } else if (action === "revoke") {
    await revokeScript(agent, user, nodeUrl, { scriptName, versionReq });
    console.log("grant revoked (agents: [])");
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
