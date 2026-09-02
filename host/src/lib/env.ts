import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Zero-dependency .env loader (no dotenv package needed).
 *
 * Reads KEY=VALUE lines from the given file into process.env, skipping blank
 * lines and `#` comments. Never overrides variables already exported in the
 * shell — those win. Supports optional surrounding single/double quotes.
 *
 * Default path is `../../.env` RELATIVE TO THIS FILE (host/.env, i.e. the
 * host package root) so scripts work regardless of the invoking cwd — this is
 * a deliberate change from the walkthrough loader, whose files sat at the app
 * root next to .env.
 */
export function loadEnv(path = "../../.env"): void {
  const envFile = resolve(dirname(fileURLToPath(import.meta.url)), path);
  if (!existsSync(envFile)) return;

  for (const rawLine of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
