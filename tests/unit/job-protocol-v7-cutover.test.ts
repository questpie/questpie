import { expect, test } from "bun:test";

import { assertProtocolV7Cutover } from "../../packages/compiler/src/schema/postgres/internal-protocol-v7";

test("requires explicit acknowledgement only for an existing pre-v7 database", () => {
	const existingV6 = { version: 6, checksum: "a".repeat(64) };

	expect(() => assertProtocolV7Cutover(existingV6, {})).toThrow(
		"protocol v7 is a non-rolling upgrade",
	);
	expect(() =>
		assertProtocolV7Cutover(existingV6, {
			allowNonRollingProtocolV7: true,
		}),
	).not.toThrow();
	expect(() => assertProtocolV7Cutover(undefined, {})).not.toThrow();
	expect(() =>
		assertProtocolV7Cutover({ version: 7, checksum: "b".repeat(64) }, {}),
	).not.toThrow();
});
