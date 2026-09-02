//! kyc.rs — `onboard-customer` for z-mandate (Phase 2, placeholder stub).
//!
//! NOTE: this file is a BUILDING STUB committed with the shared foundation so
//! the crate compiles natively and to wasm32-wasip2 before the implementation
//! subagent lands the real module. Contract of the real module:
//!   - entry `pub fn onboard_customer(input: &[u8]) -> Result<Vec<u8>, String>`
//!     (kept; lib.rs dispatch depends on it)
//!   - marker strategy, size guards, scrub rules, test list: see lib.rs doc
//!     comments (Decision D1) + implementation.md Phase 2 checklist.

pub fn onboard_customer(
    input: &[u8],
) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
    let _ = input;
    Err("kyc::onboard_customer is only implemented on the wasm32 target".to_string())
}
