/**
 * run-demo.ts — Phase 3 orchestration CLI.
 *
 *   npx tsx src/run-demo.ts [--customer cus_1] [--invoice inv_1]
 *     [--amount 199.00] [--currency GBP]
 *
 * Drives the AGENT session through the two MANDATE functions in order:
 *
 *   1. `onboard-customer` ({ customer_id })  → KYC verdict (kyc_id / status / risk_score?)
 *   2. `pay-invoice` ({ invoice_id, amount, currency? }) → pay verdict
 *      (payment_id / status / iban_sha256)
 *
 * then prints the "magic moment" pane (agent view = markers literal, rail =
 * resolved values) plus a compact audit pane, and appends every step to
 * host/agent-output.log.
 *
 * PRIVACY STORY: the agent's call payloads and this file's log entries carry
 * ids / amounts / {{profile.*}} MARKERS ONLY — never resolved bank data. The
 * contract's outbound body (mirrored here by PAY_BODY_TEMPLATE, see
 * contract/src/pay.rs build_pay_body) carries markers; the enclave substitutes
 * the calling user's real profile values at egress time. If this file ever
 * logs a resolved plaintext profile value, the privacy story is broken.
 *
 * Import side-effect-free (main is gated below) so vitest and the other
 * scripts can import the pure helpers safely.
 */
import { pathToFileURL } from "node:url";
import { connectAll } from "./connect.js";
import { loadContractRecord } from "./lib/records.js";
import { checkRailHealth } from "./lib/rail-client.js";
import { writeAgentLog } from "./lib/logger.js";

/** Scrubbed `onboard-customer` verdict (contract/src/kyc.rs). */
export interface KycVerdict {
  kyc_id: string;
  status: string;
  risk_score?: number;
}

/** Scrubbed `pay-invoice` verdict — iban_sha256 is the receipt proof, never the IBAN. */
export interface PayVerdict {
  payment_id: string;
  status: string;
  iban_sha256: string;
}

/**
 * The EXACT body the CONTRACT sends to the mock money rail (mirror of
 * contract/src/pay.rs `build_pay_body` — keep in sync with that function).
 *
 * Shown side-by-side in the demo's "magic moment": the agent's view is these
 * literal {{profile.*}} markers, while the rail's log (rail.log, Phase 4)
 * shows the values the enclave substituted at egress. BEAT 5 greps
 * host/agent-output.log: markers MUST appear, plaintext bank data MUST NOT.
 *
 * NEVER put real values in here — markers only, by construction.
 */
export const PAY_BODY_TEMPLATE: Record<string, unknown> = {
  beneficiary: {
    legal_name: "{{profile.legal_name}}",
    iban: "{{profile.iban}}",
    swift: "{{profile.swift_bic}}",
  },
  amount: "<amount>",
  currency: "<currency>",
  reference: "<reference>",
};

/** CLI options for one demo run. */
export interface DemoOptions {
  customerId: string;
  invoiceId: string;
  /** Decimal string ("199.00") — the contract rejects f64 amounts. */
  amount: string;
  /** Optional override; the contract defaults to "GBP". */
  currency?: string;
}

/** Value for a flag that requires one (--customer/--invoice/--amount/--currency). */
function flagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

/**
 * Parse CLI argv into DemoOptions. Defaults: cus_1 / inv_1 / 199.00 / no
 * currency (contract defaults GBP). Throws on unknown flags.
 */
export function parseArgs(argv: string[]): DemoOptions {
  const opts: DemoOptions = {
    customerId: "cus_1",
    invoiceId: "inv_1",
    amount: "199.00",
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--customer":
        opts.customerId = flagValue(argv, i, flag);
        i++;
        break;
      case "--invoice":
        opts.invoiceId = flagValue(argv, i, flag);
        i++;
        break;
      case "--amount":
        opts.amount = flagValue(argv, i, flag);
        i++;
        break;
      case "--currency":
        opts.currency = flagValue(argv, i, flag);
        i++;
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  return opts;
}

/**
 * The execute wire call. contract_id is the CANONICAL z: name and
 * contract_version a real SemVer (never "latest") — wire fields are
 * contract_id / contract_version / function_name, NOT contract/version/function.
 */
export interface ExecuteCall {
  contract_id: string;
  contract_version: string;
  function_name: string;
  input: Record<string, unknown>;
}

/** Structural execute client — any object with this method satisfies it (vitest mocks do). */
export type ExecuteClient = {
  executeAndDecode<T>(call: ExecuteCall): Promise<T>;
};

/** Build the `onboard-customer` execute call. PII-free: customer_id only. */
export function buildKycCall(
  record: { name: string; version: string },
  customerId: string
): unknown {
  return {
    contract_id: record.name,
    contract_version: record.version,
    function_name: "onboard-customer",
    input: { customer_id: customerId },
  };
}

/**
 * Build the `pay-invoice` execute call. The agent NEVER sees beneficiary bank
 * data — the input carries invoice_id + amount (+ currency only when the CLI
 * provided one) and NO other keys, ever. Bank details exist only as markers
 * in the contract's outbound body (PAY_BODY_TEMPLATE).
 */
export function buildPayCall(
  record: { name: string; version: string },
  opts: { invoiceId: string; amount: string; currency?: string }
): unknown {
  const input: Record<string, unknown> = {
    invoice_id: opts.invoiceId,
    amount: opts.amount,
  };
  if (opts.currency !== undefined) {
    input.currency = opts.currency;
  }
  return {
    contract_id: record.name,
    contract_version: record.version,
    function_name: "pay-invoice",
    input,
  };
}

/**
 * Run ONE demo step through the agent session: `onboard-customer`.
 * No try/catch — errors propagate (see runDemoSteps).
 */
export async function runKyc(
  agent: ExecuteClient,
  record: { name: string; version: string },
  customerId: string
): Promise<KycVerdict> {
  return agent.executeAndDecode<KycVerdict>(
    buildKycCall(record, customerId) as ExecuteCall
  );
}

/**
 * Run ONE demo step through the agent session: `pay-invoice`.
 * No try/catch — errors propagate (see runDemoSteps).
 */
export async function runPay(
  agent: ExecuteClient,
  record: { name: string; version: string },
  opts: { invoiceId: string; amount: string; currency?: string }
): Promise<PayVerdict> {
  return agent.executeAndDecode<PayVerdict>(
    buildPayCall(record, opts) as ExecuteCall
  );
}

/**
 * Run the two demo steps through the agent session, in order:
 * onboard-customer → pay-invoice.
 *
 * Deliberately has NO try/catch: egress denial
 * ("host/http.egress_denied: host ... is not in the authorised_hosts
 * allowlist"), InsufficientCreditError and upstream RPC errors all propagate
 * to the caller (main's catch prints and exits non-zero) so a failed step is
 * never mistaken for a settled payment.
 */
export async function runDemoSteps(
  agent: ExecuteClient,
  record: { name: string; version: string },
  opts: DemoOptions
): Promise<{ kyc: KycVerdict; pay: PayVerdict }> {
  const kyc = await runKyc(agent, record, opts.customerId);
  const pay = await runPay(agent, record, {
    invoiceId: opts.invoiceId,
    amount: opts.amount,
    currency: opts.currency,
  });
  return { kyc, pay };
}

/**
 * A client that (like the real T3nClient on SDK 5.5.0) also exposes
 * getAuditEvents(opts?: { pii_did?, limit?, cursor? }) → AuditPage.
 */
export type AuditClient = ExecuteClient & {
  getAuditEvents?: (opts?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Fetch the latest audit page via the REAL getAuditEvents signature
 * (GetAuditEventsOptions { pii_did?, limit?, cursor? } — see
 * @terminal3/t3n-sdk index.d.ts; AuditPage { batches, next_cursor }).
 * Never throws: an absent method or a failed read is reported as { ok: false }.
 */
export async function fetchAuditEvents(
  client: AuditClient,
  limit = 10
): Promise<{ ok: true; raw: unknown } | { ok: false; error: string }> {
  try {
    const getAuditEvents = client.getAuditEvents;
    if (typeof getAuditEvents !== "function") {
      // Docs claim it is typed on 5.5.0 — a structurally-typed client without
      // it (or an SDK build where it regressed) must fail loudly, not silently.
      return { ok: false, error: "getAuditEvents not exposed on SDK 5.5.0" };
    }
    const raw = await getAuditEvents({ limit });
    return { ok: true, raw };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Compact audit pane for the console: counts + distinct actions, NEVER the
 * full raw page (events can carry contract-supplied detail we don't own).
 */
function auditPane(
  audit: { ok: true; raw: unknown } | { ok: false; error: string }
): { ok: boolean; summary: Record<string, unknown> } {
  if (!audit.ok) {
    return { ok: false, summary: { error: audit.error } };
  }
  const page = audit.raw as { batches?: unknown };
  const batches = Array.isArray(page?.batches) ? page.batches : [];
  const eventLists = batches.flatMap((batch) => {
    if (
      batch !== null &&
      typeof batch === "object" &&
      Array.isArray((batch as { events?: unknown }).events)
    ) {
      return (batch as { events: unknown[] }).events;
    }
    return [];
  });
  const actions = Array.from(
    new Set(
      eventLists
        .map((e) =>
          e !== null && typeof e === "object" &&
          typeof (e as { action?: unknown }).action === "string"
            ? (e as { action: string }).action
            : ""
        )
        .filter((action) => action.length > 0)
    )
  );
  return {
    ok: true,
    summary: { batches: batches.length, events: eventLists.length, actions },
  };
}

export type DemoMode = "all" | "kyc" | "pay";

/**
 * Orchestration entry point (run via `npx tsx src/run-demo.ts [mode] [flags]`).
 * mode: `kyc` (onboard-customer only) · `pay` (pay-invoice only + magic-moment
 * pane + audit) · `all` (default, both steps) — the Phase 5 demo script drives
 * kyc-only (Beat 1) and pay-only (Beat 4, post-revoke denial) modes.
 * Requires host/.env (T3N_API_KEY/AGENT_KEY/USER_KEY), a prior
 * `npm run register` (.contract-record.json) and, for egress to succeed,
 * the Phase 4 mock rail on localhost:8787 — the rail preflight warns but
 * does not abort, so contract-level errors surface with their real messages.
 */
export async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    const mode: DemoMode =
      args[0] === "kyc" || args[0] === "pay" ? args[0] : "all";
    const flagArgs = mode === "all" ? args : args.slice(1);
    const opts = parseArgs(flagArgs);

    const { agent } = await connectAll();

    const record = loadContractRecord();
    if (!record) {
      console.error(
        "no .contract-record.json — run `npm run register` first"
      );
      process.exit(1);
    }

    // Rail preflight: warn-and-continue (egress denial inside the enclave is
    // the honest signal when the Phase 4 rail is down).
    const health = await checkRailHealth();
    console.log(
      `rail preflight: ${health.ok ? "ok" : "unreachable"} — ${health.url}` +
        (health.status !== undefined ? ` (HTTP ${health.status})` : "") +
        (health.error ? ` — ${health.error}` : "")
    );
    if (!health.ok) {
      console.warn(
        "rail not healthy — egress to localhost:8787 will fail upstream; start the Phase 4 mock rail first"
      );
    }

    // Step 1 (kyc | all) — onboard-customer.
    if (mode === "kyc" || mode === "all") {
      const kyc = await runKyc(agent.client, record, opts.customerId);
      console.log("KYC verdict:", JSON.stringify(kyc));
      writeAgentLog({
        step: "kyc",
        input: { customer_id: opts.customerId },
        verdict: kyc,
      });
    }

    // Step 2 (pay | all) — pay-invoice, then the "magic moment" pane + audit.
    if (mode === "pay" || mode === "all") {
      const pay = await runPay(agent.client, record, {
        invoiceId: opts.invoiceId,
        amount: opts.amount,
        currency: opts.currency,
      });
      console.log("Pay verdict:", JSON.stringify(pay));
      console.log("AGENT view (markers, never plaintext):");
      console.log(JSON.stringify(PAY_BODY_TEMPLATE));
      console.log("RAIL received the resolved values — see rail.log");
      console.log("iban_sha256 (proof): " + pay.iban_sha256);
      writeAgentLog({
        step: "pay",
        input: { invoice_id: opts.invoiceId, amount: opts.amount },
        verdict: pay,
      });
      writeAgentLog({ step: "agent-view", template: PAY_BODY_TEMPLATE });

      // Audit pane — compact {ok, summary} only; never dump the full raw page.
      const audit = await fetchAuditEvents(agent.client, 10);
      console.log("Audit pane:", JSON.stringify(auditPane(audit)));
    }

    console.log("logs at host/agent-output.log (+ rail.log Phase 4)");
  } catch (err) {
    console.error("run-demo failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

// Run only when executed directly (npx tsx src/run-demo.ts) — never on import,
// so vitest and the other scripts can import these helpers safely.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error("run-demo failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
