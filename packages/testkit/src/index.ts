/**
 * `@questpie/testkit` stays private (ADR-0045). Its three lifecycle helpers
 * are the public `questpie/testing` subpath; this workspace re-exports them
 * from that canonical source instead of duplicating their implementation.
 * Framework-internal proof machinery (tracer hosts, Firefox journeys,
 * MCP/OTLP wire clients, hostile multi-instance harnesses) lives in
 * `tests/support` and is intentionally not part of this package.
 */
export {
	type Cleanup,
	CleanupStack,
	eventually,
	waitForOutputLine,
} from "questpie/testing";
