import {
  MissingCredentialsError,
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type LLMProvider,
} from "./types.ts";

/**
 * Gemini adapter, over the REST API rather than a client library.
 *
 * The point of this adapter is the eval harness: the same reviewer pipeline
 * runs on both providers so the gold set decides which one ships, instead of
 * the decision being made on vibes. It is also the cheap loop for iterating on
 * prompts during development, since Gemini has a usable free tier.
 *
 * No prompt caching. Gemini's implicit caching is not something this code can
 * rely on, so `cachedInputTokens` is reported from the API's own
 * `cachedContentTokenCount` when present and 0 otherwise. Expect Gemini input
 * costs per review to look ~10x worse than Anthropic's cached figure; that is
 * a real difference, not a measurement artefact.
 */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

/** Gemini rejects several JSON Schema keywords the Anthropic path accepts. */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== "object") return schema;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "additionalProperties" || key === "$schema" || key === "const") continue;
    output[key] = toGeminiSchema(value);
  }
  return output;
}

const EFFORT_BUDGET: Record<NonNullable<CompletionRequest["effort"]>, number> = {
  low: 1024,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
  max: 24576,
};

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly model: string;
  #apiKey: string;

  constructor(options: { model: string; apiKey?: string | undefined }) {
    if (!options.apiKey) throw new MissingCredentialsError("gemini", "GEMINI_API_KEY");
    this.model = options.model;
    this.#apiKey = options.apiKey;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    // Gemini has one system field, so the cache-breakpoint distinction is
    // dropped here; block order is preserved.
    const systemText = request.system.map((block) => block.text).join("\n\n");

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: request.userContent }] }],
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        ...(request.jsonSchema
          ? {
              responseMimeType: "application/json",
              responseSchema: toGeminiSchema(request.jsonSchema),
            }
          : {}),
        ...(request.effort
          ? { thinkingConfig: { thinkingBudget: EFFORT_BUDGET[request.effort] } }
          : {}),
      },
    };

    let response: Response;
    try {
      response = await fetch(`${ENDPOINT}/${this.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.#apiKey },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new ProviderError(`Gemini request failed: ${String(cause)}`, this.name, { cause });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new MissingCredentialsError(this.name, "GEMINI_API_KEY");
      }
      throw new ProviderError(
        `Gemini API error ${response.status}: ${detail.slice(0, 400)}`,
        this.name,
      );
    }

    const payload = (await response.json()) as GeminiResponse;
    const usage = {
      inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
      cachedInputTokens: payload.usageMetadata?.cachedContentTokenCount ?? 0,
      cacheWriteTokens: 0, // Gemini does not expose an implicit-cache write count.
      outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
    };

    const blockReason = payload.promptFeedback?.blockReason;
    const finishReason = payload.candidates?.[0]?.finishReason;
    if (blockReason || finishReason === "SAFETY") {
      return {
        text: "",
        usage,
        refusal: { category: blockReason ?? finishReason ?? null, explanation: null },
      };
    }

    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");

    if (!text) {
      throw new ProviderError(
        `Empty response (finishReason: ${finishReason ?? "unknown"}). If this is ` +
          `"MAX_TOKENS", raise maxTokens -- it caps thinking and output together.`,
        this.name,
      );
    }

    return { text, usage };
  }
}
