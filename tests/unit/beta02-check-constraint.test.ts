import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	compileApplication,
	createCommittedMigration,
	createMigrationPlan,
} from "@questpie/compiler";

import { constraint, field } from "../../packages/questpie/src/index";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

const appointmentSource = (expression: string) => `
import { constraint, defineCollection, field } from "questpie";

const appointmentFields = {
	id: field.uuid(),
	startsAt: field.timestamp({ withTimezone: true }),
	endsAt: field.timestamp({ withTimezone: true }),
	sequence: field.integer(),
};

export const checkAppointments = defineCollection({
	name: "checkAppointments",
	fields: appointmentFields,
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		validWindow: ${expression},
	},
});
`;

describe("BETA-02 authored check Constraints", () => {
	test("projects one closed comparison through migration SQL", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-check-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/check-appointments.ts"),
				appointmentSource(
					"constraint.check<typeof appointmentFields>(({ fields }) => fields.endsAt.greaterThan(fields.startsAt))",
				),
			);
			const compilation = await compileApplication({
				applicationRoot: temporary,
			});
			const schema = JSON.parse(
				compilation.generatedFiles["schema-projection.json"] ?? "null",
			);
			const appointments = schema.collections.find(
				(collection: { identity: string }) =>
					collection.identity === "collection:checkAppointments",
			);
			const check = appointments.constraints.find(
				(item: { identity: string }) =>
					item.identity ===
					"collection:checkAppointments/constraint:validWindow",
			);
			expect(check).toEqual({
				kind: "check",
				identity: "collection:checkAppointments/constraint:validWindow",
				postgresName: "qp_ck_check_appointments_valid_window",
				expression: {
					kind: "compare",
					operator: "greaterThan",
					left: {
						kind: "field",
						field: "collection:checkAppointments/field:endsAt",
					},
					right: {
						kind: "field",
						field: "collection:checkAppointments/field:startsAt",
					},
				},
			});

			const planned = createMigrationPlan({
				targetSchema: schema,
				slug: "create-check-appointments",
			});
			const committed = createCommittedMigration({
				plan: planned.plan,
				baseSchema: planned.baseSchema,
				targetSchema: schema,
				currentSchema: schema,
				planDigest: planned.digest,
				localMigrations: [],
			});
			expect(committed.files["up.sql"]).toContain(
				'ADD CONSTRAINT "qp_ck_check_appointments_valid_window" CHECK (("ends_at" > "starts_at"));',
			);
		} finally {
			await rm(temporary, { recursive: true });
		}
	});

	test("evaluates the callback once and freezes the closed tree", () => {
		const fields = {
			startsAt: field.timestamp({ withTimezone: true }),
			endsAt: field.timestamp({ withTimezone: true }),
			greaterThan: field.timestamp({ withTimezone: true }),
		};
		let calls = 0;
		const definition = constraint.check<typeof fields>(({ fields }) => {
			calls += 1;
			return fields.endsAt.greaterThan(fields.startsAt);
		});
		expect(calls).toBe(1);
		expect(Object.isFrozen(definition)).toBe(true);
		expect(Object.isFrozen(definition.expression)).toBe(true);
		const collision = constraint.check<typeof fields>(({ fields }) =>
			fields.greaterThan.greaterThan(fields.startsAt),
		);
		expect(collision.expression).toMatchObject({
			left: { field: ["greaterThan"] },
		});
	});

	test("rejects unknown, incompatible, and forged expressions", async () => {
		for (const hostile of [
			{
				expression:
					"constraint.check<any>(({ fields }) => fields.missing.greaterThan(fields.startsAt))",
				diagnostic:
					/QP-SCHEMA-003 invalidReference: .* references unknown .*field:missing/,
			},
			{
				expression:
					"constraint.check<any>(({ fields }) => fields.endsAt.greaterThan(fields.sequence))",
				diagnostic:
					/QP-SCHEMA-001 invalidDefinition: .* requires compatible ordered Fields/,
			},
			{
				expression:
					'({ kind: "check", expression: { kind: "or", expressions: [] }, postgresName: null } as any)',
				diagnostic:
					/QP-SCHEMA-001 invalidDefinition: .* has unsupported check expression or/,
			},
		] as const) {
			const temporary = await mkdtemp(join(tmpdir(), "questpie-bad-check-"));
			try {
				await cp(fixtureRoot, temporary, { recursive: true });
				await writeFile(
					join(temporary, "src/check-appointments.ts"),
					appointmentSource(hostile.expression),
				);
				await expect(
					compileApplication({ applicationRoot: temporary }),
				).rejects.toThrow(hostile.diagnostic);
			} finally {
				await rm(temporary, { recursive: true });
			}
		}
	});
});
