import { describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";

import {
	canonicalizeCrdtBrowserOrigin,
	createCrdtTicketCredential,
	CrdtTicketRejectedError,
	parseCrdtTicketCredential,
} from "../../../src/server/modules/core/integrated/crdt/ticket.js";

describe("CRDT browser ticket Origin", () => {
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
			).toThrow(CrdtTicketRejectedError);
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

describe("CRDT one-use ticket credential", () => {
	const ticketId = "00000000-0000-4000-8000-000000000301";
	const secretKey = "k".repeat(32);

	it("carries 256 secret bits while persisting only a keyed hash", () => {
		const issued = createCrdtTicketCredential({
			ticketId,
			secretKey,
			randomSecret: Buffer.alloc(32, 0x42),
		});
		const parsed = parseCrdtTicketCredential({
			token: issued.token,
			secretKey,
		});

		expect(issued.token).toBe(
			`${ticketId}.QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI`,
		);
		expect(issued.secretHash).toHaveLength(32);
		expect(parsed.ticketId).toBe(ticketId);
		expect(parsed.secretHash).toEqual(issued.secretHash);
		expect(Buffer.from(issued.secretHash).includes(0x42)).toBe(false);
	});

	it("rejects noncanonical, padded, truncated, and oversized tokens identically", () => {
		const valid = createCrdtTicketCredential({
			ticketId,
			secretKey,
			randomSecret: Buffer.alloc(32, 0x11),
		}).token;
		for (const token of [
			"",
			`${valid}=`,
			valid.slice(0, -1),
			`not-a-uuid.${valid.split(".")[1]}`,
			`${ticketId}.${"a".repeat(44)}`,
			`${ticketId}.${"a".repeat(220)}`,
		]) {
			expect(() => parseCrdtTicketCredential({ token, secretKey })).toThrow(
				CrdtTicketRejectedError,
			);
		}
	});
});
