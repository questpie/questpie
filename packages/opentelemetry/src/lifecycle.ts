import type { QuestpieObservability } from "questpie";
import {
	createOfficialQuestpieObservability,
	type QuestpieObservationRuntimeMetadataV1,
} from "questpie/internal/observability";

import type { decodeOpenTelemetryConfiguration } from "./config";
import type { createOpenTelemetrySdk } from "./sdk";

type Configuration = ReturnType<typeof decodeOpenTelemetryConfiguration>;
type Sdk = ReturnType<typeof createOpenTelemetrySdk>;

export type OpenTelemetryHandle = QuestpieObservability &
	Readonly<{ close(): Promise<void> }>;

export function createOpenTelemetryHandle(
	input: Readonly<{
		closeTimeoutMilliseconds: number;
		configuration: Configuration;
		createSdk(
			metadata: QuestpieObservationRuntimeMetadataV1,
			configuration: Configuration,
		): Readonly<Pick<Sdk, "adapter" | "close">>;
	}>,
): OpenTelemetryHandle {
	let sdk: Readonly<Pick<Sdk, "adapter" | "close">> | undefined;
	let closed = false;
	let closePromise: Promise<void> | undefined;
	const close = (): Promise<void> =>
		(closePromise ??= (async () => {
			closed = true;
			if (sdk === undefined) return;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					sdk.close(),
					new Promise<void>((resolve) => {
						timeout = setTimeout(resolve, input.closeTimeoutMilliseconds);
					}),
				]);
			} catch {
				// Telemetry shutdown is lossy and never replaces the App outcome.
			} finally {
				if (timeout !== undefined) clearTimeout(timeout);
			}
		})());
	return createOfficialQuestpieObservability((metadata) => {
		if (closed) throw new TypeError("QP-OTEL-001 invalidConfiguration: closed");
		sdk = input.createSdk(metadata, input.configuration);
		return sdk.adapter;
	}, Object.freeze({ close })) as OpenTelemetryHandle;
}
