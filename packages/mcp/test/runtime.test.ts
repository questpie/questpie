import { describe, expect, it } from "bun:test";

import { safeJsonStringify, toToolResult } from "../src/server/runtime.js";

describe("MCP domain result wrapping", () => {
	it("does not reinterpret ordinary domain field names as a protocol envelope", () => {
		const value = {
			id: "post-1",
			content: "ordinary field",
			structuredContent: { nested: "ordinary field" },
			isError: false,
		};

		const result = toToolResult(value);

		expect(result.structuredContent).toEqual(value);
		expect(result.content).toEqual([
			{ type: "text", text: JSON.stringify(value, null, 2) },
		]);
		expect(result.isError).toBeUndefined();
	});

	it("returns inert structured content without invoking a Date toJSON getter", () => {
		let getterCalls = 0;
		const date = new Date("2026-07-25T12:34:56.789Z");
		Object.defineProperty(date, "toJSON", {
			get() {
				getterCalls += 1;
				return () => "x".repeat(4 * 1024 * 1024 + 1);
			},
		});

		const result = toToolResult({ createdAt: date });

		expect(result.structuredContent).toEqual({
			createdAt: date.toISOString(),
		});
		expect(result.content).toEqual([
			{
				type: "text",
				text: JSON.stringify({ createdAt: date.toISOString() }, null, 2),
			},
		]);
		expect(getterCalls).toBe(0);
	});

	it("bounds actual escaped JSON bytes at max and max plus one", () => {
		const maximum = 4 * 1024 * 1024;
		const controls = "\u0000".repeat(Math.floor((maximum - 2) / 6));
		const atMaximum = `${controls}aa`;
		const encoded = new TextEncoder();

		expect(encoded.encode(safeJsonStringify(atMaximum)).byteLength).toBe(
			maximum,
		);
		expect(() => safeJsonStringify(`${atMaximum}a`)).toThrow(
			"MCP operation failed",
		);
	});
});
