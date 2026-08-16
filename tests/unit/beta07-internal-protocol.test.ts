import { describe, expect, test } from "bun:test";

import { internalProtocolV3Checksum } from "../../packages/compiler/src/schema";
import { bootstrapChecksum } from "../../packages/compiler/src/schema/postgres/bootstrap";
import { internalProtocolV2Checksum } from "../../packages/compiler/src/schema/postgres/internal-protocol-v2";
import { internalProtocolV3Sql } from "../../packages/compiler/src/schema/postgres/internal-protocol-v3";

describe("BETA-07 questpie.internal.v3 contract", () => {
	test("extends the byte-stable v1/v2 protocols with ledger and retained state", () => {
		expect(bootstrapChecksum).toBe(
			"278ed5b4c255a347a97d21f130197e3c4e643cd1510ae84bde628de567c593ad",
		);
		expect(internalProtocolV2Checksum).toBe(
			"4f125ab85f16891c072f1b734e023938b7f2a2eb56c5e17dfd8acafbd71f98ff",
		);
		expect(internalProtocolV3Checksum).toBe(
			"df082cc1175429dcfba8338f7e700d29c6116dcc1c4fcc093122c3a23333b14d",
		);
		for (const table of [
			"change_ledger",
			"reconciliation_consumers",
			"processed_change_facts",
			"observed_dependency_plans",
			"retained_live_query_results",
		])
			expect(internalProtocolV3Sql).toContain(
				`CREATE TABLE questpie_internal.${table}`,
			);
		expect(internalProtocolV3Sql).toContain("existing_count >= 16");
		expect(internalProtocolV3Sql).toContain("SECURITY DEFINER");
		expect(internalProtocolV3Sql).toContain(
			"REVOKE ALL ON ALL TABLES IN SCHEMA questpie_internal FROM PUBLIC",
		);
	});
});
