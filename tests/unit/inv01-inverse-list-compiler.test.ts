import { expect, test } from "bun:test";

import { relationalDiscoverySource } from "../../packages/compiler/src/relational/discovery";

const primary = { kind: "primaryKey", fields: ["id"] } as const;
const scalar = { scalar: "uuid", nullable: false } as const;
const comments = {
	__questpie: { category: "definition", resourceKind: "collection" },
	name: "comments",
	fields: { id: scalar, body: { scalar: "text", nullable: false } },
	constraints: { primary },
	relations: {
		ticket: { kind: "toOne", target: "collection:tickets" },
	},
};
const tickets = {
	__questpie: { category: "definition", resourceKind: "collection" },
	name: "tickets",
	fields: { id: scalar },
	constraints: { primary },
	relations: {
		comments: {
			kind: "toMany",
			inverseOf: "collection:comments/relation:ticket",
		},
	},
};

function evaluateChild(
	child: Readonly<Record<string, unknown>>,
	extra: Readonly<Record<string, unknown>> = {},
): unknown {
	const first = { parameterKind: "integer", nullable: false };
	const after = { parameterKind: "cursor", nullable: true };
	const value = {
		kind: "dataQuery",
		template: {
			from: "tickets",
			parameters: { first, after },
			select: ({ fields }: { fields: Record<string, unknown> }) => ({
				id: fields.id,
				comments: child,
			}),
			where: null,
			orderBy: ({
				fields,
			}: {
				fields: Record<string, { ascending(options: unknown): unknown }>;
			}) => [fields.id!.ascending({ nulls: "last" })],
			page: () => ({ first, after }),
		},
	};
	return Function(
		"records",
		"value",
		`${relationalDiscoverySource}\nreturn compileDataQuery(value);`,
	)([{ exports: { comments, tickets, ...extra } }], value);
}

const accepted = {
	kind: "toManyList",
	source: "collection:comments",
	first: 10,
	orderBy: { id: "asc" },
	select: { id: true },
};

test.each([
	[{ ...accepted, source: "collection:labels" }, "QP-DATA-026"],
	[{ ...accepted, first: 51 }, "QP-DATA-026"],
	[{ ...accepted, select: {} }, "QP-DATA-026"],
	[{ ...accepted, orderBy: { body: "asc" } }, "QP-DATA-008"],
	[{ ...accepted, orderBy: { id: "sideways" } }, "QP-DATA-026"],
	[{ ...accepted, page: {} }, "QP-DATA-026"],
] as const)(
	"rejects an invalid inverse child before projection",
	(child, code) => {
		expect(() => evaluateChild(child)).toThrow(code);
	},
);

test("rejects a conditionally visible child order Field", () => {
	const policy = {
		__questpie: { category: "definition", resourceKind: "policy" },
		name: "comments.default",
		identity: "policy:comments.default",
		target: "collection:comments",
		body: {
			fields: {
				output: ({
					row,
				}: {
					row: Record<string, { equal(value: string): unknown }>;
				}) => ({ id: row.id!.equal("00000000-0000-0000-0000-000000000000") }),
			},
		},
	};
	expect(() => evaluateChild(accepted, { policy })).toThrow("QP-DATA-008");
});
