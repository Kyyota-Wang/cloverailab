import { AnthropicProvider } from "./anthropic.ts";
import { GeminiProvider } from "./gemini.ts";
import type { LLMProvider } from "./types.ts";

export * from "./types.ts";
export { AnthropicProvider } from "./anthropic.ts";
export { GeminiProvider } from "./gemini.ts";

/**
 * Kept as a no-op for call-site compatibility. Node entry points now get .env
 * by importing packages/agent/src/env-node.ts for its side effect; Workers
 * pass configuration explicitly via `createProvider({ env })`.
 */
export function loadEnv(): void {}

export interface ProviderOptions {
  /** Overrides LLM_PROVIDER. */
  provider?: string;
  /** Overrides the per-role model from the environment. */
  model?: string;
  role?: "reviewer" | "writer";
  /**
   * Explicit configuration, bypassing process.env entirely.
   *
   * Cloudflare Workers get their secrets from the platform binding rather
   * than from a .env file or process.env, so the Worker passes them here.
   */
  env?: {
    ANTHROPIC_API_KEY?: string | undefined;
    GEMINI_API_KEY?: string | undefined;
    LLM_PROVIDER?: string | undefined;
    REVIEWER_MODEL?: string | undefined;
    WRITER_MODEL?: string | undefined;
  };
}

const DEFAULT_MODELS = {
  anthropic: { reviewer: "claude-opus-5", writer: "claude-opus-5" },
  gemini: { reviewer: "gemini-2.5-pro", writer: "gemini-2.5-pro" },
} as const;

/**
 * Build a provider from the environment.
 *
 * Model resolution: explicit argument, then REVIEWER_MODEL / WRITER_MODEL,
 * then the provider default. The repository's .env sets the reviewer to
 * Sonnet on cost grounds -- that is a starting point to be settled by the
 * eval harness, not a conclusion.
 */
export function createProvider(options: ProviderOptions = {}): LLMProvider {
  // Only touch process.env when the caller has not supplied config. Workers
  // have no .env file and no meaningful process.env.
  const config = options.env ?? (globalThis.process?.env ?? {});

  const role = options.role ?? "reviewer";
  const name = (options.provider ?? config["LLM_PROVIDER"] ?? "anthropic").toLowerCase();
  const fromEnv = role === "reviewer" ? config["REVIEWER_MODEL"] : config["WRITER_MODEL"];

  switch (name) {
    case "anthropic":
      return new AnthropicProvider({
        model: options.model ?? fromEnv ?? DEFAULT_MODELS.anthropic[role],
        apiKey: config["ANTHROPIC_API_KEY"],
      });
    case "gemini":
      return new GeminiProvider({
        model: options.model ?? fromEnv ?? DEFAULT_MODELS.gemini[role],
        apiKey: config["GEMINI_API_KEY"],
      });
    default:
      throw new Error(`Unknown LLM_PROVIDER "${name}". Use "anthropic" or "gemini".`);
  }
}
