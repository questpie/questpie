import { describe, expect, test } from "bun:test";

import {
	projectPostgresChangeCapture,
	type PostgresChangeCaptureV1,
} from "../../packages/compiler/src/schema";

const input = {
	applicationName: "collaboration",
	postgresSchema: "collaboration",
	collections: [
		{
			identity: "collection:messages",
			postgresName: "messages",
			keyColumns: ["id"],
		},
		{
			identity: "collection:spaces",
			postgresName: "spaces",
			keyColumns: ["company_id", "code"],
		},
	],
} as const;

describe("BETA-07 PostgreSQL Change Ledger capture projection", () => {
	test("projects one deterministic row and truncate trigger pair per reactive Collection", () => {
		const projected = projectPostgresChangeCapture(input);
		const reversed = projectPostgresChangeCapture({
			...input,
			collections: input.collections.toReversed(),
		});

		expect(projected).toEqual(reversed);
		expect(projected).toMatchObject({
			version: 1,
			applicationName: "collaboration",
			postgresSchema: "collaboration",
			collections: [
				{
					identity: "collection:messages",
					postgresName: "messages",
					keyColumns: ["id"],
					rowTrigger: "messages_questpie_capture_row",
					truncateTrigger: "messages_questpie_capture_truncate",
				},
				{
					identity: "collection:spaces",
					postgresName: "spaces",
					keyColumns: ["company_id", "code"],
					rowTrigger: "spaces_questpie_capture_row",
					truncateTrigger: "spaces_questpie_capture_truncate",
				},
			],
		});
		expect(projected.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(projected.sql).toContain(
			"AFTER INSERT OR UPDATE OR DELETE ON collaboration.messages",
		);
		expect(projected.sql).toContain("AFTER TRUNCATE ON collaboration.spaces");
		expect(projected.sql).toContain(
			"questpie_internal.capture_reactive_row('collaboration', 'collection:spaces', 'company_id', 'code')",
		);
	});

	test("rejects partitioned reactive Collections and ambiguous capture topology", () => {
		const project = (
			collections: Parameters<
				typeof projectPostgresChangeCapture
			>[0]["collections"],
		): PostgresChangeCaptureV1 =>
			projectPostgresChangeCapture({ ...input, collections });

		expect(() =>
			project([
				{
					identity: "collection:messages",
					postgresName: "messages",
					keyColumns: ["id"],
					partitioned: true,
				},
			]),
		).toThrow(/QP-SCHEMA-004 unsupportedDefinition/);
		expect(() => project([...input.collections, input.collections[0]])).toThrow(
			/QP-SCHEMA-002 duplicateIdentity/,
		);
		expect(() =>
			project([
				{
					identity: "collection:messages",
					postgresName: "messages",
					keyColumns: [],
				},
			]),
		).toThrow(/QP-SCHEMA-001 invalidDefinition/);
	});
});
