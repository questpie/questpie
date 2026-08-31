import type { QuestpieObservability } from "questpie";

import type { ObservationAdapterV1 } from "./contract";

const adapters = new WeakMap<object, ObservationAdapterV1>();

function snapshotAdapter(adapter: ObservationAdapterV1): ObservationAdapterV1 {
	let format: unknown;
	let version: unknown;
	let extract: unknown;
	let begin: unknown;
	try {
		format = adapter.format;
		version = adapter.version;
		extract = adapter.extract;
		begin = adapter.begin;
	} catch {
		throw new TypeError("Runtime observation adapter is incompatible");
	}
	if (
		format !== "questpie.runtime-observability" ||
		version !== 1 ||
		typeof extract !== "function" ||
		typeof begin !== "function"
	)
		throw new TypeError("Runtime observation adapter is incompatible");
	return Object.freeze({
		format,
		version,
		extract: (input: Parameters<ObservationAdapterV1["extract"]>[0]) =>
			Reflect.apply(extract, adapter, [input]),
		begin: (input: Parameters<ObservationAdapterV1["begin"]>[0]) =>
			Reflect.apply(begin, adapter, [input]),
	});
}

/** Repository-private construction seam for the exact neutral adapter. */
export function createObservationHandle(
	adapter: ObservationAdapterV1,
): QuestpieObservability {
	const handle = Object.freeze(Object.create(null)) as QuestpieObservability;
	adapters.set(handle, snapshotAdapter(adapter));
	return handle;
}

export function resolveObservationHandle(
	handle: QuestpieObservability,
): ObservationAdapterV1 {
	if (
		(typeof handle !== "object" && typeof handle !== "function") ||
		handle === null
	)
		throw new TypeError("Runtime observation handle is incompatible");
	const adapter = adapters.get(handle);
	if (adapter === undefined)
		throw new TypeError("Runtime observation handle is incompatible");
	return adapter;
}
