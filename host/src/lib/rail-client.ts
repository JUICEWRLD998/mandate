/**
 * Thin client for the mock money rail (Phase 4, Express on :8787).
 * Phase 3 needs only the health probe (demo preflight); /kyc + /pay are
 * reached by the CONTRACT inside the enclave (http-with-placeholders), never
 * by this host — the host must not be able to call the rail with real data.
 */

/** RAIL_URL from the environment (host/.env), default the Phase 4 port. */
export function railUrl(): string {
  return process.env.RAIL_URL ?? "http://localhost:8787";
}

export interface RailHealth {
  ok: boolean;
  url: string;
  /** HTTP status when the rail answered; undefined on network error. */
  status?: number;
  error?: string;
}

/** GET {RAIL_URL}/health with a 3s timeout. Never throws. */
export async function checkRailHealth(
  baseUrl: string = railUrl()
): Promise<RailHealth> {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return { ok: false, url: baseUrl, status: res.status };
    }
    return { ok: true, url: baseUrl, status: res.status };
  } catch (err) {
    return {
      ok: false,
      url: baseUrl,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
