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

test("preserves and enforces lossless Field-derived scalar descriptors", () => {
	const descriptor = decodeRuntimeCodecDescriptor({
		kind: "object",
		properties: {
			title: { kind: "text", minLength: 2, maxLength: 4 },
			sequence: { kind: "bigint", minimum: "-2", maximum: "9" },
			amount: { kind: "numeric", precision: 5, scale: 2 },
			localAt: { kind: "timestamp", withTimezone: false },
			zonedAt: { kind: "timestamp", withTimezone: true },
			on: { kind: "date" },
		},
	});
	const localAt = new Date("2026-08-28T10:20:30.000Z");
	const zonedAt = new Date("2026-08-28T11:20:30.000Z");

	expect(descriptor).toEqual({
		kind: "object",
		properties: {
			amount: { kind: "numeric", precision: 5, scale: 2 },
			localAt: { kind: "timestamp", withTimezone: false },
			on: { kind: "date" },
			sequence: { kind: "bigint", maximum: "9", minimum: "-2" },
			title: { kind: "text", maxLength: 4, minLength: 2 },
			zonedAt: { kind: "timestamp", withTimezone: true },
		},
	});
	expect(
		decodeRuntimeCodec(descriptor, {
			amount: "123.45",
			localAt: "2026-08-28T10:20:30.000",
			on: "2026-08-28",
			sequence: "9",
			title: "four",
			zonedAt: "2026-08-28T11:20:30.000Z",
		}),
	).toEqual({
		amount: "123.45",
		localAt,
		on: "2026-08-28",
		sequence: "9",
		title: "four",
		zonedAt,
	});
	expect(
		encodeRuntimeCodec(descriptor, {
			amount: "123.45",
			localAt,
			on: "2026-08-28",
			sequence: "9",
			title: "four",
			zonedAt,
		}),
	).toEqual({
		amount: "123.45",
		localAt: "2026-08-28T10:20:30.000",
		on: "2026-08-28",
		sequence: "9",
		title: "four",
		zonedAt: "2026-08-28T11:20:30.000Z",
	});

	for (const [key, value] of [
		["title", "x"],
		["sequence", "10"],
		["amount", "1234.56"],
		["on", "2026-02-30"],
		["on", "2026-99-99"],
	] as const)
		expect(() =>
			decodeRuntimeCodec(descriptor, {
				amount: "123.45",
				localAt: "2026-08-28T10:20:30.000",
				on: "2026-08-28",
				sequence: "9",
				title: "four",
				zonedAt: "2026-08-28T11:20:30.000Z",
				[key]: value,
			}),
		).toThrow(`$.${key}`);
});

test("decodes recursive closed values and exact tagged open JSON", () => {
	const descriptor = decodeRuntimeCodecDescriptor({
		kind: "object",
		properties: {
			profile: {
				kind: "object",
				properties: {
					tags: {
						kind: "array",
						maximum: 2,
						items: { kind: "text", maxLength: 5 },
					},
				},
			},
			metadata: { kind: "json" },
		},
	});
	const decoded = decodeRuntimeCodec(descriptor, {
		profile: { tags: ["alpha", "beta"] },
		metadata: { kind: "json", value: { b: [true], a: 1 } },
	});
	expect(decoded).toEqual({
		metadata: { kind: "json", value: { a: 1, b: [true] } },
		profile: { tags: ["alpha", "beta"] },
	});
	expect(Object.isFrozen((decoded as { metadata: object }).metadata)).toBe(
		true,
	);

	for (const hostile of [
		{ kind: "json", value: Number.NaN },
		{ kind: "json", value: -0 },
		{ kind: "json", value: [, "sparse"] },
	] as const)
		expect(() =>
			decodeRuntimeCodec(descriptor, {
				profile: { tags: [] },
				metadata: hostile,
			}),
		).toThrow("$.metadata");
	const cyclic: { self?: unknown } = {};
	cyclic.self = cyclic;
	expect(() =>
		decodeRuntimeCodec(descriptor, {
			profile: { tags: [] },
			metadata: { kind: "json", value: cyclic },
		}),
	).toThrow("$.metadata");
});

test("keeps omitted descriptor options backwards-compatible and rejects malformed options", () => {
	expect(decodeRuntimeCodecDescriptor({ kind: "text" })).toEqual({
		kind: "text",
	});
	expect(decodeRuntimeCodecDescriptor({ kind: "timestamp" })).toEqual({
		kind: "timestamp",
	});
	for (const hostile of [
		{ kind: "text", minLength: 2, maxLength: 1 },
		{ kind: "bigint", minimum: "01" },
		{ kind: "numeric", precision: 2, scale: 3 },
		{ kind: "timestamp", withTimezone: "yes" },
		{ kind: "date", extra: true },
		{ kind: "json", value: true },
	] as const)
		expect(() => decodeRuntimeCodecDescriptor(hostile)).toThrow();
});
