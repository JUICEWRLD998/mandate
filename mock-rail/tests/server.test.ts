/**
 * mock-rail/tests/server.test.ts — bootstrap tests for startRail/main gating.
 *
 * Real HTTP only, on ephemeral ports (port: 0) — never on the default 8787
 * (which the orchestrator's smoke test binds after merge). Every started
 * server is closed by afterEach so vitest never leaks sockets or hangs.
 */
import { afterEach, describe, expect, it } from "vitest";

import { silentRailLogger } from "../src/rail-log.js";
import { startRail } from "../src/server.js";

type StartedRail = Awaited<ReturnType<typeof startRail>>;

/** Rails created by the current test, closed by afterEach in reverse order. */
const openRails: StartedRail[] = [];

afterEach(async () => {
  while (openRails.length > 0) {
    const rail = openRails.pop();
    if (rail) await rail.close();
  }
});

describe("startRail", () => {
  it("listens on an ephemeral port and GET /health returns 200 { ok: true }", async () => {
    const rail = await startRail({ port: 0, logger: silentRailLogger() });
    openRails.push(rail);
    expect(rail.port).toBeGreaterThan(0);
    const res = await fetch(`http://localhost:${rail.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns distinct ports for two independent servers", async () => {
    const first = await startRail({ port: 0, logger: silentRailLogger() });
    openRails.push(first);
    const second = await startRail({ port: 0, logger: silentRailLogger() });
    openRails.push(second);
    expect(first.port).toBeGreaterThan(0);
    expect(second.port).toBeGreaterThan(0);
    expect(second.port).not.toBe(first.port);
    // both are independently reachable while open
    const res = await fetch(`http://localhost:${second.port}/health`);
    expect(res.status).toBe(200);
  });

  it("honors RAIL_PORT env when opts.port is undefined", async () => {
    process.env.RAIL_PORT = "0";
    try {
      const rail = await startRail({ logger: silentRailLogger() });
      openRails.push(rail);
      expect(rail.port).toBeGreaterThan(0);
    } finally {
      delete process.env.RAIL_PORT;
    }
  });
});

describe("main gating", () => {
  it("importing server.ts does not listen on anything", async () => {
    // Static import at module top already succeeded (no throw) — main() must
    // not have run, so nothing may be listening on the default RAIL_PORT 8787.
    expect(typeof startRail).toBe("function");
    await expect(
      fetch("http://localhost:8787/health", { signal: AbortSignal.timeout(2000) })
    ).rejects.toThrow();
  });
});
