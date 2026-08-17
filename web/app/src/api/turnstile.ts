/**
 * Turnstile tokens for the paid endpoints.
 *
 * Three things make this correct rather than decorative:
 *
 * - A token is minted per request, not per page load. Tokens are single use
 *   and expire, and a review takes 60-90 seconds, so reusing one across two
 *   submissions fails on the second.
 * - Each token carries the endpoint as its `action`, which the Worker pins.
 * - The widget is `interaction-only`, so it is invisible until Cloudflare
 *   actually wants a challenge, at which point it appears centred and the user
 *   solves it inline.
 *
 * When no site key is configured -- local development without Turnstile set up
 * -- `getToken` returns null and the request goes out without one. The Worker
 * decides whether that is acceptable; it refuses in production.
 */

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      execution?: "render" | "execute";
      appearance?: "always" | "execute" | "interaction-only";
      callback?: (token: string) => void;
      "error-callback"?: (code?: string) => void;
      "timeout-callback"?: () => void;
    },
  ) => string;
  execute: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let siteKey: string | null = null;
let scriptPromise: Promise<void> | null = null;

/** Called once at startup with the key from /api/config. */
export function configureTurnstile(key: string | null): void {
  siteKey = key;
}

export function turnstileConfigured(): boolean {
  return Boolean(siteKey);
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the verification script."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** A centred host for the rare case where a challenge is actually shown. */
function createHost(): HTMLElement {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999";
  document.body.appendChild(host);
  return host;
}

/**
 * Resolve a fresh token for one request, or null when Turnstile is not set up.
 * Rejects with a message meant to be shown to the user.
 */
export async function getToken(action: string): Promise<string | null> {
  if (!siteKey) return null;

  await loadScript();
  const api = window.turnstile;
  if (!api) throw new Error("Could not load the verification script.");

  const host = createHost();

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | undefined;
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      if (widgetId !== undefined) {
        try {
          api.remove(widgetId);
        } catch {
          /* already gone */
        }
      }
      host.remove();
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const timer = window.setTimeout(() => {
      finish(() => reject(new Error("Verification timed out. Try again.")));
    }, 45_000);

    try {
      widgetId = api.render(host, {
        sitekey: siteKey as string,
        action,
        execution: "execute",
        appearance: "interaction-only",
        callback: (token) => finish(() => resolve(token)),
        "error-callback": () =>
          finish(() => reject(new Error("Verification failed. Reload the page and try again."))),
        "timeout-callback": () =>
          finish(() => reject(new Error("Verification timed out. Try again."))),
      });
      api.execute(widgetId);
    } catch {
      finish(() => reject(new Error("Could not start verification.")));
    }
  });
}
