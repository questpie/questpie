import { expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";
import {
	END_OUTCOMES,
	EVENT_OUTCOMES,
	EVENT_SCOPES,
} from "@questpie/runtime/observation";

import { projectObservationSignalProjection } from "../../packages/compiler/src/observation";

test("projects the accepted exact OpenTelemetry signal artifact", () => {
	const projection = projectObservationSignalProjection("4.0.0-beta.1");

	expect(projection.artifact).toMatchObject({
		format: "questpie.opentelemetry-signal-projection",
		version: 1,
		semanticConventions: { version: "1.44.0" },
		instrumentationScope: {
			name: "questpie",
			version: "4.0.0-beta.1",
		},
	});
	expect(projection.digest).toBe(
		"431a00809677d76cd51b0a48bd4ac005badc729df345e57e35ceb15c5a467dbf",
	);
	expect(projection.bytes.endsWith("\n")).toBe(true);
	expect(projection.artifact.spanGraph).toHaveLength(14);
	expect(projection.artifact.spanEventLimit).toBe(32);
	expect(projection.artifact.metrics).toHaveLength(10);
	expect(projection.artifact.spanAttributeScopes).toMatchObject({
		"questpie.execution.entry": ["execution", "query", "mutation", "action"],
		"questpie.retry.delay_ms": ["job.attempt", "reaction.attempt"],
	});
	expect(projection.artifact.ingressTracePlanGrammar).toEqual({
		absent: { adapterReturn: null, runtimePlan: "root" },
		variants: [
			{
				exactKeys: ["extracted", "kind"],
				extracted: {
					context: "neutral-trace-context-v1",
					exactKeys: ["context", "tracestate"],
					tracestate: {
						maximumUtf8Bytes: 512,
						printableAsciiOnly: true,
						type: "string-or-null",
					},
				},
				kind: "remote-parent",
			},
			{
				exactKeys: ["kind", "links"],
				kind: "root-with-links",
				links: {
					exactLength: 1,
					item: "neutral-trace-context-v1",
				},
			},
		],
	});
	expect(projection.artifact.httpTerminalGrammar).toEqual({
		field: "httpResponseStatusCode",
		null: {
			outcomes: ["framework_error", "cancelled", "deadline"],
			value: null,
		},
		numeric: {
			maximum: 599,
			minimum: 100,
			outcomes: ["ok", "framework_error", "cancelled", "deadline"],
			type: "integer",
		},
		projectedAttribute: "http.response.status_code",
		projectedWhen: "numeric",
		scopes: ["fetch", "route"],
	});
	expect(projection.artifact.spanEventOutcomes).toEqual({
		"questpie.durable.terminal": ["ok", "framework_error", "cancelled"],
	});
	expect(projection.artifact.spanEventScopes).toEqual(
		Object.fromEntries(
			Object.entries(EVENT_SCOPES).map(([event, scopes]) => [
				`questpie.${event}`,
				scopes,
			]),
		),
	);
	expect(projection.artifact.spanEventOutcomes).toEqual(
		Object.fromEntries(
			Object.entries(EVENT_OUTCOMES).map(([event, outcomes]) => [
				`questpie.${event}`,
				outcomes,
			]),
		),
	);
	expect(projection.artifact.endOutcomesByScope).toEqual(END_OUTCOMES);
	expect(Object.isFrozen(projection.artifact)).toBe(true);
	expect(Object.isFrozen(projection.artifact.spanGraph[0])).toBe(true);
	expect("config" in projection).toBe(false);
});

test("binds the signal projection into generated Runtime Build inventory", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-otel01-artifact-"));
	try {
		await cp(resolve(import.meta.dir, "../../fixtures/collaboration"), root, {
			recursive: true,
		});
		const compiled = await compileApplication({ applicationRoot: root });
		const projectionBytes =
			compiled.generatedFiles["opentelemetry-signal-projection.json"];
		const runtimeBuild = JSON.parse(
			compiled.generatedFiles["runtime-build.json"]!,
		) as Readonly<{
			observationSignalProjectionDigest: string;
			inventory: readonly Readonly<{ path: string; digest: string }>[];
		}>;

		expect(projectionBytes).toBe(
			projectObservationSignalProjection("4.0.0-beta.1").bytes,
		);
		expect(runtimeBuild.observationSignalProjectionDigest).toBe(
			"431a00809677d76cd51b0a48bd4ac005badc729df345e57e35ceb15c5a467dbf",
		);
		expect(runtimeBuild.inventory).toContainEqual(
			expect.objectContaining({
				path: "opentelemetry-signal-projection.json",
			}),
		);
		expect(
			compiled.generatedFiles["opentelemetry-effective-config.json"],
		).toBeUndefined();
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}, 30_000);
