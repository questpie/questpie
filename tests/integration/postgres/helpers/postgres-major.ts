import { expect } from "bun:test";

export function expectPostgresMajor(
	serverVersionNumber: string | number,
	declared = process.env.QUESTPIE_POSTGRES_MAJOR,
): void {
	if (declared !== undefined && !["16", "17", "18"].includes(declared))
		throw new Error("QUESTPIE_POSTGRES_MAJOR must be 16, 17, or 18 when set");
	// The existing CI matrix selects evidence; local proof remains PostgreSQL 17.
	const expected = declared === undefined ? 17 : Number(declared);
	expect(Math.trunc(Number(serverVersionNumber) / 10_000)).toBe(expected);
}
