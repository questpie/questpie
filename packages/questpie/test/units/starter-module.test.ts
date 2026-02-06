import { describe, expect, test } from "bun:test";
import { starterModule } from "../../src/server/modules/starter/starter.module.js";

describe("starterModule", () => {
  test("registers realtime cleanup cron job", () => {
    const realtimeCleanup = (starterModule.state.jobs as any).realtimeCleanup;

    expect(realtimeCleanup).toBeDefined();
    expect(realtimeCleanup.name).toBe("questpie.realtime.cleanup");
    expect(realtimeCleanup.options?.cron).toBe("0 * * * *");
    expect(realtimeCleanup.schema.parse({})).toEqual({});
  });

  test("realtime cleanup job calls realtime service cleanup", async () => {
    const realtimeCleanup = (starterModule.state.jobs as any).realtimeCleanup;
    let called = 0;

    await realtimeCleanup.handler({
      payload: {},
      app: {
        realtime: {
          cleanupOutbox: async (force: boolean) => {
            expect(force).toBe(true);
            called += 1;
          },
        },
      },
      db: {},
    });

    expect(called).toBe(1);
  });
});
