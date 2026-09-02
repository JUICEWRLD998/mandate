//! z-mandate v0.1.0 — TEE contract for MANDATE (onboard-customer / pay-invoice).
//!
//! Enterprise onboarding + first-payment against the mock money rail, where the
//! customer's identity and bank details enter ONLY as `{{profile.<field>}}`
//! markers resolved host-side inside the enclave (http-with-placeholders) —
//! the contract, the LLM and the application host never see the plaintext.
//!
//! Structure mirrors z-tenant-flight (the canonical Terminal 3 example):
//!   - lib.rs — wit-bindgen bindings, Guest dispatch, shared wasm helpers
//!   - kyc.rs — onboard-customer: POST {RAIL_BASE}/kyc
//!   - pay.rs — pay-invoice:      POST {RAIL_BASE}/pay
//!
//! Every operation keeps the same PII contract:
//!   - request structs carry NO PII fields and deny unknown fields, so inline
//!     PII in an input is rejected at parse ("bad input: unknown field ...")
//!   - outbound bodies carry markers only (the crate::MARKER_* consts)
//!   - rail responses are parsed into scrubbed verdict structs; raw bodies are
//!     never forwarded, logged, or returned (a rail could echo PII back).
#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

/// Contract semantic version — must match the node's contract_version at
/// registration. Bump in lockstep with wit/world.wit's package version.
pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "mandate",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod kyc;
mod pay;

/// Base URL of the mock money rail. The delegation grant's `allowedHosts`
/// MUST name this host (`localhost:8787`) or every egress is denied with
/// `host/http.egress_denied`. The Phase 4 mock rail listens here.
pub const RAIL_BASE: &str = "http://localhost:8787";

/// Hard ceiling on inbound request bytes (reference crate uses the same guard;
/// serde_json can OOM inside WASM on oversized inputs).
pub const MAX_INPUT_BYTES: usize = 65_536;

/// Hard ceiling on rail response bytes the contract is willing to parse.
pub const MAX_RESP_BYTES: usize = 65_536;

// ---------------------------------------------------------------------------
// Marker strategy (Decision D1 — Phase 1 outcome, live-testnet verified)
// ---------------------------------------------------------------------------
// Phase 1 (walkthrough executed 2026-09-01) PROVED on testnet:
//   {{profile.first_name}} and {{profile.last_name}} resolve from the calling
//   user's profile; {{profile.date_of_birth}} failed with `user profile
//   missing field: date_of_birth` on the walkthrough profile (BUG-006: the
//   demo profile simply did not carry it).
//   {{profile.legal_name}}, {{profile.iban}}, {{profile.swift_bic}} are NOT in
//   the docs' documented profile-field list and remain UNCONFIRMED — they
//   resolve only if the demo user's profile (host Phase 3 user-upsert) carries
//   the field AND the cluster's profile schema permits it for substitution.
//
// Strategy (reversible at ONE edit point — these consts):
//   bodies template the markers below. A field whose marker fails to resolve
//   at the first live registration (Phase 3/5 integration) is switched to the
//   docs' own fallback: a DEMO-HARDCODED value supplied by the contract — the
//   exact z-tenant-flight passport_number precedent — and the trade-off is
//   documented in the README. Swap = change the const, not the call sites.
// ---------------------------------------------------------------------------
pub const MARKER_FIRST_NAME: &str = "{{profile.first_name}}";
pub const MARKER_LAST_NAME: &str = "{{profile.last_name}}";
pub const MARKER_LEGAL_NAME: &str = "{{profile.legal_name}}";
pub const MARKER_DATE_OF_BIRTH: &str = "{{profile.date_of_birth}}";
pub const MARKER_IBAN: &str = "{{profile.iban}}";
pub const MARKER_SWIFT: &str = "{{profile.swift_bic}}";

#[cfg(target_arch = "wasm32")]
use crate::host::{
    interfaces::{http_with_placeholders as hwp, kv_store},
    tenant::tenant_context,
};

/// Rail API key, read from `z:<tid>:secrets` (map name built from the
/// hex-encoded tenant DID — the canonical gotcha: tenant_did() returns raw
/// bytes). Seeded by the tenant via control-plane `map-entry-set`; the map's
/// writers/readers ACL is `{only: [contractId]}`, so this is the only path to
/// the key. The key itself is never logged.
#[cfg(target_arch = "wasm32")]
pub fn get_rail_api_key() -> Result<alloc::string::String, alloc::string::String> {
    let tid = tenant_context::tenant_did();
    let map_name = alloc::format!("z:{}:secrets", hex::encode(&tid));
    let bytes = kv_store::get(&map_name, b"rail_api_key")
        .map_err(|e| alloc::format!("kv read: {e}"))?
        .ok_or("rail_api_key not found in z:<tid>:secrets — seed it via the tenant SDK (map-entry-set) before use")?;
    alloc::string::String::from_utf8(bytes).map_err(|e| e.to_string())
}

/// Render a typed `http-with-placeholders` error as a contract-facing string.
/// Never includes resolved PII — only marker field names and host-side reasons.
#[cfg(target_arch = "wasm32")]
pub fn format_http_error(e: hwp::HttpError) -> alloc::string::String {
    match e {
        hwp::HttpError::EgressDenied(host) => alloc::format!("egress denied for host {host}"),
        hwp::HttpError::PlaceholderDenied(marker) => {
            alloc::format!("placeholder not permitted: {marker}")
        }
        hwp::HttpError::PlaceholderUnknown(field) => {
            alloc::format!("user profile missing field: {field}")
        }
        hwp::HttpError::PlaceholderNoUserContext => {
            "no user context bound for placeholder resolution".to_string()
        }
        hwp::HttpError::UpstreamError(reason) => alloc::format!("upstream: {reason}"),
    }
}

/// Authorization header built from the sealed rail key.
/// Content-Type is NOT set here — the host's http-with-placeholders sets it
/// automatically (`.json()`); sending it explicitly creates a duplicate that
/// upstreams reject (Duffel precedent in z-tenant-flight).
#[cfg(target_arch = "wasm32")]
pub fn rail_headers(
    api_key: &str,
) -> alloc::vec::Vec<(alloc::string::String, alloc::string::String)> {
    alloc::vec![(
        "Authorization".to_string(),
        alloc::format!("Bearer {api_key}"),
    )]
}

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::mandate::contracts::Guest for Component {
    fn onboard_customer(
        req: exports::z::mandate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("onboard-customer: missing input")?;
        kyc::onboard_customer(&input)
    }

    fn pay_invoice(
        req: exports::z::mandate::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("pay-invoice: missing input")?;
        pay::pay_invoice(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "CONTRACT_VERSION must be MAJOR.MINOR.PATCH");
        for part in parts {
            assert!(part.parse::<u32>().is_ok(), "each part must be a number");
        }
    }

    #[test]
    fn contract_version_is_v0_1_0() {
        assert_eq!(CONTRACT_VERSION, "0.1.0");
    }
}
