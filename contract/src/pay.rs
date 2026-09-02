//! pay.rs — `pay-invoice` for z-mandate (Phase 2 implementation).
//!
//! The MANDATE "magic moment": the contract POSTs the beneficiary's REAL bank
//! details to the mock money rail — yet the contract itself never holds the
//! plaintext. The beneficiary legal name / IBAN / SWIFT-BIC enter the outbound
//! body ONLY as `{{profile.*}}` markers (crate::MARKER_LEGAL_NAME,
//! crate::MARKER_IBAN, crate::MARKER_SWIFT); the host's
//! `http-with-placeholders` interface substitutes the calling user's profile
//! values inside the enclave at dispatch time (Decision D1, see lib.rs).
//!
//! PII contract:
//!   - `PayReq` carries NO PII-named fields (no iban / beneficiary /
//!     legal_name / name — those arrive only as markers) and
//!     `deny_unknown_fields`, so an input smuggling inline bank details is
//!     rejected at parse time ("bad input: unknown field ...").
//!   - `amount` is a DECIMAL STRING ("199.00"), never f64 (money safety).
//!   - outbound body = markers only; never literal bank data.
//!   - rail responses are parsed into the scrubbed `PayVerdict`; `trace` and
//!     any other/unknown keys are ignored and never forwarded.
//!   - the raw rail response body is NEVER returned, logged, or echoed into
//!     errors — a rail could reflect the resolved plaintext PII back at us.
//!   - logs carry only the invoice_id and the HTTP status code, never the
//!     rail body content.

/// Pay-invoice request. PII-free by construction: beneficiary bank details
/// are NOT accepted here — they exist only as `{{profile.*}}` markers in the
/// outbound body. `deny_unknown_fields` makes any inline-PII smuggling
/// attempt a hard parse error.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayReq {
    pub invoice_id: String,
    /// Decimal string ("199.00"), never f64 — money safety.
    pub amount: String,
    pub currency: Option<String>,
    pub reference: Option<String>,
}

/// Scrubbed pay outcome returned to the caller. Deliberately omits `trace`
/// and everything else the rail may have echoed back.
#[derive(Debug, serde::Serialize)]
pub struct PayVerdict {
    pub payment_id: String,
    pub status: String,
    /// sha256 of the beneficiary IBAN as received by the rail — the
    /// proof-of-receipt binding this payment to the resolved profile, without
    /// ever revealing the plaintext IBAN.
    pub iban_sha256: String,
}

/// Entry point called from lib.rs dispatch. `input` is the raw JSON bytes
/// from the node's `generic-input.input` field. Parse + dispatch only — no
/// host imports at this level.
pub fn pay_invoice(input: &[u8]) -> Result<Vec<u8>, String> {
    if input.len() > crate::MAX_INPUT_BYTES {
        return Err("pay-invoice: bad input: input too large".to_string());
    }

    let req: PayReq =
        serde_json::from_slice(input).map_err(|e| format!("pay-invoice: bad input: {e}"))?;

    #[cfg(target_arch = "wasm32")]
    {
        let verdict = pay_invoice_wasm(&req)?;
        serde_json::to_vec(&verdict).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err("pay::pay_invoice is only implemented on the wasm32 target".to_string())
    }
}

/// Build the rail POST /pay body. Markers ONLY — the real beneficiary bank
/// details are substituted host-side from the calling user's profile via
/// http-with-placeholders after this contract serialises the body. Never
/// literal bank data.
fn build_pay_body(req: &PayReq) -> serde_json::Value {
    let currency = req.currency.clone().unwrap_or_else(|| "GBP".to_string());
    let reference = req
        .reference
        .clone()
        .unwrap_or_else(|| req.invoice_id.clone());
    serde_json::json!({
        "beneficiary": {
            "legal_name": crate::MARKER_LEGAL_NAME,
            "iban": crate::MARKER_IBAN,
            "swift": crate::MARKER_SWIFT,
        },
        "amount": req.amount,
        "currency": currency,
        "reference": reference,
    })
}

/// Parse the rail's pay response into a scrubbed `PayVerdict`. Requires
/// `payment_id`, `status` and `iban_sha256` (the sha256 proof-of-receipt is
/// mandatory); `trace` and any other keys are IGNORED — scrubbed out of the
/// verdict so they can never leak back to the caller.
fn parse_pay_verdict(bytes: &[u8]) -> Result<PayVerdict, String> {
    let v: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("pay response: bad json: {e}"))?;

    let payment_id = v
        .get("payment_id")
        .and_then(serde_json::Value::as_str)
        .ok_or("pay response missing payment_id")?
        .to_string();
    let status = v
        .get("status")
        .and_then(serde_json::Value::as_str)
        .ok_or("pay response missing status")?
        .to_string();
    let iban_sha256 = v
        .get("iban_sha256")
        .and_then(serde_json::Value::as_str)
        .ok_or("pay response missing iban_sha256")?
        .to_string();

    Ok(PayVerdict {
        payment_id,
        status,
        iban_sha256,
    })
}

#[cfg(target_arch = "wasm32")]
use crate::host::interfaces::{http_with_placeholders as hwp, logging};

/// Thin wasm-only driver: read the sealed rail key, POST the marker body to
/// the rail, enforce the scrub/guard rules. Mirrors booking::book_offer_wasm.
#[cfg(target_arch = "wasm32")]
fn pay_invoice_wasm(req: &PayReq) -> Result<PayVerdict, String> {
    let api_key = crate::get_rail_api_key()?;
    let body = build_pay_body(req);

    // Log ONLY the invoice_id — never amount, currency, or body content.
    let _ = logging::info(&alloc::format!(
        "Calling rail POST /pay for invoice {}",
        req.invoice_id
    ));

    let resp = hwp::call(&hwp::Request {
        method: hwp::Verb::Post,
        url: alloc::format!("{}/pay", crate::RAIL_BASE),
        headers: Some(crate::rail_headers(&api_key)),
        payload: Some(serde_json::to_vec(&body).map_err(|e| e.to_string())?),
    })
    .map_err(|e| alloc::format!("pay-invoice: {}", crate::format_http_error(e)))?;

    if resp.code != 200 && resp.code != 201 {
        // DELIBERATE deviation from the Duffel reference (booking.rs): the
        // rail body is NEVER included in the error or the log — a rail could
        // echo the resolved plaintext PII back at us. HTTP code only.
        let _ = logging::error(&alloc::format!("pay-invoice failed: HTTP {}", resp.code));
        return Err(alloc::format!("pay-invoice failed: HTTP {}", resp.code));
    }

    if resp.payload.len() > crate::MAX_RESP_BYTES {
        return Err("pay-invoice: response too large".to_string());
    }

    parse_pay_verdict(&resp.payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_req(v: serde_json::Value) -> PayReq {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn pay_invoice_non_wasm_returns_err() {
        let input = serde_json::to_vec(&serde_json::json!({
            "invoice_id": "inv_1",
            "amount": "199.00",
        }))
        .unwrap();
        let result = pay_invoice(&input);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("only implemented on the wasm32 target"));
    }

    #[test]
    fn pay_invoice_bad_input_not_json() {
        let result = pay_invoice(b"not json");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad input"));
    }

    #[test]
    fn pay_invoice_rejects_inline_pii() {
        let input = serde_json::to_vec(&serde_json::json!({
            "invoice_id": "inv_1",
            "amount": "199.00",
            "iban": "GB29 NWBK 6016 1331 9268 19",
            "beneficiary": { "legal_name": "Ada Bank" },
        }))
        .unwrap();
        let result = pay_invoice(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad input"));
    }

    #[test]
    fn pay_invoice_rejects_oversized_input() {
        let input = serde_json::to_vec(&serde_json::json!({
            "invoice_id": "x".repeat(70_000),
            "amount": "199.00",
        }))
        .unwrap();
        let result = pay_invoice(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad input"));
    }

    #[test]
    fn build_pay_body_is_markers_only() {
        let req = parse_req(serde_json::json!({
            "invoice_id": "inv_1",
            "amount": "199.00",
        }));
        let body = build_pay_body(&req);
        assert_eq!(body["beneficiary"]["iban"], "{{profile.iban}}");
        assert_eq!(body["beneficiary"]["swift"], "{{profile.swift_bic}}");
        assert_eq!(body["beneficiary"]["legal_name"], "{{profile.legal_name}}");
        let s = body.to_string();
        assert!(s.contains("{{profile."), "body must carry markers: {s}");
        assert!(!s.contains("GB29"), "no plaintext IBAN: {s}");
        assert!(!s.contains("NWBKGB2L"), "no plaintext SWIFT: {s}");
        assert!(!s.contains("Ada Bank"), "no plaintext name: {s}");
    }

    #[test]
    fn build_pay_body_defaults() {
        let req = parse_req(serde_json::json!({
            "invoice_id": "inv_42",
            "amount": "199.00",
        }));
        let body = build_pay_body(&req);
        assert_eq!(body["amount"], "199.00");
        assert_eq!(body["currency"], "GBP");
        assert_eq!(body["reference"], "inv_42");

        let req_explicit = parse_req(serde_json::json!({
            "invoice_id": "inv_42",
            "amount": "199.00",
            "currency": "EUR",
            "reference": "PO-42",
        }));
        let body_explicit = build_pay_body(&req_explicit);
        assert_eq!(body_explicit["currency"], "EUR");
        assert_eq!(body_explicit["reference"], "PO-42");
    }

    #[test]
    fn parse_pay_verdict_ok_and_scrubbed() {
        let bytes = br#"{"payment_id":"pay_1","status":"settled","trace":"T3N-MANDATE-DEMO","iban_sha256":"9f2a..."}"#;
        let verdict = parse_pay_verdict(bytes).unwrap();
        assert_eq!(verdict.payment_id, "pay_1");
        assert_eq!(verdict.status, "settled");
        assert_eq!(verdict.iban_sha256, "9f2a...");
        let serialized = serde_json::to_string(&verdict).unwrap();
        assert!(
            !serialized.contains("trace"),
            "trace must be scrubbed: {serialized}"
        );
        assert!(
            !serialized.contains("T3N-MANDATE-DEMO"),
            "trace value must be scrubbed: {serialized}"
        );
    }

    #[test]
    fn parse_pay_verdict_missing_iban_sha256() {
        let bytes = br#"{"payment_id":"pay_1","status":"settled"}"#;
        let err = parse_pay_verdict(bytes).unwrap_err();
        assert!(err.contains("iban_sha256"), "err: {err}");
    }

    #[test]
    fn parse_pay_verdict_not_json() {
        let result = parse_pay_verdict(b"not json");
        assert!(result.is_err());
    }
}
