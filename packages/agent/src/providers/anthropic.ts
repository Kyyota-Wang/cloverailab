import Anthropic from "@anthropic-ai/sdk";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import {
  MissingCredentialsError,
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type LLMProvider,
} from "./types.ts";

/**
 * Anthropic adapter.
 *
 * Three things here are load-bearing and easy to break:
 *
 *  1. Prompt caching. `cache_control` goes on the last cacheable system block.
 *     The reviewer's rubric + anchors run ~9k tokens and are byte-identical
 *     across every request, so this is roughly a 10x saving on input cost.
 *     Any variation in the system prefix (a timestamp, a per-user id) silently
 *     voids it -- check `cachedInputTokens` in the usage if costs look wrong.
 *
 *  2. No sampling parameters. temperature/top_p/top_k are rejected with a 400
 *     on current models. Self-consistency relies on the models' own sampling
 *     variance across repeated identical calls, which is why `sampleIndex`
 *     deliberately does not alter the request.
 *
 *  3. `stop_reason: "refusal"` arrives as a normal HTTP 200 with empty or
 *     partial content. Reading `content[0]` without checking it first throws
 *     on an essay that happens to trip a safety classifier.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  #client: Anthropic;

  constructor(options: { model: string; apiKey?: string | undefined }) {
    this.model = options.model;
    // A bare constructor also resolves an `ant auth login` OAuth profile, so
    // an unset ANTHROPIC_API_KEY is not by itself an error.
    this.#client = options.apiKey
      ? new Anthropic({ apiKey: options.apiKey })
      : new Anthropic();
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const system: TextBlockParam[] = request.system.map((block) => ({
      type: "text",
      text: block.text,
      ...(block.cacheable ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

    try {
      const response = await this.#client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens,
        system,
        messages: [{ role: "user", content: request.userContent }],
        thinking: { type: "adaptive" },
        output_config: {
          ...(request.effort ? { effort: request.effort } : {}),
          ...(request.jsonSchema
            ? { format: { type: "json_schema" as const, schema: request.jsonSchema } }
            : {}),
        },
      });

      const usage = {
        inputTokens: response.usage.input_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        outputTokens: response.usage.output_tokens,
      };

      if (response.stop_reason === "refusal") {
        return {
          text: "",
          usage,
          refusal: {
            category: response.stop_details?.category ?? null,
            explanation: response.stop_details?.explanation ?? null,
          },
        };
      }

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      if (!text) {
        throw new ProviderError(
          `Empty response (stop_reason: ${response.stop_reason}). If this is ` +
            `"max_tokens", raise maxTokens -- it caps thinking and output together.`,
          this.name,
        );
      }

      return { text, usage };
    } catch (cause) {
      if (cause instanceof ProviderError) throw cause;
      // The SDK reports a missing key as a plain Error from its credential
      // resolver, not as an AuthenticationError, so both paths are checked.
      if (
        cause instanceof Anthropic.AuthenticationError ||
        (cause instanceof Error && /resolve authentication method/i.test(cause.message))
      ) {
        throw new MissingCredentialsError(this.name, "ANTHROPIC_API_KEY");
      }
      if (cause instanceof Anthropic.RateLimitError) {
        throw new ProviderError("Rate limited by the Anthropic API.", this.name, { cause });
      }
      if (cause instanceof Anthropic.APIError) {
        throw new ProviderError(`Anthropic API error: ${cause.message}`, this.name, { cause });
      }
      throw new ProviderError(`Anthropic request failed: ${String(cause)}`, this.name, { cause });
    }
  }
}
