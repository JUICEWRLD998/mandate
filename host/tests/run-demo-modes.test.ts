import { describe, expect, it, vi } from "vitest";
import {
  buildKycCall,
  buildPayCall,
  runKyc,
  runPay,
  type KycVerdict,
  type PayVerdict,
} from "../src/run-demo.js";

const record = { name: "z:abc123:mandate-contracts", version: "0.1.0" };

describe("runKyc / runPay single-step drivers (Phase 5 demo modes)", () => {
  it("runKyc executes only the onboard-customer call with the kyc shape", async () => {
    const agent = {
      executeAndDecode: vi
        .fn()
        .mockResolvedValue({
          kyc_id: "kyc_1",
          status: "verified",
          risk_score: 12,
        } satisfies KycVerdict),
    };
    const verdict = await runKyc(agent, record, "cus_7");
    expect(verdict.kyc_id).toBe("kyc_1");
    expect(agent.executeAndDecode).toHaveBeenCalledTimes(1);
    expect(agent.executeAndDecode).toHaveBeenCalledWith(
      buildKycCall(record, "cus_7")
    );
  });

  it("runPay executes only the pay-invoice call with the pay shape", async () => {
    const agent = {
      executeAndDecode: vi
        .fn()
        .mockResolvedValue({
          payment_id: "pay_1",
          status: "settled",
          iban_sha256: "9f2a",
        } satisfies PayVerdict),
    };
    const verdict = await runPay(agent, record, {
      invoiceId: "inv_9",
      amount: "42.00",
      currency: "EUR",
    });
    expect(verdict.payment_id).toBe("pay_1");
    expect(agent.executeAndDecode).toHaveBeenCalledTimes(1);
    expect(agent.executeAndDecode).toHaveBeenCalledWith(
      buildPayCall(record, { invoiceId: "inv_9", amount: "42.00", currency: "EUR" })
    );
  });

  it("runPay passes no currency key when the demo omits it", async () => {
    const agent = {
      executeAndDecode: vi.fn().mockResolvedValue({
        payment_id: "pay_2",
        status: "settled",
        iban_sha256: "9f2b",
      } satisfies PayVerdict),
    };
    await runPay(agent, record, { invoiceId: "inv_1", amount: "199.00" });
    const call = agent.executeAndDecode.mock.calls[0][0] as {
      input: Record<string, unknown>;
    };
    expect(call.input).toEqual({ invoice_id: "inv_1", amount: "199.00" });
    expect("currency" in call.input).toBe(false);
  });
});
