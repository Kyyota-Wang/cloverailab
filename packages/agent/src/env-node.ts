/**
 * Node-side .env loading.
 *
 * Import this for its side effect from any Node entry point; it reads the
 * repository's .env into process.env. Existing environment variables win, so
 * a shell export or CI variable overrides the file.
 *
 * This lives apart from providers/index.ts for the same reason kb-node.ts
 * does: that module is bundled into the Cloudflare Worker, where
 * `import.meta.url` is undefined and `node:fs` does not resolve. Touching
 * either at module scope crashes the Worker before it serves a request.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env");

try {
  const contents = readFileSync(ENV_FILE, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    const value = match[2]!.trim().replace(/^["']|["']$/g, "");
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // No .env is fine: the key may come from the shell or an OAuth profile.
}
