//! kyc.rs — `onboard-customer` for z-mandate: registers a customer with the
//! mock money rail (POST {RAIL_BASE}/kyc).
//!
//! PII contract (mirrors the crate-wide Decision D1 marker strategy):
//!   - IN:  `KycReq` carries NO PII fields and `deny_unknown_fields`, so any
//!          inline PII (legal_name, iban, date_of_birth, ...) in the input is
//!          rejected at parse time with `bad input: unknown field ...`. Only
//!          an operational id (`customer_id`, e.g. "cus_1") may be supplied.
//!   - OUT: the rail body carries MARKERS ONLY (`{{profile.legal_name}}`,
//!          `{{profile.date_of_birth}}`) which the host's
//!          http-with-placeholders resolves inside the enclave from the
//!          calling user's profile — plaintext PII never enters WASM memory,
//!          and never crosses the WASM boundary outward.
//!   - BACK: rail responses are parsed into the scrubbed `KycVerdict`
//!          (kyc_id / status / risk_score only); `checks` and any other keys
//!          are never forwarded. The raw rail body is never returned or
//!          logged (a rail could echo PII back): errors and logs carry only
//!          the HTTP code.

/// Request for `onboard-customer`. `deny_unknown_fields` makes inline-PII
/// rejection REAL: any field beyond `customer_id` (e.g. a would-be
/// `legal_name`, `iban`, or `date_of_birth`) fails parse as an unknown field.
/// `customer_id` is an operational id ("cus_1"), not PII.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KycReq {
    pub customer_id: String,
}

/// Scrubbed rail verdict — only these fields may leave the contract.
/// `checks` and every other rail response key are dropped on purpose.
#[derive(Debug, serde::Serialize)]
pub struct KycVerdict {
    pub kyc_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk_score: Option<serde_json::Value>,
}

/// Entry point called from `lib.rs`. `input` is the raw JSON bytes from the
/// node's `generic-input.input` field.
pub fn onboard_customer(input: &[u8]) -> Result<Vec<u8>, String> {
    if input.len() > crate::MAX_INPUT_BYTES {
        return Err(format!("onboard-customer: bad input: input too large"));
    }

    let req: KycReq =
        serde_json::from_slice(input).map_err(|e| format!("onboard-customer: bad input: {e}"))?;

    #[cfg(target_arch = "wasm32")]
    {
        let verdict = onboard_customer_wasm(req)?;
        serde_json::to_vec(&verdict).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err("kyc::onboard_customer is only implemented on the wasm32 target".to_string())
    }
}

/// Outbound rail body: markers ONLY for PII fields. `customer_id` is the
/// operational id passed through from the request.
fn build_kyc_body(req: &KycReq) -> serde_json::Value {
    serde_json::json!({
        "customer_id": req.customer_id,
        "legal_name": crate::MARKER_LEGAL_NAME,
        "date_of_birth": crate::MARKER_DATE_OF_BIRTH,
    })
}

/// Parse and scrub a rail KYC verdict. Requires string `kyc_id` and `status`
/// (Err names the missing key); `risk_score` is forwarded only when it is a
/// number (present-but-non-numeric is treated as missing). All other keys —
/// notably `checks` — are ignored and never forwarded.
fn parse_kyc_verdict(bytes: &[u8]) -> Result<KycVerdict, String> {
    let v: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("kyc response not valid json: {e}"))?;

    let kyc_id = v
        .get("kyc_id")
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .ok_or_else(|| "kyc response missing kyc_id".to_string())?;
    let status = v
        .get("status")
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .ok_or_else(|| "kyc response missing status".to_string())?;
    let risk_score = v.get("risk_score").filter(|x| x.is_number()).cloned();

    Ok(KycVerdict {
        kyc_id,
        status,
        risk_score,
    })
}

#[cfg(target_arch = "wasm32")]
use crate::host::interfaces::{http_with_placeholders as hwp, logging};

#[cfg(target_arch = "wasm32")]
fn onboard_customer_wasm(req: KycReq) -> Result<KycVerdict, String> {
    let api_key = crate::get_rail_api_key()?;
    let body = build_kyc_body(&req);

    // Log ONLY the operational customer id — never any resolved profile data.
    let _ = logging::info(&format!(
        "Calling rail POST /kyc for customer {}",
        req.customer_id
    ));

    let resp = hwp::call(&hwp::Request {
        method: hwp::Verb::Post,
        url: format!("{}/kyc", crate::RAIL_BASE),
        headers: Some(crate::rail_headers(&api_key)),
        payload: Some(serde_json::to_vec(&body).map_err(|e| e.to_string())?),
    })
    .map_err(|e| format!("onboard-customer: {}", crate::format_http_error(e)))?;

    // Deliberate deviation from the Duffel reference (booking.rs): NEVER
    // include the rail response body in errors or logs — a rail could echo
    // PII back, and PII must never cross the WASM boundary outward.
    if resp.code != 200 && resp.code != 201 {
        let _ = logging::error(&format!("onboard-customer failed: HTTP {}", resp.code));
        return Err(format!("onboard-customer failed: HTTP {}", resp.code));
    }

    if resp.payload.len() > crate::MAX_RESP_BYTES {
        return Err("onboard-customer: rail response too large".to_string());
    }

    parse_kyc_verdict(&resp.payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn onboard_customer_non_wasm_returns_err() {
        let input = serde_json::to_vec(&serde_json::json!({
            "customer_id": "cus_1",
        }))
        .unwrap();
        let result = onboard_customer(&input);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("only implemented on the wasm32 target"));
    }

    #[test]
    fn onboard_customer_bad_input_not_json() {
        let result = onboard_customer(b"not json");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad input"));
    }

    #[test]
    fn onboard_customer_rejects_inline_pii() {
        let input = serde_json::to_vec(&serde_json::json!({
            "customer_id": "cus_1",
            "legal_name": "Ada Bank",
            "iban": "GB29 NWBK 6016 1331 9268 19",
        }))
        .unwrap();
        let result = onboard_customer(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad input"));
    }

    #[test]
    fn onboard_customer_rejects_oversized_input() {
        let input = serde_json::to_vec(&serde_json::json!({
            "customer_id": "x".repeat(70_000),
        }))
        .unwrap();
        assert!(input.len() > crate::MAX_INPUT_BYTES);
        let result = onboard_customer(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad input"));
    }

    #[test]
    fn build_kyc_body_is_markers_only() {
        let req = KycReq {
            customer_id: "cus_1".to_string(),
        };
        let body = build_kyc_body(&req);
        assert_eq!(body["customer_id"], "cus_1");
        assert_eq!(body["legal_name"], "{{profile.legal_name}}");
        assert_eq!(body["date_of_birth"], "{{profile.date_of_birth}}");
        let text = body.to_string();
        assert!(text.contains("{{profile."), "body must template markers");
        // KYC must never touch literal PII nor bank markers.
        assert!(!text.contains("Ada"), "no literal name allowed: {text}");
        assert!(!text.contains("1990-01-15"), "no literal dob allowed: {text}");
        assert!(!text.contains("GB29"), "no literal iban allowed: {text}");
        assert!(
            !text.contains("{{profile.iban}}"),
            "KYC must never carry bank markers: {text}"
        );
    }

    #[test]
    fn parse_kyc_verdict_ok_and_scrubbed() {
        let bytes = serde_json::to_vec(&serde_json::json!({
            "kyc_id": "kyc_1",
            "status": "verified",
            "risk_score": 12,
            "checks": ["identity", "sanctions"],
        }))
        .unwrap();
        let verdict = parse_kyc_verdict(&bytes).expect("valid verdict parses");
        assert_eq!(verdict.kyc_id, "kyc_1");
        assert_eq!(verdict.status, "verified");
        assert_eq!(verdict.risk_score, Some(serde_json::json!(12)));
        let out = serde_json::to_string(&verdict).unwrap();
        assert!(out.contains("kyc_id"), "kyc_id must be forwarded: {out}");
        assert!(
            !out.contains("checks"),
            "checks must be scrubbed from the verdict: {out}"
        );
    }

    #[test]
    fn parse_kyc_verdict_risk_score_absent() {
        let bytes = serde_json::to_vec(&serde_json::json!({
            "kyc_id": "kyc_1",
            "status": "verified",
        }))
        .unwrap();
        let verdict = parse_kyc_verdict(&bytes).expect("valid verdict parses");
        assert!(verdict.risk_score.is_none());
        let out = serde_json::to_string(&verdict).unwrap();
        assert!(
            !out.contains("risk_score"),
            "absent risk_score must not be serialized: {out}"
        );
    }

    #[test]
    fn parse_kyc_verdict_risk_score_non_numeric_treated_missing() {
        let bytes = serde_json::to_vec(&serde_json::json!({
            "kyc_id": "kyc_1",
            "status": "verified",
            "risk_score": "high",
        }))
        .unwrap();
        let verdict = parse_kyc_verdict(&bytes).expect("valid verdict parses");
        assert!(
            verdict.risk_score.is_none(),
            "non-numeric risk_score must be treated as missing"
        );
    }

    #[test]
    fn parse_kyc_verdict_missing_kyc_id() {
        let bytes = serde_json::to_vec(&serde_json::json!({
            "status": "verified",
        }))
        .unwrap();
        let err = parse_kyc_verdict(&bytes).expect_err("missing kyc_id must error");
        assert!(err.contains("kyc_id"), "err must name the key: {err}");
    }

    #[test]
    fn parse_kyc_verdict_not_json() {
        let err = parse_kyc_verdict(b"not json").expect_err("non-json must error");
        assert!(!err.is_empty());
    }
}
