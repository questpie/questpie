import { describe, expect, it } from "bun:test";

import { CrdtAuthorizationRejectedError } from "../../../src/server/modules/core/integrated/crdt/authorization.js";
import { canonicalizeCrdtBrowserOrigin } from "../../../src/server/modules/core/integrated/crdt/origin.js";

describe("CRDT browser Origin", () => {
	it("uses URL origin serialization for host case and default ports", () => {
		expect(
			canonicalizeCrdtBrowserOrigin({
				origin: "HTTPS://Admin.Example.COM:443",
				appUrl: "https://app.example.com/admin",
				allowedOrigins: ["https://admin.example.com"],
			}),
		).toBe("https://admin.example.com");
		expect(
			canonicalizeCrdtBrowserOrigin({
				origin: "http://LOCALHOST:80",
				appUrl: "http://localhost:3000",
				allowedOrigins: ["http://localhost"],
			}),
		).toBe("http://localhost");
	});

	it("accepts the configured app origin", () => {
		expect(
			canonicalizeCrdtBrowserOrigin({
				origin: "https://app.example.com",
				appUrl: "https://app.example.com/admin",
			}),
		).toBe("https://app.example.com");
	});

	it("rejects every malformed, ambiguous, or nonmatching origin identically", () => {
		for (const origin of [
			null,
			"null",
			"",
			" https://app.example.com",
			"https://user@app.example.com",
			"https://app.example.com/",
			"https://app.example.com/path",
			"https://app.example.com?query=1",
			"https://app.example.com#fragment",
			"https://app.example.com\\path",
			"https://app.example.com.",
			"ftp://app.example.com",
			"https://evil.example.com",
		]) {
			expect(() =>
				canonicalizeCrdtBrowserOrigin({
					origin,
					appUrl: "https://app.example.com",
				}),
			).toThrow(CrdtAuthorizationRejectedError);
		}
	});

	it("fails startup-style configuration validation for non-origin allow entries", () => {
		expect(() =>
			canonicalizeCrdtBrowserOrigin({
				origin: "https://app.example.com",
				appUrl: "https://app.example.com",
				allowedOrigins: ["https://admin.example.com/path"],
			}),
		).toThrow("CRDT allowed origin must be an HTTP(S) origin");
	});
});
