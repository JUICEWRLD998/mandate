/**
 * mock-rail/src/server.ts — bootstrap that listens on RAIL_PORT.
 *
 * This rail is the EGRESS TARGET of the z-mandate contract: the host's
 * RAIL_BASE constant is http://localhost:8787, so the delegation grant's
 * allowedHosts MUST name localhost:8787 for the mandate to be honored.
 * Defaults here mirror that contract (RAIL_PORT ?? 8787); tests and the
 * CLI may override via RAIL_PORT or opts.port (0 = ephemeral).
 *
 * Importing this module has NO side effects: nothing listens until
 * startRail() or main() is called (main() is gated on direct execution).
 */
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

import { createRailApp } from "./app.js";
import { createRailLogger, type RailLogger } from "./rail-log.js";

export interface StartRailOptions {
  /** Listen port. Defaults to Number(process.env.RAIL_PORT ?? 8787). 0 = ephemeral. */
  port?: number;
  /** Request logger. Defaults to createRailLogger() (rail.log + console). */
  logger?: RailLogger;
}

export interface StartedRail {
  /** The real bound port — the OS-assigned port when 0 was requested. */
  port: number;
  /** Stops the server and resolves once closed. */
  close: () => Promise<void>;
}

/**
 * Start the mock rail on the configured port (RAIL_PORT env ?? 8787, or
 * opts.port). When opts.port is 0 the OS assigns an ephemeral port, and
 * the returned `port` is that real bound port.
 */
export async function startRail(opts: StartRailOptions = {}): Promise<StartedRail> {
  const port = opts.port ?? Number(process.env.RAIL_PORT ?? 8787);
  const logger = opts.logger ?? createRailLogger();
  const app = createRailApp(logger);
  const server = app.listen(port);
  await once(server, "listening");
  const actualPort = (server.address() as AddressInfo).port;
  const close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  return { port: actualPort, close };
}

/**
 * CLI entrypoint: `npx tsx src/server.ts`. Listens on RAIL_PORT (default
 * 8787) and shuts down cleanly on SIGINT/SIGTERM.
 */
export async function main(): Promise<void> {
  const { port, close } = await startRail();
  console.log(
    `mock money rail listening on http://localhost:${port} (RAIL_PORT) — endpoints: GET /health, POST /kyc, POST /pay`
  );
  const shutdown = async (): Promise<void> => {
    await close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
