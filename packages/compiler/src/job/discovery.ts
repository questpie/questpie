import { principal } from "questpie";

import { encodeRuntimeCodec, type RuntimeCodec } from "@questpie/runtime/codec";

type RecordValue = Readonly<Record<string, unknown>>;

function invalid(): never {
	throw new TypeError("QP-COMPOSE-013 invalid static Job schedule");
}

function exact(value: unknown, keys: readonly string[]): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		Object.keys(descriptors).length !== keys.length ||
		Object.getOwnPropertySymbols(value).length > 0
	)
		invalid();
	for (const key of keys)
		if (!descriptors[key] || !Object.hasOwn(descriptors[key], "value"))
			invalid();
	return value as RecordValue;
}

function staticValue(value: unknown, active = new Set<object>()): unknown {
	if (value === null || typeof value !== "object") {
		if (typeof value === "function" || typeof value === "symbol") invalid();
		return value;
	}
	if (
		active.has(value) ||
		active.size >= 128 ||
		Object.getOwnPropertySymbols(value).length > 0
	)
		invalid();
	const prototype = Object.getPrototypeOf(value);
	if (value instanceof Date) {
		if (prototype !== Date.prototype || Object.keys(value).length > 0)
			invalid();
		return new Date(value.getTime());
	}
	if (
		prototype !== Object.prototype &&
		prototype !== Array.prototype &&
		prototype !== null
	)
		invalid();
	active.add(value);
	try {
		const snapshot: Record<string, unknown> | unknown[] = Array.isArray(value)
			? []
			: Object.create(null);
		for (const [key, descriptor] of Object.entries(
			Object.getOwnPropertyDescriptors(value),
		)) {
			if (!Object.hasOwn(descriptor, "value")) invalid();
			if (Array.isArray(snapshot) && key === "length") {
				Object.defineProperty(snapshot, key, { value: descriptor.value });
				continue;
			}
			Object.defineProperty(snapshot, key, {
				value: staticValue(descriptor.value, active),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return snapshot;
	} finally {
		active.delete(value);
	}
}

/** Runs in the same isolated bundle as authoring, before JSON discards brands. */
export function projectEvaluatedJobSchedule(
	value: RecordValue,
	records: readonly Readonly<{ exports: Readonly<Record<string, unknown>> }>[],
	packageId: string | null,
): RecordValue {
	const metadata = value["__questpie"] as RecordValue | undefined;
	if (metadata?.resourceKind !== "job" || value.schedule == null) return value;
	if (packageId !== null) invalid();
	const schedule = exact(value.schedule, ["cron", "execution", "input"]);
	const execution = exact(schedule.execution, ["principal", "context"]);
	const actor = execution.principal;
	if (
		!principal.is(actor) ||
		actor.kind !== "service" ||
		typeof actor.id !== "string" ||
		actor.id.length === 0 ||
		actor.id.length > 255 ||
		actor.id.includes("\0") ||
		actor.id !== actor.id.normalize("NFC") ||
		actor.id.trim() !== actor.id
	)
		invalid();
	if (typeof schedule.cron !== "string") invalid();
	const contexts = new Set<RecordValue>();
	for (const record of records)
		for (const candidate of Object.values(record.exports)) {
			if (!candidate || typeof candidate !== "object") continue;
			const definition = candidate as RecordValue;
			if (
				(definition["__questpie"] as RecordValue | undefined)?.resourceKind ===
				"context"
			)
				contexts.add(definition);
		}
	if (contexts.size > 1) invalid();
	const contextCodec = [...contexts][0]?.input ?? {
		kind: "object",
		properties: {},
	};
	try {
		return {
			...value,
			schedule: {
				cron: schedule.cron,
				execution: {
					principal: { kind: "service", id: actor.id },
					context: encodeRuntimeCodec(
						contextCodec as RuntimeCodec,
						staticValue(execution.context),
					),
				},
				input: encodeRuntimeCodec(
					value.input as RuntimeCodec,
					staticValue(schedule.input),
				),
			},
		};
	} catch {
		return invalid();
	}
}
