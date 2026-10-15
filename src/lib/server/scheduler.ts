const g = globalThis as typeof globalThis & { __ozonSched__?: ReturnType<typeof setInterval> };

/** In-process rotator for a long-lived Node process. No-op on Vercel (use cron). */
export function ensureScheduler() {
  if (typeof window !== "undefined") return;
  if (process.env.VERCEL) return;
  if (g.__ozonSched__) return;
  const tick = () => {
    void import("./actions")
      .then((m) => m.runDueRotations())
      .catch((err) => console.error("[scheduler]", err));
  };
  g.__ozonSched__ = setInterval(tick, 20_000);
  tick();
}
