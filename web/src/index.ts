/**
 * The Cloudflare Worker: static assets plus four JSON endpoints.
 *
 * Design notes that matter:
 *
 * - `/api/precheck` costs nothing and returns instantly. The reviewer's
 *   deterministic layer runs with no model call, so the UI can show real
 *   analysis while the 60-90 second scoring request is still in flight. This
 *   is the difference between a usable demo and a spinner.
 *
 * - Secrets come from the Worker's env binding, never from a .env file. The
 *   agents accept them through `createProvider({ env })`.
 *
 * - There is no persistence. Follow-up questions carry their own context from
 *   the client. That keeps the MVP to one moving part; a real deployment
 *   would want D1 for submissions and KV for caching identical essays.
 */

import "./kb.ts";
import { resolvePrompt, kb } from "../../packages/agent/src/kb.ts";
import { createProvider } from "../../packages/agent/src/providers/index.ts";
import { review } from "../../packages/agent/src/reviewer/index.ts";
import { precheck, formatPrecheck } from "../../packages/agent/src/reviewer/precheck.ts";
import { write } from "../../packages/agent/src/writer/index.ts";
import type { TaskVariant } from "../../packages/agent/src/types.ts";

/** Cloudflare's Rate Limiting binding. Edge-local and eventually consistent. */
interface RateLimiter {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  LLM_PROVIDER?: string;
  REVIEWER_MODEL?: string;
  WRITER_MODEL?: string;

  /** Public Turnstile site key. Served to the client by /api/config. */
  TURNSTILE_SITE_KEY?: string;
  /** Turnstile secret. Set with `wrangler secret put`, never in config. */
  TURNSTILE_SECRET?: string;
  /**
   * "true" in production. When set, a missing secret is a hard failure rather
   * than a silent bypass -- the one failure mode that would leave the paid
   * endpoints open without anything looking wrong.
   */
  REQUIRE_TURNSTILE?: string;

  /** review + write: the endpoints that cost about $0.15 per call. */
  PAID_LIMIT?: RateLimiter;
  /** chat, precheck, resolve: cheap or free, but still worth a ceiling. */
  LIGHT_LIMIT?: RateLimiter;
}

/**
 * The client's address, for rate limiting.
 *
 * CF-Connecting-IP is set by Cloudflare's edge and cannot be spoofed by the
 * client. Falling back to a constant means a missing header degrades to one
 * shared bucket rather than to no limit at all.
 */
function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

interface TurnstileVerdict {
  success: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
}

/**
 * Verify a Turnstile token server side.
 *
 * Rendering the widget proves nothing on its own -- the check that matters is
 * this one. Beyond `success` it also pins `action` and `hostname`, so a token
 * minted for a different endpoint, or solved on someone else's copy of the
 * page, is rejected. Tokens are single use; the client fetches a fresh one per
 * request.
 */
async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string,
  expectedAction: string,
  expectedHostname: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip !== "unknown") form.append("remoteip", ip);

  let verdict: TurnstileVerdict;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    verdict = (await res.json()) as TurnstileVerdict;
  } catch {
    return { ok: false, reason: "Could not reach the verification service. Try again." };
  }

  if (!verdict.success) {
    return { ok: false, reason: "Verification failed. Reload the page and try again." };
  }
  if (verdict.action && verdict.action !== expectedAction) {
    return { ok: false, reason: "Verification did not match this request." };
  }
  if (verdict.hostname && verdict.hostname !== expectedHostname) {
    return { ok: false, reason: "Verification came from a different site." };
  }
  return { ok: true };
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const fail = (message: string, status = 400): Response => json({ error: message }, status);

/** Approximate spend for a request, so the UI can show what a demo costs. */
function estimateCost(usage: {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}): number {
  // Sonnet 5 list rates. Close enough to be useful, not an invoice.
  const IN = 3 / 1e6;
  const OUT = 15 / 1e6;
  return (
    usage.inputTokens * IN +
    usage.cacheWriteTokens * IN * 1.25 +
    usage.cachedInputTokens * IN * 0.1 +
    usage.outputTokens * OUT
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // The public half of the Turnstile configuration. Site keys are public by
    // design -- they appear in the page source either way -- so serving it
    // here just means the key lives in one place instead of in a build.
    if (url.pathname === "/api/config") {
      return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null });
    }

    if (url.pathname === "/api/topics") {
      // Statement trimmed for the picker; the client sends the id back.
      return json({
        topics: kb().pool.topics.map((t) => ({
          id: t.id,
          statement: t.statement,
          instruction: t.instruction,
          variant: t.variant,
          variantSummary: t.variant_summary,
          requiredMoves: t.required_moves,
        })),
        variantCounts: kb().pool.variant_counts,
      });
    }

    if (request.method !== "POST") return fail("Use POST.", 405);

    let body: Record<string, any>;
    try {
      body = await request.json();
    } catch {
      return fail("Body must be JSON.");
    }

    const providerEnv = {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GEMINI_API_KEY: env.GEMINI_API_KEY,
      LLM_PROVIDER: env.LLM_PROVIDER,
      REVIEWER_MODEL: env.REVIEWER_MODEL,
      WRITER_MODEL: env.WRITER_MODEL,
    };

    // ---- Abuse and cost controls -----------------------------------------
    //
    // Both run before the provider is touched. /api/review and /api/write cost
    // roughly $0.15 each and take no credentials, so an unprotected public URL
    // is an open tap on the API budget.
    //
    // The order is deliberate: rate limiting first, because it is local and
    // free, and Turnstile second, because it costs a round trip.

    const PAID = new Set(["/api/review", "/api/write"]);
    const GUARDED = new Set(["/api/review", "/api/write", "/api/chat"]);
    const paid = PAID.has(url.pathname);
    const ip = clientIp(request);

    const limiter = paid ? env.PAID_LIMIT : env.LIGHT_LIMIT;
    if (limiter) {
      const { success } = await limiter.limit({ key: `${url.pathname}:${ip}` });
      if (!success) {
        return fail(
          paid
            ? "Too many scoring requests from this address. Each one takes about a minute and costs real money, so they are limited. Wait a minute and try again."
            : "Too many requests from this address. Wait a minute and try again.",
          429,
        );
      }
    }

    if (GUARDED.has(url.pathname)) {
      const requireTurnstile = env.REQUIRE_TURNSTILE === "true";
      const secret = env.TURNSTILE_SECRET;

      // Fail closed. A production deploy that lost its secret must break
      // loudly rather than quietly serve an unprotected paid endpoint.
      if (requireTurnstile && !secret) {
        return fail("This deployment is missing its abuse-protection secret.", 500);
      }

      if (secret) {
        const token = String(body["turnstileToken"] ?? "");
        if (!token) {
          return fail("Missing verification. Reload the page and try again.", 403);
        }
        const action = url.pathname.slice("/api/".length);
        const verdict = await verifyTurnstile(token, secret, ip, action, url.hostname);
        if (!verdict.ok) return fail(verdict.reason, 403);
      }
    }

    try {
      // Free and instant. Lets the UI confirm what a pasted task instruction
      // was understood as *before* the user pays for a generation, and fail
      // immediately with a usable message when it cannot be classified.
      if (url.pathname === "/api/resolve") {
        const prompt = resolvePrompt({
          statement: String(body["statement"] ?? ""),
          ...(body["instruction"] ? { instruction: String(body["instruction"]) } : {}),
          ...(body["variant"] ? { variant: body["variant"] as TaskVariant } : {}),
        });
        const summary = kb().pool.topics.find((t) => t.variant === prompt.variant);
        return json({ prompt, variantSummary: summary?.variant_summary ?? "" });
      }

      // Instant, free, no model call. The UI shows this while scoring runs.
      if (url.pathname === "/api/precheck") {
        const prompt = resolvePrompt({
          statement: String(body["statement"] ?? ""),
          ...(body["instruction"] ? { instruction: String(body["instruction"]) } : {}),
          ...(body["variant"] ? { variant: body["variant"] as TaskVariant } : {}),
        });
        const signals = precheck(String(body["essay"] ?? ""), prompt);
        return json({ precheck: signals, formatted: formatPrecheck(signals), prompt });
      }

      if (url.pathname === "/api/review") {
        const result = await review({
          essay: String(body["essay"] ?? ""),
          statement: String(body["statement"] ?? ""),
          ...(body["instruction"] ? { instruction: String(body["instruction"]) } : {}),
          ...(body["variant"] ? { variant: body["variant"] as TaskVariant } : {}),
          ...(body["effort"] ? { effort: body["effort"] } : {}),
          provider: createProvider({ role: "reviewer", env: providerEnv }),
        });
        return json({ ...result, estimatedCostUsd: estimateCost(result.usage) });
      }

      if (url.pathname === "/api/write") {
        const result = await write({
          statement: String(body["statement"] ?? ""),
          ...(body["instruction"] ? { instruction: String(body["instruction"]) } : {}),
          ...(body["variant"] ? { variant: body["variant"] as TaskVariant } : {}),
          ...(body["targetScore"] ? { targetScore: Number(body["targetScore"]) } : {}),
          ...(body["guidance"] ? { guidance: String(body["guidance"]) } : {}),
          ...(body["effort"] ? { effort: body["effort"] } : {}),
          provider: createProvider({ role: "writer", env: providerEnv }),
        });
        return json({ ...result, estimatedCostUsd: estimateCost(result.usage) });
      }

      // Follow-up questions about a result already on screen.
      //
      // Deliberately does NOT load the anchors or the rubric: the context is
      // just the essay and the review being discussed, which makes a follow-up
      // roughly 20x cheaper than the review that produced it.
      if (url.pathname === "/api/chat") {
        const provider = createProvider({ role: "reviewer", env: providerEnv });
        const context = String(body["context"] ?? "");
        const question = String(body["question"] ?? "");
        if (!question) return fail("No question given.");

        const result = await provider.complete({
          system: [
            {
              text:
                "You are discussing a GRE Analytical Writing assessment you have already produced, with the person who requested it. Answer from the material below. Be specific and quote it where that helps. If the question asks about something the material does not cover, say so rather than inventing an answer.\n\n" +
                context,
            },
          ],
          userContent: question,
          maxTokens: 4000,
          effort: "low",
        });

        return json({
          answer: result.text,
          usage: result.usage,
          estimatedCostUsd: estimateCost(result.usage),
        });
      }

      return fail("Unknown endpoint.", 404);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // Missing credentials and unresolvable prompts are user-fixable, so the
      // message goes through verbatim rather than being flattened to a 500.
      return fail(message, /credential|API key|task variant|targetScore/i.test(message) ? 400 : 500);
    }
  },
};
