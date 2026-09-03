/**
 * Behavioral tests for the mock rail app factory: endpoint contracts,
 * scrubbed responses (no PII echo), and the verbatim request log
 * (resolved values + Authorization header reach the logger — the whole
 * point of the counterparty-proof demo).
 */
import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRailApp } from "../src/app.js";
import type { RailLogEntry, RailLogger } from "../src/rail-log.js";

/** Fresh app instance + capturing logger per test. */
function makeHarness() {
  const entries: RailLogEntry[] = [];
  const logger: RailLogger = {
    logReceived: (entry: RailLogEntry) => {
      entries.push(entry);
    },
  };
  return { app: createRailApp(logger), entries };
}

describe("mock rail app", () => {
  it("GET /health → 200 { ok: true }", async () => {
    const { app } = makeHarness();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("POST /kyc happy path: verified, scrubbed response, verbatim log", async () => {
    const { app, entries } = makeHarness();
    const body = {
      customer_id: "cus_1",
      first_name: "Ada",
      last_name: "Bank",
      date_of_birth: "1990-01-15",
    };
    const res = await request(app).post("/kyc").send(body);
    expect(res.status).toBe(200);
    expect(res.body.kyc_id).toBeDefined();
    expect(res.body.status).toBe("verified");
    expect(res.body.risk_score).toBe(12);
    expect(res.body.checks).toEqual(["identity", "sanctions"]);
    // Scrubbed: response must not echo resolved PII values.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("Ada");
    expect(serialized).not.toContain("1990-01-15");
    // Log carries the resolved values by design.
    expect(entries).toHaveLength(1);
    expect(entries[0].endpoint).toBe("/kyc");
    const payload = entries[0].payload as {
      customer_id: string;
      first_name: string;
      last_name: string;
      date_of_birth: string;
    };
    expect(payload.first_name).toBe("Ada");
    expect(payload.last_name).toBe("Bank");
    expect(payload.date_of_birth).toBe("1990-01-15");
  });

  it("POST /kyc missing date_of_birth → 400 naming the field", async () => {
    const { app } = makeHarness();
    const res = await request(app)
      .post("/kyc")
      .send({ customer_id: "cus_1", first_name: "Ada", last_name: "Bank" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("date_of_birth");
  });

  it("POST /kyc with no body at all → 400 json body required", async () => {
    const { app } = makeHarness();
    const res = await request(app).post("/kyc");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("json body required");
  });

  it("POST /pay happy path: settled, iban_sha256 of exact raw IBAN, scrubbed", async () => {
    const { app, entries } = makeHarness();
    const rawIban = "GB29 NWBK 6016 1331 9268 19";
    const body = {
      beneficiary: {
        legal_name: "Ada Bank",
        iban: rawIban,
        swift: "NWBKGB2L",
      },
      amount: "199.00",
      currency: "GBP",
      reference: "inv_1",
    };
    const res = await request(app).post("/pay").send(body);
    expect(res.status).toBe(200);
    expect(res.body.payment_id).toBeDefined();
    expect(res.body.status).toBe("settled");
    expect(res.body.trace).toBe("T3N-MANDATE-DEMO");
    expect(res.body.iban_sha256).toBe(
      createHash("sha256").update(rawIban).digest("hex")
    );
    // Scrubbed: no iban / beneficiary-name echo in the response.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("GB29");
    expect(serialized).not.toContain("Ada");
    // Log carries the exact raw IBAN as received.
    expect(entries).toHaveLength(1);
    expect(entries[0].endpoint).toBe("/pay");
    const payload = entries[0].payload as {
      beneficiary: { legal_name: string; iban: string };
      amount: string;
    };
    expect(payload.beneficiary.iban).toBe(rawIban);
    expect(payload.beneficiary.legal_name).toBe("Ada Bank");
    expect(payload.amount).toBe("199.00");
  });

  it("POST /pay missing amount → 400 naming the field", async () => {
    const { app } = makeHarness();
    const res = await request(app).post("/pay").send({
      beneficiary: {
        legal_name: "Ada Bank",
        iban: "GB29 NWBK 6016 1331 9268 19",
        swift: "NWBKGB2L",
      },
      currency: "GBP",
      reference: "inv_1",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("amount");
  });

  it("POST /pay with a too-short IBAN 'XX' → 400 invalid iban", async () => {
    const { app } = makeHarness();
    const res = await request(app).post("/pay").send({
      beneficiary: {
        legal_name: "Ada Bank",
        iban: "XX",
        swift: "NWBKGB2L",
      },
      amount: "199.00",
      currency: "GBP",
      reference: "inv_1",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid iban");
  });

  it("POST /pay records the Authorization header verbatim in the log", async () => {
    const { app, entries } = makeHarness();
    const res = await request(app)
      .post("/pay")
      .set("Authorization", "Bearer rail_demo_key_1234")
      .send({
        beneficiary: {
          legal_name: "Ada Bank",
          iban: "GB29 NWBK 6016 1331 9268 19",
          swift: "NWBKGB2L",
        },
        amount: "199.00",
        currency: "GBP",
        reference: "inv_1",
      });
    expect(res.status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0].endpoint).toBe("/pay");
    expect(entries[0].authorization).toBe("Bearer rail_demo_key_1234");
  });
});
