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
pub const CONTRACT_VERSION: &str = "0.3.0";

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

/// Base URL of the mock money rail — the FALLBACK when no `rail_url` entry is
/// seeded in the contract's secrets map. The delegation grant's `allowedHosts`
/// MUST name the rail's host or every egress is denied with
/// `host/http.egress_denied`.
///
/// LIVE-TESTNET FACT (verified 2026-09-03): the enclave runs on the T3N node,
/// so `localhost`/loopback egress is NEVER reachable — the rail must sit at a
/// PUBLIC URL (tunnel or deployed endpoint) and `rail_base()` resolves it from
/// the `rail_url` secret seeded by the tenant. Local dev (no `rail_url` seeded)
/// keeps this default.
pub const RAIL_BASE: &str = "http://localhost:8787";

/// Hard ceiling on inbound request bytes (reference crate uses the same guard;
/// serde_json can OOM inside WASM on oversized inputs).
pub const MAX_INPUT_BYTES: usize = 65_536;

/// Hard ceiling on rail response bytes the contract is willing to parse.
pub const MAX_RESP_BYTES: usize = 65_536;

// ---------------------------------------------------------------------------
// Marker strategy (Decision D1 — RESOLVED LIVE 2026-09-03, see docs/buglog)
// ---------------------------------------------------------------------------
// Live-testnet probe result on the cluster's profile schema (user-upsert via
// submitUserInput, email-OTP-bound user DID):
//   RESOLVES:  {{profile.first_name}} · {{profile.last_name}} ·
//              {{profile.date_of_birth}} ·
//              {{profile.verified_contacts.email.value}} (documented fields —
//              the schema stores them and the enclave substitutes them)
//   REJECTED:  the profile upsert REFUSES unrecognized keys with
//              `Profile validation failed ... UnrecognizedKeys { keys:
//              ["iban", "legal_name", "swift_bic"] }` — the cluster's profile
//              schema is CLOSED and cannot carry bank-detail fields.
// Strategy (the docs' own stated fallback — placeholders page: "Fields the
// schema doesn't carry yet (passport, title) are supplied by your contract
// directly", mirroring the payroll use-case where the enterprise stores
// payment info once in T3N):
//   - PERSON data (KYC beat) travels as the schema-backed markers above —
//     plaintext never enters WASM memory.
//   - PAYMENT config (beneficiary legal_name/iban/swift) is read at call time
//     from the sealed `rail_beneficiary` secret in z:<tid>:secrets (seeded by
//     the tenant control plane) — the plaintext exists only inside the TDX
//     enclave during the egress, never in the TS host, the LLM, or the repo.
// ---------------------------------------------------------------------------
pub const MARKER_FIRST_NAME: &str = "{{profile.first_name}}";
pub const MARKER_LAST_NAME: &str = "{{profile.last_name}}";
pub const MARKER_DATE_OF_BIRTH: &str = "{{profile.date_of_birth}}";
pub const MARKER_EMAIL: &str = "{{profile.verified_contacts.email.value}}";

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

/// Resolve the rail base URL at call time: the `rail_url` secret in
/// `z:<tid>:secrets` when seeded (public tunnel / deployed endpoint — the only
/// reachable egress target from the enclave, see RAIL_BASE docs), else the
/// local-dev `RAIL_BASE` fallback. Seeded by the tenant via control-plane
/// `map-entry-set` alongside `rail_api_key`. A seeded-but-empty value also
/// falls back (a blank rail_url must not produce a malformed outbound URL).
#[cfg(target_arch = "wasm32")]
pub fn rail_base() -> Result<alloc::string::String, alloc::string::String> {
    let tid = tenant_context::tenant_did();
    let map_name = alloc::format!("z:{}:secrets", hex::encode(&tid));
    match kv_store::get(&map_name, b"rail_url") {
        Ok(Some(bytes)) => match alloc::string::String::from_utf8(bytes) {
            Ok(url) if !url.trim().is_empty() => Ok(url),
            _ => Ok(RAIL_BASE.to_string()),
        },
        Ok(None) => Ok(RAIL_BASE.to_string()),
        Err(e) => Err(alloc::format!("kv read: {e}")),
    }
}

/// The rail-side beneficiary payment config, sealed in z:<tid>:secrets as
/// `rail_beneficiary` JSON. Stored ONCE by the tenant (control-plane seed —
/// the "enterprise stores its payment info once in T3N" model, docs payroll
/// use-case); read inside the enclave at call time and placed into the
/// outbound /pay body. The TS host and the LLM never see these values.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RailBeneficiary {
    pub legal_name: String,
    pub iban: String,
    pub swift: String,
}

/// KV helper for `RailBeneficiary` (wasm-only, mirrors get_rail_api_key).
#[cfg(target_arch = "wasm32")]
pub fn get_rail_beneficiary() -> Result<RailBeneficiary, alloc::string::String> {
    let tid = tenant_context::tenant_did();
    let map_name = alloc::format!("z:{}:secrets", hex::encode(&tid));
    let bytes = kv_store::get(&map_name, b"rail_beneficiary")
        .map_err(|e| alloc::format!("kv read: {e}"))?
        .ok_or("rail_beneficiary not found in z:<tid>:secrets — seed it via the tenant SDK (map-entry-set) before use")?;
    serde_json::from_slice(&bytes).map_err(|e| alloc::format!("rail_beneficiary not valid json: {e}"))
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
    fn contract_version_is_v0_3_0() {
        assert_eq!(CONTRACT_VERSION, "0.3.0");
    }
}
