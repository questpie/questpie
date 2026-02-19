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

	const posts = q.collection("posts").fields((f) => ({
		title: f.textarea({ required: true }),
	}));

	const settings = q.global("settings").fields((f) => ({
		title: f.textarea({ required: true }),
	}));

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

	it("executes root RPC via adapter routes", async () => {
		const handler = createFetchHandler(setup.app, { rpc: appRpc });

		const rootResponse = await handler(
			new Request("http://localhost/rpc/ping", {
				method: "POST",
				body: JSON.stringify({ message: "hello" }),
			}),
		);
		const rootPayload = await rootResponse?.json();
		expect(rootPayload).toEqual({ message: "hello", hasSession: false });
	});

	it("handles raw functions without JSON parsing", async () => {
		const handler = createFetchHandler(setup.app, { rpc: appRpc });
		const response = await handler(
			new Request("http://localhost/rpc/webhook", {
				method: "POST",
				body: "raw-payload",
			}),
		);

		expect(await response?.text()).toBe("raw-payload");
	});

	it("returns 400 on invalid JSON input", async () => {
		const handler = createFetchHandler(setup.app, { rpc: appRpc });
		const response = await handler(
			new Request("http://localhost/rpc/ping", {
				method: "POST",
				body: "{invalid",
			}),
		);

		expect(response?.status).toBe(400);
	});
});
