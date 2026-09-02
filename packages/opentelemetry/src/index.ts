import type { QuestpieObservability } from "questpie";
import { QUESTPIE_OBSERVABILITY_PACKAGE_VERSION } from "questpie/internal/observability";

import {
	EXPECTED_QUESTPIE_VERSION,
	decodeOpenTelemetryConfiguration,
	type OpenTelemetryOptions,
} from "./config";
import { createOpenTelemetryHandle } from "./lifecycle";
import { createOpenTelemetrySdk } from "./sdk";

export type { OpenTelemetryOptions } from "./config";

export interface QuestpieOpenTelemetry extends QuestpieObservability {
	close(): Promise<void>;
}

export async function createOpenTelemetry(
	options?: OpenTelemetryOptions,
): Promise<QuestpieOpenTelemetry> {
	if (QUESTPIE_OBSERVABILITY_PACKAGE_VERSION !== EXPECTED_QUESTPIE_VERSION)
		throw new TypeError("QP-OTEL-002 input.questpieVersion");
	const configuration = decodeOpenTelemetryConfiguration(options, process.env);
	return createOpenTelemetryHandle({
		closeTimeoutMilliseconds: 30_000,
		configuration,
		createSdk: (metadata) =>
			createOpenTelemetrySdk({ metadata, configuration }),
	});
}
