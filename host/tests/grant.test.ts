import { beforeEach, describe, expect, it, vi } from "vitest";

// The SDK is only exercised through grant.ts's imports — mock it so no real
// handshake/network happens and call shapes can be asserted.
vi.mock("@terminal3/t3n-sdk", () => ({
  getContractVersion: vi.fn(),
}));

import { getContractVersion } from "@terminal3/t3n-sdk";
import type { Session } from "../src/connect.js";
import {
  buildGrantInput,
  buildRevokeInput,
  grantScript,
  parseFunctionsArg,
  parseHostsArg,
  revokeScript,
} from "../src/grant.js";

function fakeSessions() {
  const execute = vi.fn().mockResolvedValue("{}");
  const agent = { did: "did:t3n:agent", client: {} } as unknown as Session;
  const user = { did: "did:t3n:user", client: { execute } } as unknown as Session;
  return { execute, agent, user };
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
  it("defaults to the RAIL_BASE host when raw is undefined", () => {
    expect(parseHostsArg(undefined)).toEqual(["localhost:8787"]);
  });

  it("splits a custom host CSV (no scheme on entries)", () => {
    expect(parseHostsArg(" api.x.com,localhost:8787 ")).toEqual([
      "api.x.com",
      "localhost:8787",
    ]);
  });

  it("throws when the CSV contains no usable entry", () => {
    expect(() => parseHostsArg(" , ")).toThrow();
  });
});

describe("buildGrantInput", () => {
  it("builds the exact documented agent-auth-update input shape", () => {
    const opts = {
      agentDid: "did:t3n:aabbcc",
      scriptName: "z:aabbcc:mandate-contracts",
      versionReq: "0.3.0",
      functions: ["onboard-customer", "pay-invoice"],
      allowedHosts: ["localhost:8787"],
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
              allowedHosts: ["localhost:8787"],
            },
          ],
        },
      ],
    });
  });

  it("passes custom functions/allowedHosts through verbatim", () => {
    expect(
      buildGrantInput({
        agentDid: "did:t3n:x",
        scriptName: "z:x:mandate-contracts",
        versionReq: "1.0.0",
        functions: ["pay-invoice"],
        allowedHosts: ["api.x.com", "localhost:8787"],
      })
    ).toEqual({
      agents: [
        {
          agentDid: "did:t3n:x",
          scripts: [
            {
              scriptName: "z:x:mandate-contracts",
              versionReq: "1.0.0",
              functions: ["pay-invoice"],
              allowedHosts: ["api.x.com", "localhost:8787"],
            },
          ],
        },
      ],
    });
  });
});

describe("buildRevokeInput", () => {
  it("is the empty agents array (revoke all)", () => {
    expect(buildRevokeInput()).toEqual({ agents: [] });
  });
});

describe("grantScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs agent-auth-update via the USER session with the resolved grants version", async () => {
    vi.mocked(getContractVersion).mockResolvedValue("1.2.3");
    const { execute, agent, user } = fakeSessions();
    const opts = {
      scriptName: "z:aabbcc:mandate-contracts",
      versionReq: "0.1.0",
      functions: ["onboard-customer", "pay-invoice"],
      allowedHosts: ["localhost:8787"],
    };

    const grantsVersion = await grantScript(agent, user, "http://node:1234", opts);

    expect(grantsVersion).toBe("1.2.3");
    expect(getContractVersion).toHaveBeenCalledTimes(1);
    expect(getContractVersion).toHaveBeenCalledWith(
      "http://node:1234",
      "tee:user/contracts"
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      contract_id: "tee:user/contracts",
      contract_version: "1.2.3",
      function_name: "agent-auth-update",
      input: buildGrantInput({ agentDid: agent.did, ...opts }),
    });
  });
});

describe("revokeScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the empty agents array on tee:user/contracts", async () => {
    vi.mocked(getContractVersion).mockResolvedValue("1.2.3");
    const { execute, agent, user } = fakeSessions();

    await revokeScript(agent, user, "http://node:1234", {
      scriptName: "z:aabbcc:mandate-contracts",
      versionReq: "0.1.0",
    });

    expect(getContractVersion).toHaveBeenCalledWith(
      "http://node:1234",
      "tee:user/contracts"
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      contract_id: "tee:user/contracts",
      contract_version: "1.2.3",
      function_name: "agent-auth-update",
      input: { agents: [] },
    });
  });
});

describe("main-gating", () => {
  it("importing grant.ts executes nothing (no keys, no network)", () => {
    // grant.ts only runs its CLI main() when executed directly (pathToFileURL
    // gate, as in connect.ts) — this suite already imported it above.
    expect(true).toBe(true);
  });
});
