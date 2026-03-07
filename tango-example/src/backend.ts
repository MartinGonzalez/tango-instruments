import {
  defineBackend,
  type InstrumentBackendContext,
  type InstrumentBackgroundRefreshContext,
} from "tango-api/backend";

let startedAt: string | null = null;

async function onStart(ctx: InstrumentBackendContext): Promise<void> {
  startedAt = new Date().toISOString();
  ctx.logger.info("Backend started");
  await ctx.host.storage.setProperty("lifecycle.status", "active");
  await ctx.host.storage.setProperty("lifecycle.startedAt", startedAt);
}

async function onStop(): Promise<void> {
  startedAt = null;
}

async function onBackgroundRefresh(ctx: InstrumentBackgroundRefreshContext): Promise<void> {
  const prev = ((await ctx.host.storage.getProperty("bg.tickCount")) as number) ?? 0;
  const tickCount = prev + 1;
  const refreshedAt = new Date().toISOString();

  await ctx.host.storage.setProperty("bg.tickCount", tickCount);
  await ctx.host.storage.setProperty("bg.lastRefreshedAt", refreshedAt);
  await ctx.host.storage.setProperty("lifecycle.status", "suspended");

  ctx.logger.info(`Background tick #${tickCount}`);
  ctx.emit({ event: "bg.tick", payload: { tickCount, refreshedAt } });
}

export default defineBackend({
  kind: "tango.instrument.backend.v2",
  onStart,
  onStop,
  onBackgroundRefresh,
  actions: {
    hello: {
      input: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      },
      output: {
        type: "object",
        properties: {
          greeting: { type: "string" },
        },
        required: ["greeting"],
      },
      handler: async (
        ctx: InstrumentBackendContext,
        input?: { name?: string }
      ) => {
        return { greeting: `Hello, ${input?.name ?? "world"}!` };
      },
    },

    getLifecycleState: {
      input: { type: "object", properties: {} },
      output: { type: "any" },
      handler: async (ctx: InstrumentBackendContext) => {
        const status = await ctx.host.storage.getProperty("lifecycle.status");
        const tickCount = await ctx.host.storage.getProperty("bg.tickCount");
        const lastRefreshedAt = await ctx.host.storage.getProperty("bg.lastRefreshedAt");
        const lifecycleStartedAt = await ctx.host.storage.getProperty("lifecycle.startedAt");
        return {
          status: status ?? "unknown",
          startedAt: lifecycleStartedAt,
          tickCount: tickCount ?? 0,
          lastRefreshedAt: lastRefreshedAt ?? null,
        };
      },
    },

    resetTicks: {
      input: { type: "object", properties: {} },
      output: { type: "object", properties: { ok: { type: "boolean" } } },
      handler: async (ctx: InstrumentBackendContext) => {
        await ctx.host.storage.setProperty("bg.tickCount", 0);
        await ctx.host.storage.setProperty("bg.lastRefreshedAt", null);
        return { ok: true };
      },
    },
  },
});
