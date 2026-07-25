import { describe, expect, test } from "bun:test";

import { channel } from "../../src/server/channels/channel-builder.js";
import {
	assertChannelPayloadSize,
	assertUniqueResolvedChannelName,
	ChannelTokenBucketLimiter,
	resolveChannelRequestOrigin,
} from "../../src/server/channels/security.js";

describe("channel security", () => {
	test("requires an exact trusted origin for cookie requests", () => {
		const trusted = { appUrl: "https://app.example.com" };
		expect(
			resolveChannelRequestOrigin(
				new Request("https://app.example.com/channels/auth", {
					headers: {
						cookie: "session=one",
						origin: "https://app.example.com",
					},
				}),
				trusted,
			),
		).toBe("https://app.example.com");
		expect(() =>
			resolveChannelRequestOrigin(
				new Request("https://app.example.com/channels/auth", {
					headers: { cookie: "session=one" },
				}),
				trusted,
			),
		).toThrow("trusted Origin");
		expect(() =>
			resolveChannelRequestOrigin(
				new Request("https://app.example.com/channels/auth", {
					headers: { origin: "https://evil.example.com" },
				}),
				trusted,
			),
		).toThrow("trusted Origin");
		expect(
			resolveChannelRequestOrigin(
				new Request("https://app.example.com/channels/publish", {
					headers: { authorization: "Bearer token" },
				}),
				trusted,
			),
		).toBeNull();
	});

	test("rejects unsafe trusted-origin configuration", () => {
		for (const origin of [
			"*",
			"null",
			"https://example.com/path",
			"http://example.com",
			"https://user@example.com",
		]) {
			expect(() =>
				resolveChannelRequestOrigin(new Request("https://app.example.com"), {
					appUrl: "https://app.example.com",
					trustedOrigins: [origin],
				}),
			).toThrow();
		}
	});

	test("proves one canonical resolved-name identity", () => {
		const unique = {
			room: channel("room-[id]").authorize(true),
			news: channel("news-[slug]"),
		};
		expect(assertUniqueResolvedChannelName(unique, "room", { id: "one" })).toBe(
			"private-room-one",
		);

		const crossPattern = {
			first: channel("room-[id]").authorize(true),
			second: channel("room-[slug]").authorize(true),
		};
		expect(() =>
			assertUniqueResolvedChannelName(crossPattern, "first", { id: "one" }),
		).toThrow("collision");

		const ambiguous = {
			pair: channel("[left][right]").authorize(true),
		};
		expect(() =>
			assertUniqueResolvedChannelName(ambiguous, "pair", {
				left: "a",
				right: "bc",
			}),
		).toThrow("collision");
	});

	test("preflights the serialized application-data upper bound", () => {
		const accepted = "x".repeat(9_998);
		const rejected = "x".repeat(9_999);
		expect(assertChannelPayloadSize(accepted)).toBe(`"${accepted}"`);
		expect(() => assertChannelPayloadSize(rejected)).toThrow("10,000");
	});

	test("recovers publish tokens with a fake clock", () => {
		let now = 0;
		const limiter = new ChannelTokenBucketLimiter({
			ratePerSecond: 10,
			burst: 20,
			now: () => now,
		});
		for (let index = 0; index < 20; index++) {
			expect(limiter.consume("session-1")).toBe(true);
		}
		expect(limiter.consume("session-1")).toBe(false);
		expect(limiter.retryAfterMs(["session-1"])).toBe(100);
		now = 100;
		expect(limiter.consume("session-1")).toBe(true);
		expect(limiter.consume("session-1")).toBe(false);
	});
});
