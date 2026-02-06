import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { fn, questpie, rpc } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

const createModule = () => {
  const q = questpie({ name: "rpc-test" }).fields(defaultFields);

  const ping = fn({
    schema: z.object({ message: z.string() }),
    outputSchema: z.object({
      message: z.string(),
      hasSession: z.boolean(),
    }),
    handler: async ({ input, session }) => {
      return {
        message: input.message,
        // Test that session is accessible in handler
        hasSession: session !== undefined && session !== null,
      };
    },
  });

  const webhook = fn({
    mode: "raw",
    handler: async ({ request }) => {
      const body = await request.text();
      return new Response(body);
    },
  });

  const posts = q
    .collection("posts")
    .fields((f) => ({
      title: f.textarea({ required: true }),
    }))
    .functions({
      publish: fn({
        schema: z.object({ id: z.string() }),
        handler: async ({ input }) => ({ id: input.id }),
      }),
    });

  const settings = q
    .global("settings")
    .fields((f) => ({
      title: f.textarea({ required: true }),
    }))
    .functions({
      refresh: fn({
        schema: z.object({ ok: z.boolean() }),
        handler: async ({ input }) => ({ ok: input.ok }),
      }),
    });

  const builder = q.collections({ posts }).globals({ settings });
  const appRpc = rpc().router({ ping, webhook });

  return { builder, appRpc };
};

describe("rpc functions", () => {
  let setup: Awaited<
    ReturnType<typeof buildMockApp<ReturnType<typeof createModule>["builder"]>>
  >;
  let appRpc: ReturnType<typeof createModule>["appRpc"];

  beforeEach(async () => {
    const module = createModule();
    appRpc = module.appRpc;
    setup = await buildMockApp(module.builder);
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  it("executes root, collection, and global RPC via adapter routes", async () => {
    const handler = createFetchHandler(setup.cms, { rpc: appRpc });

    const rootResponse = await handler(
      new Request("http://localhost/cms/rpc/ping", {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    const rootPayload = await rootResponse?.json();
    expect(rootPayload).toEqual({ message: "hello", hasSession: false });

    const collectionResponse = await handler(
      new Request("http://localhost/cms/collections/posts/rpc/publish", {
        method: "POST",
        body: JSON.stringify({ id: "post-1" }),
      }),
    );
    expect(await collectionResponse?.json()).toEqual({ id: "post-1" });

    const globalResponse = await handler(
      new Request("http://localhost/cms/globals/settings/rpc/refresh", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );
    expect(await globalResponse?.json()).toEqual({ ok: true });
  });

  it("handles raw functions without JSON parsing", async () => {
    const handler = createFetchHandler(setup.cms, { rpc: appRpc });
    const response = await handler(
      new Request("http://localhost/cms/rpc/webhook", {
        method: "POST",
        body: "raw-payload",
      }),
    );

    expect(await response?.text()).toBe("raw-payload");
  });

  it("returns 400 on invalid JSON input", async () => {
    const handler = createFetchHandler(setup.cms, { rpc: appRpc });
    const response = await handler(
      new Request("http://localhost/cms/rpc/ping", {
        method: "POST",
        body: "{invalid",
      }),
    );

    expect(response?.status).toBe(400);
  });
});
