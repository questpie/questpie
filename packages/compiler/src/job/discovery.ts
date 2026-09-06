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
						execution.context,
					),
				},
				input: encodeRuntimeCodec(value.input as RuntimeCodec, schedule.input),
			},
		};
	} catch {
		return invalid();
	}
}
