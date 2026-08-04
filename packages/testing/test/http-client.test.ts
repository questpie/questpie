import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createHttpClient, HttpJsonError } from "../src/scenario.js";

/*
 * UC-TEST-013..016. The client is a transport, so the contract is what goes on
 * the wire. These run against a real loopback server: no application, no
 * database, nothing mocked between the client and the socket.
 */

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const cookie = request.headers.get("cookie") ?? "";

			if (url.pathname === "/login") {
				return new Response(null, {
					status: 302,
					headers: [
						["location", "/home"],
						["set-cookie", "session=abc123; Path=/; HttpOnly"],
						["set-cookie", "tenant=acme; Path=/"],
					],
				});
			}
			if (url.pathname === "/rotate") {
				return new Response(null, {
					status: 204,
					headers: [["set-cookie", "session=rotated; Path=/"]],
				});
			}
			if (url.pathname === "/logout") {
				return new Response(null, {
					status: 204,
					headers: [["set-cookie", "session=; Path=/; Max-Age=0"]],
				});
			}
			if (url.pathname === "/whoami") {
				return Response.json({ cookie });
			}
			if (url.pathname === "/echo") {
				return new Response(await request.text(), {
					status: 201,
					headers: {
						"content-type": request.headers.get("content-type") ?? "",
						"x-trace": "trace-1",
					},
				});
			}
			if (url.pathname === "/upload") {
				const form = await request.formData();
				const file = form.get("avatar");
				return Response.json({
					title: form.get("title"),
					filename: file instanceof File ? file.name : null,
					contents: file instanceof File ? await file.text() : null,
				});
			}
			if (url.pathname === "/html") {
				return new Response("<html>gateway timeout</html>", {
					status: 504,
					headers: { "content-type": "text/html" },
				});
			}
			return new Response("not found", { status: 404 });
		},
	});
	baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
	server.stop(true);
});

describe("UC-TEST-013 replay-cookie-jar", () => {
	it("absorbs several Set-Cookie headers from one response and replays them together", async () => {
		const client = createHttpClient({ baseUrl });
		await client.request("/login");

		expect(client.cookies.get("session")).toBe("abc123");
		expect(client.cookies.get("tenant")).toBe("acme");

		const seen = await client.request("/whoami");
		const sent = seen.json<{ cookie: string }>().cookie;
		expect(sent).toContain("session=abc123");
		expect(sent).toContain("tenant=acme");
	});

	it("replaces a cookie when the server sends the same name again", async () => {
		const client = createHttpClient({ baseUrl });
		await client.request("/login");
		await client.request("/rotate");

		expect(client.cookies.get("session")).toBe("rotated");
		const sent = (await client.request("/whoami")).json<{ cookie: string }>()
			.cookie;
		expect(sent).toContain("session=rotated");
		expect(sent).not.toContain("abc123");
	});

	it("drops a cookie the server expires instead of replaying it", async () => {
		const client = createHttpClient({ baseUrl });
		await client.request("/login");
		await client.request("/logout");

		expect(client.cookies.get("session")).toBeUndefined();
		const sent = (await client.request("/whoami")).json<{ cookie: string }>()
			.cookie;
		expect(sent).not.toContain("session=");
		expect(sent).toContain("tenant=acme");
	});

	it("sends no cookie header at all before anything is set", async () => {
		const client = createHttpClient({ baseUrl });
		const sent = (await client.request("/whoami")).json<{ cookie: string }>()
			.cookie;
		expect(sent).toBe("");
	});
});

describe("UC-TEST-014 request-shapes", () => {
	it("sends JSON with a JSON content type", async () => {
		const client = createHttpClient({ baseUrl });
		const response = await client.request("/echo", {
			method: "POST",
			json: { title: "hello" },
		});

		expect(response.status).toBe(201);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.body).toBe('{"title":"hello"}');
	});

	it("sends a text body untouched", async () => {
		const client = createHttpClient({ baseUrl });
		const response = await client.request("/echo", {
			method: "POST",
			body: "plain words",
			headers: { "content-type": "text/plain" },
		});

		expect(response.body).toBe("plain words");
	});

	it("returns the redirect instead of following it", async () => {
		const client = createHttpClient({ baseUrl });
		const response = await client.request("/login");

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/home");
	});

	it("uploads a file as multipart alongside plain fields", async () => {
		const client = createHttpClient({ baseUrl });
		const response = await client.upload("/upload", {
			fields: { title: "avatar upload" },
			files: {
				avatar: {
					content: "file bytes",
					filename: "a.txt",
					type: "text/plain",
				},
			},
		});

		expect(response.json<Record<string, string>>()).toEqual({
			title: "avatar upload",
			filename: "a.txt",
			contents: "file bytes",
		});
	});

	it("carries cookies onto an upload", async () => {
		const client = createHttpClient({ baseUrl });
		await client.request("/login");
		await client.upload("/upload", { fields: { title: "t" } });

		expect(client.cookies.get("session")).toBe("abc123");
	});
});

describe("UC-TEST-015 preserve-response-detail", () => {
	it("keeps status, headers and the raw body", async () => {
		const client = createHttpClient({ baseUrl });
		const response = await client.request("/echo", {
			method: "POST",
			body: "raw",
		});

		expect(response.status).toBe(201);
		expect(response.headers.get("x-trace")).toBe("trace-1");
		expect(response.body).toBe("raw");
	});

	it("fails with the status and the raw body when the body is not JSON", async () => {
		const client = createHttpClient({ baseUrl });
		const response = await client.request("/html");

		expect(response.status).toBe(504);
		expect(() => response.json()).toThrow(HttpJsonError);
		try {
			response.json();
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(HttpJsonError);
			expect((error as HttpJsonError).status).toBe(504);
			expect((error as HttpJsonError).body).toContain("gateway timeout");
		}
	});
});

describe("UC-TEST-016 redact-registered-secrets", () => {
	it("redacts a registered secret and every cookie value", async () => {
		const client = createHttpClient({ baseUrl, secrets: ["s3cret-token"] });
		await client.request("/login");

		const rendered = client.redact(
			"auth=s3cret-token and session=abc123 and tenant=acme",
		);
		expect(rendered).not.toContain("s3cret-token");
		expect(rendered).not.toContain("abc123");
		expect(rendered).not.toContain("acme");
		expect(rendered).toContain("[REDACTED]");
	});

	it("redacts a secret registered after the client was made", async () => {
		const client = createHttpClient({ baseUrl });
		client.addSecret("late-secret");

		expect(client.redact("value late-secret")).not.toContain("late-secret");
	});

	it("keeps a JSON failure body bounded and redacted", async () => {
		const client = createHttpClient({
			baseUrl,
			secrets: ["gateway"],
			maxBodyChars: 12,
		});
		const response = await client.request("/html");

		try {
			response.json();
			expect.unreachable();
		} catch (error) {
			const message = (error as HttpJsonError).message;
			expect(message).not.toContain("gateway");
			expect(message.length).toBeLessThan(200);
		}
	});

	it("never redacts an empty secret into every gap", () => {
		const client = createHttpClient({ baseUrl, secrets: [""] });

		expect(client.redact("abc")).toBe("abc");
	});
});
