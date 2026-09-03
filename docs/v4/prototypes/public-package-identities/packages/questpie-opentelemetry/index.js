import { identity } from "questpie";

export function createOpenTelemetry() {
	return Object.freeze({ questpieIdentity: identity });
}
