import { setCookie } from "@tanstack/react-start/server";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";

/**
 * Same job as `better-auth/tanstack-start` `tanstackStartCookies`, but with a
 * static import. The upstream plugin does `await import("@tanstack/react-start/server")`,
 * and the Nitro node-server bundle resolves that to undefined
 * ("Cannot destructure property 'setCookie'").
 */
export function startCookies(): BetterAuthPlugin {
  return {
    id: "tanstack-start-cookies",
    hooks: {
      after: [
        {
          matcher() {
            return true;
          },
          handler: createAuthMiddleware(async (ctx) => {
            if ("_flag" in ctx && ctx._flag === "router") return;
            const headers = ctx.context.responseHeaders;
            if (!(headers instanceof Headers)) return;
            const raw = headers.get("set-cookie");
            if (!raw) return;
            for (const [key, value] of parseSetCookieHeader(raw)) {
              if (!key) continue;
              try {
                setCookie(key, value.value, toCookieOptions(value));
              } catch (err) {
                console.error("[auth] setCookie failed", err);
              }
            }
          }),
        },
      ],
    },
  };
}
