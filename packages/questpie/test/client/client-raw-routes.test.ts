import { describe, expect, test } from "bun:test";

import { createClient } from "../../src/client/index.js";
import type { RawRouteDefinition } from "../../src/server/routes/types.js";

type EnrollmentExchangeRoute = Omit<RawRouteDefinition, "method"> & {
	readonly method: "POST";
};

type RawRoutesApp = {
	collections: {};
	routes: {
		"workMachines/enrollmentExchange": EnrollmentExchangeRoute;
	};
};

describe("typed raw route client", () => {
	test("passes request options through and returns the untouched Response", async () => {
		const controller = new AbortController();
		const response = new Response(null, {
			status: 204,
			headers: { "x-enrollment": "accepted" },
		});
		let receivedUrl = "";
		let receivedInit: RequestInit | undefined;

		const client = createClient<RawRoutesApp>({
			baseURL: "https://autopilot.example",
			basePath: "/api",
			rawRoutes: { "workMachines/enrollmentExchange:POST": true },
			headers: {
				"x-default": "default",
				authorization: "Bearer stale",
			},
			getAuthHeaders: () => ({ authorization: "Bearer current" }),
			fetch: async (input, init) => {
				receivedUrl = String(input);
				receivedInit = init;
				return response;
			},
		});
		const body = new URLSearchParams({ code: "fragment-code" });

		const result = await client.routes.workMachines.enrollmentExchange.post({
			body,
			credentials: "same-origin",
			headers: {
				"content-type": "application/x-www-form-urlencoded;charset=UTF-8",
				"x-request": "enrollment",
			},
			redirect: "manual",
			signal: controller.signal,
		});

		expect(result).toBe(response);
		expect(receivedUrl).toBe(
			"https://autopilot.example/api/work-machines/enrollment-exchange",
		);
		expect(receivedInit?.method).toBe("POST");
		expect(receivedInit?.body).toBe(body);
		expect(receivedInit?.credentials).toBe("same-origin");
		expect(receivedInit?.redirect).toBe("manual");
		expect(receivedInit?.signal).toBe(controller.signal);

		const headers = new Headers(receivedInit?.headers);
		expect(headers.get("authorization")).toBe("Bearer current");
		expect(headers.get("x-default")).toBe("default");
		expect(headers.get("x-request")).toBe("enrollment");
		expect(headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded;charset=UTF-8",
		);
		expect(headers.has("x-superjson")).toBe(false);
	});

	test("supports omitted options and returns non-success responses", async () => {
		const redirect = new Response(null, { status: 302 });
		const forbidden = new Response("denied", { status: 403 });
		const responses = [redirect, forbidden];
		const client = createClient<RawRoutesApp>({
			baseURL: "https://autopilot.example",
			rawRoutes: { "workMachines/enrollmentExchange:POST": true },
			fetch: async () => responses.shift()!,
		});

		expect(await client.routes.workMachines.enrollmentExchange.post()).toBe(
			redirect,
		);
		expect(await client.routes.workMachines.enrollmentExchange.post({})).toBe(
			forbidden,
		);
	});

	test("keeps RequestInit-shaped JSON input on the SuperJSON path", async () => {
		let received: RequestInit | undefined;
		const client = createClient<any>({
			baseURL: "https://autopilot.example",
			fetch: async (_input, init) => {
				received = init;
				return Response.json({ ok: true });
			},
		});

		await client.routes.messages.send.post({
			body: "hello",
			mode: "draft",
		});

		expect(received?.body).not.toBe("hello");
		expect(String(received?.body)).toContain("hello");
		expect(String(received?.body)).toContain("draft");
		expect(new Headers(received?.headers).get("x-superjson")).toBe("1");
	});

	test("keeps a same-path JSON method separate from a raw method", async () => {
		const rawResponse = new Response("download");
		const requests: RequestInit[] = [];
		const client = createClient<any>({
			baseURL: "https://autopilot.example",
			rawRoutes: { "report:GET": true },
			fetch: async (_input, init) => {
				requests.push(init ?? {});
				return requests.length === 1
					? rawResponse
					: Response.json({ total: 1 });
			},
		});

		expect(await client.routes.report.get()).toBe(rawResponse);
		expect(await client.routes.report.post({ mode: "week" })).toEqual({
			total: 1,
		});
		expect(requests[0]?.method).toBe("GET");
		expect(new Headers(requests[1]?.headers).get("x-superjson")).toBe("1");
	});
});
