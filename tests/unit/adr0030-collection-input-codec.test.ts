import { expect, test } from "bun:test";

import {
	constraint,
	defineCollection,
	field,
} from "../../packages/questpie/src";

test("Collection input helpers expose frozen exact codec selections", () => {
	const tickets = defineCollection({
		name: "tickets",
		fields: {
			id: field.uuid({ nullable: false, server: true, immutable: true }),
			reference: field.text({ nullable: false, immutable: true }),
			summary: field.text({ nullable: false }),
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
		"priority",
		"assigneeId",
	]);
	expect(Object.keys(update.properties)).toEqual([
		"summary",
		"priority",
		"assigneeId",
	]);
	expect(create.properties.reference.kind).toBe("text");
	expect(create.properties.priority.kind).toBe("optional");
	expect(create.properties.assigneeId.kind).toBe("optional");
	expect(Object.isFrozen(create)).toBe(true);
	expect(Object.isFrozen(create.properties)).toBe(true);
	expect(Object.keys(create.pick({ reference: true }).properties)).toEqual([
		"reference",
	]);
	expect(Object.keys(update.omit({ priority: true }).properties)).toEqual([
		"summary",
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
