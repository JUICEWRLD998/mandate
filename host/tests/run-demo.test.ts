/**
 * run-demo.test.ts — pure unit tests for the demo orchestration CLI.
 *
 * NO network, NO live keys, NO connect.ts import: everything under test is
 * exercised through structural mocks (the ExecuteClient shape). Importing
 * ../src/run-demo.js is side-effect-free — its main() is gated (test 8).
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildKycCall,
  buildPayCall,
  fetchAuditEvents,
  parseArgs,
  PAY_BODY_TEMPLATE,
  runDemoSteps,
} from "../src/run-demo.js";
import type { ExecuteClient, KycVerdict, PayVerdict } from "../src/run-demo.js";

const RECORD = { name: "z:test-tid:mandate-contracts", version: "0.1.0" };

describe("parseArgs", () => {
  it("defaults to cus_1 / inv_1 / 199.00 with no currency", () => {
    expect(parseArgs([])).toEqual({
      customerId: "cus_1",
      invoiceId: "inv_1",
      amount: "199.00",
    });
  });

  it("applies --customer/--invoice/--amount/--currency overrides", () => {
    expect(
      parseArgs([
        "--customer",
        "cus_9",
        "--invoice",
        "inv_9",
        "--amount",
        "42.00",
        "--currency",
        "EUR",
      ])
    ).toEqual({
      customerId: "cus_9",
      invoiceId: "inv_9",
      amount: "42.00",
      currency: "EUR",
    });
  });

  it("throws on unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown flag/);
    expect(() => parseArgs(["--bogus", "x"])).toThrow(/unknown flag/);
  });
});

describe("buildKycCall", () => {
  it("builds the exact onboard-customer wire call", () => {
    expect(buildKycCall(RECORD, "cus_7")).toEqual({
      contract_id: RECORD.name,
      contract_version: RECORD.version,
      function_name: "onboard-customer",
      input: { customer_id: "cus_7" },
    });
  });

  it("binds the delegation subject via pii_did when a subject DID is given", () => {
    const call = buildKycCall(
      RECORD,
      "cus_7",
      "did:t3n:6761170a932b75e9ba1f02659457e71ddcbb84f2"
    ) as Record<string, unknown>;
    expect(call.pii_did).toBe(
      "did:t3n:6761170a932b75e9ba1f02659457e71ddcbb84f2"
    );
  });

  it("omits pii_did when no subject is bound (SelfOnly call)", () => {
    const call = buildKycCall(RECORD, "cus_7") as Record<string, unknown>;
    expect(call.pii_did).toBeUndefined();
  });
});

describe("buildPayCall", () => {
  it("carries invoice_id + amount only when no currency is provided", () => {
    const call = buildPayCall(RECORD, { invoiceId: "inv_2", amount: "199.00" }) as {
      function_name: string;
      input: Record<string, unknown>;
    };
    expect(call.function_name).toBe("pay-invoice");
    expect(call.input).toEqual({ invoice_id: "inv_2", amount: "199.00" });
    expect(Object.keys(call.input).sort()).toEqual(["amount", "invoice_id"]);
  });

  it("adds currency only when provided", () => {
    const call = buildPayCall(RECORD, {
      invoiceId: "inv_2",
      amount: "42.00",
      currency: "EUR",
    }) as { input: Record<string, unknown> };
    expect(call.input).toEqual({
      invoice_id: "inv_2",
      amount: "42.00",
      currency: "EUR",
    });
  });

  it("is PII-free by construction — the agent's payload never names bank data", () => {
    const withCurrency = buildPayCall(RECORD, {
      invoiceId: "inv_2",
      amount: "199.00",
      currency: "GBP",
    }) as { input: Record<string, unknown> };
    const serialized = JSON.stringify(withCurrency.input);
    for (const pii of ["iban", "legal_name", "beneficiary", "GB29"]) {
      expect(serialized).not.toContain(pii);
    }
  });
});

describe("PAY_BODY_TEMPLATE", () => {
  it("mirrors the contract's pay egress: sealed beneficiary + email marker", () => {
    const serialized = JSON.stringify(PAY_BODY_TEMPLATE);
    expect(serialized).toContain("{{profile.verified_contacts.email.value}}");
    expect(serialized).toContain("rail_beneficiary");
    expect(serialized).toContain("sealed");
  });

  it("never contains plaintext bank data or bank markers", () => {
    const serialized = JSON.stringify(PAY_BODY_TEMPLATE);
    for (const plaintext of ["GB29", "NWBKGB2L", "Ada Bank"]) {
      expect(serialized).not.toContain(plaintext);
    }
    // Bank fields are NOT schema-backed profile fields (D1) — the template
    // must not fake a profile marker for them.
    for (const marker of ["{{profile.iban}}", "{{profile.swift_bic}}", "{{profile.legal_name}}"]) {
      expect(serialized).not.toContain(marker);
    }
  });
});

describe("runDemoSteps", () => {
  it("binds the subject DID on both executed calls when one is provided", async () => {
    const agent: ExecuteClient = {
      executeAndDecode: vi
        .fn()
        .mockResolvedValueOnce({
          kyc_id: "kyc_1",
          status: "verified",
          risk_score: 12,
        } as KycVerdict)
        .mockResolvedValueOnce({
          payment_id: "pay_1",
          status: "settled",
          iban_sha256: "9f2a…",
        } as PayVerdict),
    };
    const subject = "did:t3n:6761170a932b75e9ba1f02659457e71ddcbb84f2";
    await runDemoSteps(
      agent,
      RECORD,
      { customerId: "cus_1", invoiceId: "inv_1", amount: "199.00" },
      subject
    );
    const calls = (
      agent.executeAndDecode as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0]);
    expect(calls[0]).toEqual(buildKycCall(RECORD, "cus_1", subject));
    expect(calls[1]).toEqual(
      buildPayCall(RECORD, { invoiceId: "inv_1", amount: "199.00" }, subject)
    );
  });

  it("runs onboard-customer then pay-invoice and returns both verdicts", async () => {
    const kycVerdict: KycVerdict = {
      kyc_id: "kyc_1",
      status: "verified",
      risk_score: 12,
    };
    const payVerdict: PayVerdict = {
      payment_id: "pay_1",
      status: "settled",
      iban_sha256: "9f2a…",
    };
    const agent: ExecuteClient = {
      executeAndDecode: vi
        .fn()
        .mockResolvedValueOnce(kycVerdict)
        .mockResolvedValueOnce(payVerdict),
    };

    const result = await runDemoSteps(agent, RECORD, {
      customerId: "cus_1",
      invoiceId: "inv_1",
      amount: "199.00",
    });

    expect(result).toEqual({ kyc: kycVerdict, pay: payVerdict });
    expect(agent.executeAndDecode).toHaveBeenCalledTimes(2);
    const calls = (
      agent.executeAndDecode as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0]);
    expect(calls[0]).toEqual(buildKycCall(RECORD, "cus_1"));
    expect(calls[1]).toEqual(
      buildPayCall(RECORD, { invoiceId: "inv_1", amount: "199.00" })
    );
    expect(
      (calls[0] as { function_name: string }).function_name
    ).toBe("onboard-customer");
    expect(
      (calls[1] as { function_name: string }).function_name
    ).toBe("pay-invoice");
  });

  it("propagates egress denial from the pay call (no try/catch)", async () => {
    const agent: ExecuteClient = {
      executeAndDecode: vi
        .fn()
        .mockResolvedValueOnce({
          kyc_id: "kyc_1",
          status: "verified",
          risk_score: 12,
        })
        .mockRejectedValueOnce(
          new Error(
            "host/http.egress_denied: host 'x' is not in the authorised_hosts allowlist"
          )
        ),
    };

    await expect(
      runDemoSteps(agent, RECORD, {
        customerId: "cus_1",
        invoiceId: "inv_1",
        amount: "199.00",
      })
    ).rejects.toThrow(/egress_denied/);
  });
});

describe("fetchAuditEvents", () => {
  it("returns { ok: true, raw } when getAuditEvents resolves", async () => {
    const page = { batches: [{ events: [] }] };
    const getAuditEvents = vi.fn().mockResolvedValue(page);
    const client = {
      executeAndDecode: vi.fn(),
      getAuditEvents,
    } as Parameters<typeof fetchAuditEvents>[0];

    const result = await fetchAuditEvents(client, 10);
    expect(result).toEqual({ ok: true, raw: page });
    expect(getAuditEvents).toHaveBeenCalledWith({ limit: 10 });
  });

  it("reports { ok: false, error } — and never throws — when getAuditEvents is absent", async () => {
    const client = { executeAndDecode: vi.fn() } as Parameters<
      typeof fetchAuditEvents
    >[0];

    const result = await fetchAuditEvents(client, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("getAuditEvents");
    }
  });

  it("reports { ok: false } when getAuditEvents throws (never throws)", async () => {
    const client = {
      executeAndDecode: vi.fn(),
      getAuditEvents: vi
        .fn()
        .mockRejectedValue(new Error("audit rpc down")),
    } as Parameters<typeof fetchAuditEvents>[0];

    await expect(fetchAuditEvents(client, 10)).resolves.toMatchObject({
      ok: false,
    });
  });

  it("retries once on a transient throw right after a delegated execute", async () => {
    const page = { batches: [], next_cursor: null };
    const getAuditEvents = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Cannot read properties of undefined (reading 'status')")
      )
      .mockResolvedValueOnce(page);
    const client = {
      executeAndDecode: vi.fn(),
      getAuditEvents,
    } as Parameters<typeof fetchAuditEvents>[0];

    const result = await fetchAuditEvents(client, 10);
    expect(result).toEqual({ ok: true, raw: page });
    expect(getAuditEvents).toHaveBeenCalledTimes(2);
  });
});

describe("main gating", () => {
  it("importing run-demo.ts executes nothing (main is gated like connect.ts)", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      // Cache-busted re-execution of run-demo.ts's top level: the module must
      // define exports only — main() must NOT run (no exit, no logging). Its
      // dependencies (connect.ts etc.) are already loaded, so only this
      // module's top level re-runs under the spies.
      const specifier = "../src/run-demo.js?main-gate-check=1";
      const mod = (await import(specifier)) as typeof import("../src/run-demo.js");
      expect(typeof mod.main).toBe("function");
      expect(typeof mod.parseArgs).toBe("function");
      expect(exit).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      log.mockRestore();
      warn.mockRestore();
    }
  });
});
