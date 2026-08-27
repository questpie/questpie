import { expect, test } from "bun:test";

import { codec } from "../../packages/questpie/src";
import {
	decodeRuntimeCodec,
	decodeRuntimeCodecDescriptor,
	encodeRuntimeCodec,
} from "../../packages/runtime/src/codec";

test("decodes and enforces bounded integer and list descriptors", () => {
	const descriptor = decodeRuntimeCodecDescriptor(
		codec.object({
			first: codec.integer({ minimum: 1, maximum: 100 }),
			statuses: codec.list(codec.text(), { maximum: 2 }),
		}),
	);

	expect(
		decodeRuntimeCodec(descriptor, {
			first: 30,
			statuses: ["open", "pending"],
		}),
	).toEqual({ first: 30, statuses: ["open", "pending"] });
	expect(() =>
		decodeRuntimeCodec(descriptor, { first: 0, statuses: [] }),
	).toThrow("$.first must be at least 1");
	expect(() =>
		decodeRuntimeCodec(descriptor, {
			first: 1,
			statuses: ["open", "pending", "closed"],
		}),
	).toThrow("$.statuses must contain at most 2 items");
});

test("treats cursors as opaque NFC strings on runtime and wire boundaries", () => {
	const descriptor = decodeRuntimeCodecDescriptor(codec.cursor());

	expect(decodeRuntimeCodec(descriptor, "opaque.cursor/value")).toBe(
		"opaque.cursor/value",
	);
	expect(encodeRuntimeCodec(descriptor, "opaque.cursor/value")).toBe(
		"opaque.cursor/value",
	);
	expect(() => decodeRuntimeCodec(descriptor, 42)).toThrow(
		"$ must be an opaque cursor",
	);
	expect(() => decodeRuntimeCodec(descriptor, "e\u0301")).toThrow(
		"$ must be an NFC cursor",
	);
});

test("rejects hostile bounded descriptors before decoding values", () => {
	expect(() =>
		decodeRuntimeCodecDescriptor({
			kind: "integer",
			minimum: 2,
			maximum: 1,
		}),
	).toThrow("$codec minimum must not exceed maximum");
	expect(() =>
		decodeRuntimeCodecDescriptor({
			kind: "array",
			items: { kind: "text" },
			maximum: 0,
		}),
	).toThrow("$codec.maximum must be a positive safe integer");
});
