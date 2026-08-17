/**
 * Provider-neutral completion interface.
 *
 * The reviewer and writer are written against this, so the same pipeline runs
 * on Anthropic or Gemini and the eval harness can A/B them on the gold set.
 * Deciding which model to ship is an evaluation question, not a taste one.
 */

/**
 * A block of system context. `cacheable` marks the end of the stable prefix:
 * everything up to and including the last cacheable block is identical across
 * requests and can be served from the provider's prompt cache.
 *
 * Anything request-specific (the essay under review) belongs in `messages`,
 * never here -- a single byte of variation in the prefix voids the cache.
 */
export interface SystemBlock {
  text: string;
  cacheable?: boolean;
}

export interface CompletionRequest {
  system: SystemBlock[];
  /** User-turn content. Varies per request; never cached. */
  userContent: string;
  maxTokens: number;
  /** JSON Schema the response must conform to. */
  jsonSchema?: Record<string, unknown>;
  /** Reasoning depth. Providers map this onto their own controls. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Set when sampling more than once, so providers can vary output. */
  sampleIndex?: number;
}

export interface CompletionUsage {
  /** Uncached input tokens, billed at the full rate. */
  inputTokens: number;
  /** Served from the prompt cache, billed at ~0.1x. */
  cachedInputTokens: number;
  /**
   * Written to the prompt cache, billed at ~1.25x.
   *
   * Tracked separately because it is neither free nor full price, and because
   * omitting it makes the input total look impossibly small: on a cold cache
   * almost the entire prefix lands here rather than in `inputTokens`.
   */
  cacheWriteTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: CompletionUsage;
  /** Present when the provider declined the request rather than answering. */
  refusal?: { category: string | null; explanation: string | null };
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/**
 * Note: fields are assigned explicitly rather than declared as constructor
 * parameter properties. Node runs these .ts files by stripping types, and
 * parameter properties are the one common syntax that emits code, so they
 * throw ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at import time. Same applies to
 * enums and namespaces -- avoid all three in this codebase.
 */
export class ProviderError extends Error {
  readonly provider: string;

  constructor(message: string, provider: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

/** Thrown when a required API key is absent, with the exact fix. */
export class MissingCredentialsError extends ProviderError {
  constructor(provider: string, envVar: string) {
    super(
      `No credentials for ${provider}. Set ${envVar} in the .env file at the ` +
        `repository root` +
        (provider === "anthropic"
          ? `, or run \`ant auth login\` once to store an OAuth profile the SDK picks up automatically.`
          : `.`),
      provider,
    );
    this.name = "MissingCredentialsError";
  }
}
