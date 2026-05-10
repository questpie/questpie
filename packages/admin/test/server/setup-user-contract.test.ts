import { describe, expect, it } from "bun:test";

import { getAdminUserTableContract } from "#questpie/admin/server/modules/admin/routes/setup";

describe("admin setup user contract", () => {
	it("returns the canonical admin user table fields", () => {
		const role = {};
		const emailVerified = {};
		const id = {};

		expect(
			getAdminUserTableContract({
				table: { id, role, emailVerified },
			}),
		).toEqual({ id, role, emailVerified });
	});

	it("fails with an actionable error when user.role is missing", () => {
		expect(() =>
			getAdminUserTableContract({
				table: { id: {}, emailVerified: {} },
			}),
		).toThrow(
			'QUESTPIE Admin requires the canonical Better Auth "user" collection',
		);
		expect(() =>
			getAdminUserTableContract({
				table: { id: {}, emailVerified: {} },
			}),
		).toThrow('Do not replace collection("user") from scratch');
		expect(() =>
			getAdminUserTableContract({
				table: { id: {}, emailVerified: {} },
			}),
		).toThrow("Missing field(s): role.");
	});
});
