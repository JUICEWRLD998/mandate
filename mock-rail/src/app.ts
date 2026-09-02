/**
 * mock-rail Express app — the MOCK COUNTERPARTY rail's HTTP API.
 *
 * Three endpoints, all in the service of the MANDATE demo's "magic moment":
 * the enclave never holds plaintext, the rail does — so every request is
 * logged VERBATIM (resolved {{profile.*}} values included) via the injected
 * RailLogger (real impl → rail.log, gitignored; tests → in-memory capture),
 * while every RESPONSE is scrubbed: no legal_name / date_of_birth / iban /
 * swift / amount is ever echoed back toward the enclave.
 *
 * The rail does not enforce auth — but the Authorization header (Bearer
 * <rail_api_key> from KV) IS recorded in each log entry, because the demo
 * script greps rail.log to prove the counterparty saw the credential path.
 */
import { createHash, randomBytes } from "node:crypto";
import express from "express";
import type { RailLogger } from "./rail-log.js";

/**
 * sha256 HEX of `value` computed on the EXACT string as received — spaces
 * preserved, NO normalization, NO trimming. The demo script re-hashes the
 * IBAN it extracts from rail.log and must obtain an identical digest, so
 * this function must never alter its input.
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** True for any non-null object (plain objects, and JS objects in general). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** First of `fields` missing from `body` (absent / not a non-empty string), else undefined. */
function firstMissingString(
  body: Record<string, unknown>,
  fields: string[]
): string | undefined {
  for (const field of fields) {
    if (!isNonEmptyString(body[field])) {
      return field;
    }
  }
  return undefined;
}

/**
 * Sanity check on the RAW IBAN value: 15–34 chars of A–Z, 0–9 and spaces
 * (both 'IBAN ' and 'IBAN' forms pass). Case-insensitive.
 */
const IBAN_RE = /^[A-Z0-9 ]{15,34}$/i;

/** 4 random bytes → 8 hex chars; prefixed ids are 12 chars total. */
function railId(prefix: "kyc_" | "pay_"): string {
  return prefix + randomBytes(4).toString("hex");
}

/**
 * Build the rail app. The logger is INJECTED: src/server.ts wires the real
 * file logger (rail.log), tests wire capturing fakes.
 */
export function createRailApp(logger: RailLogger): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post("/kyc", (req, res) => {
    // Body guard: anything that is not a non-null object is rejected.
    if (!isRecord(req.body)) {
      res.status(400).json({ error: "json body required" });
      return;
    }
    const missing = firstMissingString(req.body, [
      "customer_id",
      "legal_name",
      "date_of_birth",
    ]);
    if (missing !== undefined) {
      res.status(400).json({ error: `missing field: ${missing}` });
      return;
    }
    // BY DESIGN: full body incl. resolved plaintext goes to the log
    // (counterparty proof; rail.log is gitignored) — never into the response.
    logger.logReceived({
      ts: new Date().toISOString(),
      endpoint: "/kyc",
      payload: req.body,
      authorization: req.headers.authorization,
    });
    // Scrubbed response: no legal_name / date_of_birth echo.
    res.status(200).json({
      kyc_id: railId("kyc_"),
      status: "verified",
      risk_score: 12,
      checks: ["identity", "sanctions"],
    });
  });

  app.post("/pay", (req, res) => {
    if (!isRecord(req.body)) {
      res.status(400).json({ error: "json body required" });
      return;
    }
    const body = req.body;
    if (!isRecord(body.beneficiary)) {
      res.status(400).json({ error: "missing field: beneficiary" });
      return;
    }
    const beneficiary = body.beneficiary;
    const missingNested = firstMissingString(beneficiary, [
      "legal_name",
      "iban",
      "swift",
    ]);
    if (missingNested !== undefined) {
      res
        .status(400)
        .json({ error: `missing field: beneficiary.${missingNested}` });
      return;
    }
    const amount = body.amount;
    const amountOk =
      isNonEmptyString(amount) ||
      (typeof amount === "number" && Number.isFinite(amount));
    if (!amountOk) {
      res.status(400).json({ error: "missing field: amount" });
      return;
    }
    const missingTop = firstMissingString(body, ["currency", "reference"]);
    if (missingTop !== undefined) {
      res.status(400).json({ error: `missing field: ${missingTop}` });
      return;
    }
    const iban = beneficiary.iban;
    if (typeof iban !== "string" || !IBAN_RE.test(iban)) {
      res.status(400).json({ error: "invalid iban" });
      return;
    }
    logger.logReceived({
      ts: new Date().toISOString(),
      endpoint: "/pay",
      payload: req.body,
      authorization: req.headers.authorization,
    });
    // Scrubbed response: never reflect legal_name / iban / swift / amount.
    // Only a one-way digest of the EXACT iban string goes back.
    res.status(200).json({
      payment_id: railId("pay_"),
      status: "settled",
      trace: "T3N-MANDATE-DEMO",
      iban_sha256: sha256Hex(iban),
    });
  });

  return app;
}
