import { expect, test } from "bun:test";

import {
	constraint,
	defineCollection,
	field,
	value,
} from "../../packages/questpie/src";

test("Collection input helpers expose frozen exact codec selections", () => {
	const tickets = defineCollection({
		name: "tickets",
		fields: {
			id: field.uuid({ nullable: false, server: true, immutable: true }),
			reference: field.text({
				nullable: false,
				immutable: true,
				minLength: 3,
				maxLength: 32,
			}),
			summary: field.text({ nullable: false }),
			rating: field.integer({ nullable: false, minimum: 1, maximum: 5 }),
			priority: field.text({ nullable: false, default: "normal" }),
			assigneeId: field.uuid({ nullable: true }),
			status: field.text({ nullable: false, server: true }),
		},
		constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	});

	const create = tickets.createInput();
	const update = tickets.updateInput();
	expect(Object.keys(create.properties)).toEqual([
		"reference",
		"summary",
		"rating",
		"priority",
		"assigneeId",
	]);
	expect(Object.keys(update.properties)).toEqual([
		"summary",
		"rating",
		"priority",
		"assigneeId",
	]);
	expect(create.properties.reference).toEqual({
		kind: "text",
		maxLength: 32,
		minLength: 3,
	});
	expect(create.properties.rating).toEqual({
		kind: "integer",
		maximum: 5,
		minimum: 1,
	});
	expect(create.properties.priority.kind).toBe("optional");
	expect(create.properties.assigneeId.kind).toBe("optional");
	expect(Object.isFrozen(create)).toBe(true);
	expect(Object.isFrozen(create.properties)).toBe(true);
	expect(Object.keys(create.pick({ reference: true }).properties)).toEqual([
		"reference",
	]);
	expect(Object.keys(update.omit({ priority: true }).properties)).toEqual([
		"summary",
		"rating",
		"assigneeId",
	]);
	expect(() => create.pick({ missing: true } as never)).toThrow(
		"Collection input selector has unknown Field: missing",
	);
	expect(() => update.omit({ missing: true } as never)).toThrow(
		"Collection input selector has unknown Field: missing",
	);
	expect(() => create.pick({ reference: false } as never)).toThrow(
		"Collection input selector must select reference with true",
	);
});

test("Collection input helpers preserve every Field codec recursively", () => {
	const records = defineCollection({
		name: "records",
		fields: {
			id: field.uuid({ nullable: false }),
			title: field.text({ nullable: false, minLength: 2, maxLength: 40 }),
			active: field.boolean({ nullable: false }),
			rank: field.integer({ nullable: false, minimum: -4, maximum: 12 }),
			sequence: field.bigint({
				nullable: false,
				minimum: "-9",
				maximum: "99",
			}),
			amount: field.numeric({ nullable: false, precision: 12, scale: 3 }),
			occurredAt: field.timestamp({ nullable: false, withTimezone: true }),
			businessDate: field.date({ nullable: false }),
			profile: field.object({
				nullable: false,
				properties: {
					label: value.text({ nullable: false, maxLength: 24 }),
					count: value.integer({
						nullable: false,
						minimum: 1,
						maximum: 8,
					}),
					sequence: value.bigint({
						nullable: false,
						minimum: "1",
						maximum: "80",
					}),
					amount: value.numeric({
						nullable: false,
						precision: 6,
						scale: 2,
					}),
					seenAt: value.timestamp({ nullable: true, withTimezone: true }),
					businessDate: value.date({ nullable: false }),
					flags: value.array({
						nullable: false,
						items: value.boolean({ nullable: false }),
						maximumItems: 2,
					}),
					address: value.object({
						nullable: false,
						properties: {
							postcode: value.text({ nullable: false, minLength: 3 }),
						},
					}),
				},
			}),
			tags: field.array({
				nullable: false,
				items: value.uuid({ nullable: false }),
				maximumItems: 5,
			}),
			metadata: field.json({ nullable: false }),
		},
		constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	});

	expect(records.createInput().properties).toEqual({
		id: { kind: "uuid" },
		title: { kind: "text", minLength: 2, maxLength: 40 },
		active: { kind: "boolean" },
		rank: { kind: "integer", minimum: -4, maximum: 12 },
		sequence: { kind: "bigint", minimum: "-9", maximum: "99" },
		amount: { kind: "numeric", precision: 12, scale: 3 },
		occurredAt: { kind: "timestamp", withTimezone: true },
		businessDate: { kind: "date" },
		profile: {
			kind: "object",
			properties: {
				label: { kind: "text", maxLength: 24 },
				count: { kind: "integer", minimum: 1, maximum: 8 },
				sequence: { kind: "bigint", minimum: "1", maximum: "80" },
				amount: { kind: "numeric", precision: 6, scale: 2 },
				seenAt: {
					kind: "nullable",
					codec: { kind: "timestamp", withTimezone: true },
				},
				businessDate: { kind: "date" },
				flags: {
					kind: "array",
					items: { kind: "boolean" },
					maximum: 2,
				},
				address: {
					kind: "object",
					properties: {
						postcode: { kind: "text", minLength: 3 },
					},
				},
			},
		},
		tags: { kind: "array", items: { kind: "uuid" }, maximum: 5 },
		metadata: { kind: "json" },
	});
	expect(Object.isFrozen(records.createInput().properties.profile)).toBe(true);
	expect(
		Object.isFrozen(
			(records.createInput().properties.profile as { properties: object })
				.properties,
		),
	).toBe(true);
});

test("Collection input selectors use own Field keys only", () => {
	const records = defineCollection({
		name: "records",
		fields: {
			constructor: field.text({ nullable: false }),
			title: field.text({ nullable: false }),
		},
		constraints: { primary: constraint.primaryKey({ fields: ["title"] }) },
	});

	expect(Object.keys(records.createInput().omit({}).properties)).toEqual([
		"constructor",
		"title",
	]);
	expect(() => records.createInput().pick({ toString: true } as never)).toThrow(
		"Collection input selector has unknown Field: toString",
	);
});
