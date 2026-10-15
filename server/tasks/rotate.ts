import { defineTask } from "nitro/task";

export default defineTask({
  meta: {
    name: "rotate",
    description: "Switch due Ozon card variants",
  },
  async run() {
    const { runDueRotations } = await import("../../src/lib/server/actions");
    const result = await runDueRotations();
    return { result };
  },
});
