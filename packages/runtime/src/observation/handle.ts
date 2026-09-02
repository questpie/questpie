import type { QuestpieObservability } from "questpie";
import {
	bindOfficialQuestpieObservability,
	type QuestpieObservationRuntimeMetadataV1,
} from "questpie/internal/observability";

import type { ObservationAdapterV1 } from "./contract";

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
export function resolveObservationHandle(
	handle: QuestpieObservability,
	metadata: QuestpieObservationRuntimeMetadataV1,
): ObservationAdapterV1 {
	return snapshotAdapter(
		bindOfficialQuestpieObservability(handle, metadata) as ObservationAdapterV1,
	);
}
