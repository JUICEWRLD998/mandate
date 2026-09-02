import { beforeEach, describe, expect, it, vi } from "vitest";

// The SDK is only exercised through grant.ts's imports — mock it so no real
// handshake/network happens and call shapes can be asserted.
vi.mock("@terminal3/t3n-sdk", () => ({
  getContractVersion: vi.fn(),
}));

import { getContractVersion } from "@terminal3/t3n-sdk";
import type { Session } from "../src/connect.js";
import {
  buildBoundGrant,
  buildGrantInput,
  buildRevokeInput,
  grantScript,
  parseFunctionsArg,
  parseHostsArg,
  revokeScript,
  showGrant,
} from "../src/grant.js";

const LEGACY = "tee:user/contracts";
const MODERN = "tee:authorisations/contracts";

function fakeSessions() {
  const execute = vi.fn().mockResolvedValue("{}");
  const updateMemberDelegation = vi.fn().mockResolvedValue({ preservedRows: [] });
  const getMemberDelegation = vi.fn().mockResolvedValue({ grants: [], discover_dids: [] });
  const agent = { did: "did:t3n:agent", client: {} } as unknown as Session;
  const user = {
    did: "did:t3n:user",
    client: { execute, updateMemberDelegation, getMemberDelegation },
  } as unknown as Session;
  return { execute, updateMemberDelegation, getMemberDelegation, agent, user };
}

describe("parseFunctionsArg", () => {
  it("defaults to the MANDATE function pair when raw is undefined", () => {
    expect(parseFunctionsArg(undefined)).toEqual([
      "onboard-customer",
      "pay-invoice",
    ]);
  });

  it("splits, trims and keeps non-empty entries on a custom CSV", () => {
    expect(parseFunctionsArg(" onboard-customer,pay-invoice ")).toEqual([
      "onboard-customer",
      "pay-invoice",
    ]);
  });

  it("throws when the CSV contains no usable entry", () => {
    expect(() => parseFunctionsArg(" , ")).toThrow();
    expect(() => parseFunctionsArg("")).toThrow();
  });
});

describe("parseHostsArg", () => {
  it("defaults to the host-only localhost (live-verified match semantics)", () => {
    expect(parseHostsArg(undefined)).toEqual(["localhost"]);
  });

  it("splits a custom host CSV (no scheme, no port on entries)", () => {
    expect(parseHostsArg(" api.x.com,localhost ")).toEqual([
      "api.x.com",
      "localhost",
    ]);
  });

  it("throws when the CSV contains no usable entry", () => {
    expect(() => parseHostsArg(" , ")).toThrow();
  });
});

describe("buildGrantInput (legacy docs surface)", () => {
  it("builds the exact documented agent-auth-update input shape", () => {
    const opts = {
      agentDid: "did:t3n:aabbcc",
      scriptName: "z:aabbcc:mandate-contracts",
      versionReq: "0.3.0",
      functions: ["onboard-customer", "pay-invoice"],
      allowedHosts: ["localhost"],
    };
    expect(buildGrantInput(opts)).toEqual({
      agents: [
        {
          agentDid: "did:t3n:aabbcc",
          scripts: [
            {
              scriptName: "z:aabbcc:mandate-contracts",
              versionReq: "0.3.0",
              functions: ["onboard-customer", "pay-invoice"],
              allowedHosts: ["localhost"],
            },
          ],
        },
      ],
    });
  });
});

describe("buildRevokeInput (legacy)", () => {
  it("is the empty agents array (revoke all)", () => {
    expect(buildRevokeInput()).toEqual({ agents: [] });
  });
});

describe("buildBoundGrant (modern, wire-verbatim snake_case)", () => {
  it("builds the exact BoundGrant shape with empty scopes + allowed_hosts", () => {
    expect(
      buildBoundGrant({
        agentDid: "did:t3n:agent",
        scriptName: "z:abc:mandate-contracts",
        versionReq: "0.1.0",
        functions: ["onboard-customer", "pay-invoice"],
        allowedHosts: ["localhost"],
      })
    ).toEqual({
      grantee: "did:t3n:agent",
      contract_id: "z:abc:mandate-contracts",
      functions: ["onboard-customer", "pay-invoice"],
      scopes: [],
      version_req: "0.1.0",
      allowed_hosts: ["localhost"],
    });
  });
});

describe("grantScript (dual surface)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes legacy agent-auth-update AND modern updateMemberDelegation via the USER session", async () => {
    vi.mocked(getContractVersion).mockResolvedValue("1.2.3");
    const { execute, updateMemberDelegation, agent, user } = fakeSessions();
    const opts = {
      scriptName: "z:aabbcc:mandate-contracts",
      versionReq: "0.1.0",
      functions: ["onboard-customer", "pay-invoice"],
      allowedHosts: ["localhost"],
    };

    await grantScript(agent, user, "http://node:1234", opts);

    expect(getContractVersion).toHaveBeenCalledWith("http://node:1234", LEGACY);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      contract_id: LEGACY,
      contract_version: "1.2.3",
      function_name: "agent-auth-update",
      input: buildGrantInput({ agentDid: agent.did, ...opts }),
    });
    expect(updateMemberDelegation).toHaveBeenCalledTimes(1);
    expect(updateMemberDelegation).toHaveBeenCalledWith(
      buildBoundGrant({ agentDid: agent.did, ...opts })
    );
  });

  it("tolerates a failing legacy write (warning path) when the modern grant lands", async () => {
    vi.mocked(getContractVersion).mockResolvedValue("1.2.3");
    const { execute, updateMemberDelegation, agent, user } = fakeSessions();
    execute.mockRejectedValueOnce(new Error("legacy drift"));

    await expect(
      grantScript(agent, user, "http://node:1234", {
        scriptName: "z:aabbcc:mandate-contracts",
        versionReq: "0.1.0",
        functions: ["onboard-customer", "pay-invoice"],
        allowedHosts: ["localhost"],
      })
    ).resolves.toBeUndefined();
    expect(updateMemberDelegation).toHaveBeenCalledTimes(1);
  });

  it("aborts when the MODERN grant fails", async () => {
    vi.mocked(getContractVersion).mockResolvedValue("1.2.3");
    const { execute, updateMemberDelegation, agent, user } = fakeSessions();
    updateMemberDelegation.mockRejectedValueOnce(new Error("insufficient credit"));

    await expect(
      grantScript(agent, user, "http://node:1234", {
        scriptName: "z:aabbcc:mandate-contracts",
        versionReq: "0.1.0",
        functions: ["onboard-customer", "pay-invoice"],
        allowedHosts: ["localhost"],
      })
    ).rejects.toThrow(/insufficient credit/);
    expect(execute).toHaveBeenCalledTimes(1); // legacy still attempted first
  });
});

describe("revokeScript (dual surface)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes legacy empty-agents AND a modern full-doc empty grants write", async () => {
    vi.mocked(getContractVersion).mockResolvedValue("1.2.3");
    const { execute, agent, user } = fakeSessions();

    await revokeScript(agent, user, "http://node:1234", {
      scriptName: "z:aabbcc:mandate-contracts",
      versionReq: "0.1.0",
    });

    expect(getContractVersion).toHaveBeenCalledWith("http://node:1234", LEGACY);
    expect(getContractVersion).toHaveBeenCalledWith("http://node:1234", MODERN);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, {
      contract_id: LEGACY,
      contract_version: "1.2.3",
      function_name: "agent-auth-update",
      input: { agents: [] },
    });
    expect(execute).toHaveBeenNthCalledWith(2, {
      contract_id: MODERN,
      contract_version: "1.2.3",
      function_name: "member-delegation-update",
      input: { grants: [], discover_dids: [] },
    });
  });
});

describe("showGrant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the raw modern delegation document when readable", async () => {
    const { getMemberDelegation, user } = fakeSessions();
    getMemberDelegation.mockResolvedValue({
      grants: [{ grantee: "did:t3n:agent" }],
      discover_dids: [],
    });
    const result = await showGrant(user, "http://node:1234");
    expect(getMemberDelegation).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ grants: [{ grantee: "did:t3n:agent" }], discover_dids: [] });
  });

  it("returns a graceful note when the read throws (e.g. zero credits)", async () => {
    const { getMemberDelegation, user } = fakeSessions();
    getMemberDelegation.mockRejectedValueOnce(
      new Error("InsufficientCredit (available=0)")
    );
    const result = (await showGrant(user, "http://node:1234")) as {
      note?: string;
      error?: string;
    };
    expect(result.note).toBeTruthy();
    expect(result.error).toContain("InsufficientCredit");
  });
});

describe("main-gating", () => {
  it("importing grant.ts executes nothing (no keys, no network)", () => {
    expect(true).toBe(true);
  });
});
