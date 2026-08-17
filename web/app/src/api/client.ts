import { getToken } from "./turnstile";
import type {
  ChatResponse,
  ConfigResponse,
  PrecheckResponse,
  ResolveResponse,
  ReviewResponse,
  TopicsResponse,
  WriteResponse,
} from "./types";

/**
 * The Worker answers errors as `{ error: "human-readable English" }`, and the
 * wording is deliberately written to be shown to a person: 400 means the user
 * can fix it themselves (missing key, unrecognisable instruction, bad target
 * score), 500 means the backend broke. So the message goes through verbatim and
 * the status is kept for the UI to decide how alarming to look.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** True when the user can plausibly fix this themselves. */
  get userFixable(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("Could not reach the server. Is it still running?", 0);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`The server returned a non-JSON response (${res.status}).`, res.status);
  }

  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status}).`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

/**
 * A guarded request: mint a fresh Turnstile token for this endpoint, then send.
 *
 * The token goes in the body rather than a header so it travels with the same
 * JSON the Worker already parses, and the action is the endpoint name so a
 * token minted for `chat` cannot be spent on `review`.
 */
async function guardedPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let turnstileToken: string | null;
  try {
    turnstileToken = await getToken(path.slice("/api/".length));
  } catch (cause) {
    throw new ApiError(cause instanceof Error ? cause.message : String(cause), 403);
  }
  return post<T>(path, turnstileToken ? { ...body, turnstileToken } : body);
}

export const api = {
  topics: () => request<TopicsResponse>("/api/topics"),

  /** Public runtime configuration. Free, called once at startup. */
  config: () => request<ConfigResponse>("/api/config"),

  /** Free and instant. Called while the user types a custom prompt. */
  resolve: (body: { statement: string; instruction?: string }, signal?: AbortSignal) =>
    post<ResolveResponse>("/api/resolve", body, signal),

  /** Free, instant, no model call. Shown before the scoring request returns. */
  precheck: (body: { statement: string; instruction?: string; essay: string }) =>
    post<PrecheckResponse>("/api/precheck", body),

  /** 60-90 seconds, about $0.15. Turnstile-guarded and rate limited. */
  review: (body: { statement: string; instruction?: string; essay: string }) =>
    guardedPost<ReviewResponse>("/api/review", body),

  /** 40-105 seconds, about $0.15. Turnstile-guarded and rate limited. */
  write: (body: {
    statement: string;
    instruction?: string;
    targetScore?: number;
    guidance?: string;
  }) => guardedPost<WriteResponse>("/api/write", body),

  /** About 20x cheaper than the call that produced the result being discussed. */
  chat: (body: { context: string; question: string }) =>
    guardedPost<ChatResponse>("/api/chat", body),
};
