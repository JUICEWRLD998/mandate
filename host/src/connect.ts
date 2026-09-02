import {
  T3nClient,
  TenantClient,
  setEnvironment,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  getNodeUrl,
} from "@terminal3/t3n-sdk";
import { pathToFileURL } from "node:url";
import { loadEnv } from "./lib/env.js";

/**
 * Session plumbing for MANDATE's three identities (mirrors the phase-1
 * walkthrough invoke.ts, which ran green on testnet 2026-09-01):
 *
 *   tenant — T3N_API_KEY, owns the contract + secrets map (control plane)
 *   agent  — AGENT_KEY, its own claim-page key + credits; executes the contract
 *   user   — USER_KEY, the data owner who SIGNS the delegation grant
 *
 * Every session is fully independent: own wasm component, own handshake, own
 * authenticated DID. DIDs are NEVER hardcoded or derived — they come only from
 * each session's authenticate() result (claim-page keys collapse to one DID
 * per account — BUG-003 — so each key must come from a fresh claim).
 *
 * BUG-002 note: SDK 5.5.0's fetchTrustedManifest("testnet") always throws
 * ("malformed" — it requires rtmr1_allowlist while testnet serves only
 * rtmr3_allowlist), so all sessions use the documented dev escape hatch
 * trustAnchor: { unsafe_trust_server: true }.
 */
export interface Session {
  client: T3nClient;
  /** Full did:t3n:... from authenticate(). */
  did: string;
}

/** One independent authenticated session for `apiKey`. */
export async function createSession(apiKey: string): Promise<Session> {
  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(apiKey);
  const client = new T3nClient({
    trustAnchor: { unsafe_trust_server: true },
    wasmComponent,
    handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
  });
  await client.handshake();
  const did = await client.authenticate(createEthAuthInput(address));
  return { client, did: did.value };
}

export interface TenantContext {
  tenant: Session;
  agent: Session;
  user: Session;
  nodeUrl: string;
}

/**
 * Load host/.env, pin the testnet environment (ALWAYS explicit — the docs
 * contradict themselves on the default) and open the three sessions.
 */
export async function connectAll(): Promise<TenantContext> {
  loadEnv();
  setEnvironment("testnet");
  const tenant = await createSession(requireEnv("T3N_API_KEY"));
  const agent = await createSession(requireEnv("AGENT_KEY"));
  const user = await createSession(requireEnv("USER_KEY"));
  return { tenant, agent, user, nodeUrl: getNodeUrl() };
}

/** TenantClient wrapper — TenantClient REQUIRES baseUrl: getNodeUrl(). */
export async function createTenantClient(
  session: Session
): Promise<TenantClient> {
  const tenant = new TenantClient({
    t3n: session.client,
    baseUrl: getNodeUrl(),
    tenantDid: session.did,
  });
  await tenant.tenant.me(); // throws if anything is wrong
  return tenant;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — copy host/.env.example to host/.env and fill it in`
    );
  }
  return value;
}

// Run only when executed directly (npx tsx src/connect.ts) — never on import,
// so vitest and the other scripts can import these helpers safely.
async function main(): Promise<void> {
  const { tenant, agent, user } = await connectAll();
  console.log("TenantClient session:", tenant.did);
  console.log("Agent session:", agent.did);
  console.log("User session:", user.did);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error("connect failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
