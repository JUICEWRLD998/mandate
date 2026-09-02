import { describe, expect, it, vi } from "vitest";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TenantClient } from "@terminal3/t3n-sdk";
import {
  CONTRACT_VERSION,
  ensureSecretsMap,
  readContractWasm,
  registerContract,
  resolveWasmPath,
  seedRailApiKey,
} from "../src/register.js";

/** Scratch file under the OS tmpdir; always cleaned up in a finally. */
function tmpWasmFile(tag: string, bytes: Uint8Array): string {
  const file = join(tmpdir(), `register-${tag}-${process.pid}-${Date.now()}.wasm`);
  writeFileSync(file, bytes);
  return file;
}

describe("register.ts", () => {
  it("module imports cleanly (gated main runs nothing on import)", () => {
    expect(CONTRACT_VERSION).toBe("0.1.0");
  });

  describe("resolveWasmPath", () => {
    it("resolves the phase-2 component build relative to this file", () => {
      const path = resolveWasmPath();
      expect(path.endsWith("z_mandate.wasm")).toBe(true);
      expect(path).toContain("/contract/target/wasm32-wasip2/release/");
    });

    it("honours the WASM_PATH env override and cleans up after itself", () => {
      process.env.WASM_PATH = "C:/scratch/override/z_mandate.wasm";
      try {
        expect(resolveWasmPath()).toBe("C:/scratch/override/z_mandate.wasm");
      } finally {
        delete process.env.WASM_PATH;
      }
      // Back to the default once the override is gone.
      expect(resolveWasmPath()).not.toBe("C:/scratch/override/z_mandate.wasm");
    });
  });

  describe("readContractWasm", () => {
    it("accepts a real wasm-magic stub and returns its bytes", () => {
      const magic = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
      const file = tmpWasmFile("magic", magic);
      try {
        const bytes = readContractWasm(file);
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(Array.from(bytes)).toEqual(Array.from(magic));
      } finally {
        unlinkSync(file);
      }
    });

    it("rejects an empty file as not a wasm component", () => {
      const file = tmpWasmFile("empty", new Uint8Array(0));
      try {
        expect(() => readContractWasm(file)).toThrow(
          /not a wasm component/
        );
      } finally {
        unlinkSync(file);
      }
    });

    it("rejects non-magic bytes as not a wasm component", () => {
      const file = tmpWasmFile("nonmagic", new Uint8Array([1, 2, 3, 4, 5, 6]));
      try {
        expect(() => readContractWasm(file)).toThrow(
          /not a wasm component/
        );
      } finally {
        unlinkSync(file);
      }
    });
  });

  describe("registerContract", () => {
    it("calls tenant.contracts.register with {tail, version, wasm} and normalises the result", async () => {
      const register = vi.fn().mockResolvedValue({
        contract_id: 901,
        name: "z:abc:mandate-contracts",
      });
      const tenant = { contracts: { register } } as unknown as TenantClient;
      const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

      const result = await registerContract(tenant, {
        tail: "mandate-contracts",
        version: "0.1.0",
        wasm,
      });

      expect(register).toHaveBeenCalledWith({
        tail: "mandate-contracts",
        version: "0.1.0",
        wasm,
      });
      expect(result).toEqual({
        contract_id: 901,
        name: "z:abc:mandate-contracts",
      });
      expect(typeof result.contract_id).toBe("number");
      expect(typeof result.name).toBe("string");
    });
  });

  describe("ensureSecretsMap", () => {
    it("creates the map with readers AND writers {only:[contractId]} both set", async () => {
      const create = vi.fn().mockResolvedValue({});
      const tenant = { maps: { create } } as unknown as TenantClient;

      await expect(ensureSecretsMap(tenant, 42)).resolves.toBe("created");

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        tail: "secrets",
        visibility: "private",
        writers: { only: [42] },
        readers: { only: [42] },
      });
    });

    it("re-points the ACL when the map already exists (re-registration)", async () => {
      const create = vi
        .fn()
        .mockRejectedValue(new Error("map already exists (idempotent)"));
      const update = vi.fn().mockResolvedValue({});
      const tenant = { maps: { create, update } } as unknown as TenantClient;

      await expect(ensureSecretsMap(tenant, 42)).resolves.toBe("updated");
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith("secrets", {
        writers: { only: [42] },
        readers: { only: [42] },
      });
    });

    it("reports 'stale' when the existing map's ACL re-point fails", async () => {
      const create = vi
        .fn()
        .mockRejectedValue(new Error("map already exists (idempotent)"));
      const update = vi
        .fn()
        .mockRejectedValue(new Error("access denied: caller cannot update map"));
      const tenant = { maps: { create, update } } as unknown as TenantClient;

      await expect(ensureSecretsMap(tenant, 42)).resolves.toBe("stale");
    });

    it("rethrows errors that are not 'map already exists'", async () => {
      const create = vi.fn().mockRejectedValue(new Error("boom"));
      const tenant = { maps: { create } } as unknown as TenantClient;

      await expect(ensureSecretsMap(tenant, 42)).rejects.toThrow("boom");
    });
  });

  describe("seedRailApiKey", () => {
    it("seeds via executeControl with the canonical secrets map_name + rail_api_key key", async () => {
      const executeControl = vi.fn().mockResolvedValue(undefined);
      const tenant = {
        canonicalName: (t: string) => "z:deadbeef:" + t,
        executeControl,
      } as unknown as TenantClient;

      await seedRailApiKey(tenant, "sk-rail-live-123");

      expect(executeControl).toHaveBeenCalledTimes(1);
      expect(executeControl).toHaveBeenCalledWith("map-entry-set", {
        map_name: "z:deadbeef:secrets",
        key: "rail_api_key",
        value: "sk-rail-live-123",
      });
    });
  });
});
