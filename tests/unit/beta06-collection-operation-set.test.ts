import { expect, test } from "bun:test";

import {
	constraint,
	defineCollection,
	defineCollectionOperations,
	definePolicy,
	field,
	mutation,
} from "questpie";

test("keeps Collection Operation Sets as immutable compiler shorthand, not Resources", () => {
	const messages = defineCollection({
		name: "messages",
		fields: {
			id: field.uuid({ nullable: false, default: "randomUuid" }),
			body: field.text({ nullable: false, maxLength: 8_192 }),
		},
		constraints: {
			primary: constraint.primaryKey({ fields: ["id"] }),
		},
	});
	const messagePolicy = definePolicy(messages, { name: "messages.default" });
	const get = { select: { id: true, body: true } } as const;

	const operations = defineCollectionOperations(messages, {
		name: "messages",
		policy: messagePolicy,
		network: true,
		get,
	});

	expect(operations).toEqual({
		kind: "collectionOperationSet",
		collection: messages,
		body: {
			name: "messages",
			policy: messagePolicy,
			network: true,
			get,
		},
	});
	expect(Object.isFrozen(operations)).toBe(true);
	expect(Object.isFrozen(operations.body)).toBe(true);
	expect("__questpie" in operations).toBe(false);

	const operand = { kind: "valueOperand", value: "principal-1" } as const;
	const assignment = mutation.overwrite(operand);
	expect(assignment).toEqual({ kind: "overwrite", value: operand });
	expect(Object.isFrozen(assignment)).toBe(true);
});
