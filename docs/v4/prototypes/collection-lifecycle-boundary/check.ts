import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { createHash } from "node:crypto";

type IssueIdentity = `collection:${string}/issue:${string}`;
type DeclaredError = Readonly<{ code: string; status: number }>;
type Instruction =
	| Readonly<{ op: "trim"; field: string }>
	| Readonly<{ op: "upper"; field: string }>
	| Readonly<{
			op: "issueIf";
			field: string;
			equals: unknown;
			unlessField: string;
			unlessEquals: unknown;
			issue: IssueIdentity;
	  }>;

class CollectionIssue extends Error {
	constructor(readonly identity: IssueIdentity) {
		super("Collection lifecycle issue");
	}
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, member]) => `${JSON.stringify(key)}:${canonical(member)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}

function digest(program: readonly Instruction[]): string {
	return createHash("sha256")
		.update("questpie.collection-lifecycle-program.v1\0")
		.update(canonical(program))
		.digest("hex");
}

function execute(
	program: readonly Instruction[],
	input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const output = { ...input };
	for (const instruction of program) {
		if (instruction.op === "trim" || instruction.op === "upper") {
			const value = output[instruction.field];
			if (typeof value !== "string") throw new TypeError("invalid scalar");
			output[instruction.field] =
				instruction.op === "trim" ? value.trim() : value.toUpperCase();
			continue;
		}
		if (
			output[instruction.field] === instruction.equals &&
			output[instruction.unlessField] === instruction.unlessEquals
		)
			throw new CollectionIssue(instruction.issue);
	}
	return Object.freeze(output);
}

function mapAfterRollback(
	error: unknown,
	mappings: ReadonlyMap<IssueIdentity, DeclaredError>,
): DeclaredError {
	if (error instanceof CollectionIssue) {
		const mapped = mappings.get(error.identity);
		if (mapped) return mapped;
	}
	return Object.freeze({ code: "INTERNAL", status: 500 });
}

const issue = "collection:tickets/issue:closedWithoutTime" as const;
const program = Object.freeze([
	Object.freeze({ op: "trim", field: "summary" }),
	Object.freeze({ op: "upper", field: "reference" }),
	Object.freeze({
		op: "issueIf",
		field: "status",
		equals: "closed",
		unlessField: "closedAt",
		unlessEquals: null,
		issue,
	}),
] satisfies readonly Instruction[]);

deepStrictEqual(
	execute(program, {
		summary: "  Need help  ",
		reference: "sd-42",
		status: "open",
		closedAt: null,
	}),
	{
		summary: "Need help",
		reference: "SD-42",
		status: "open",
		closedAt: null,
	},
);
strictEqual(digest(program), digest(program.toReversed().toReversed()));
strictEqual(digest(program).length, 64);

let raised: unknown;
try {
	execute(program, {
		summary: "x",
		reference: "x",
		status: "closed",
		closedAt: null,
	});
} catch (error) {
	raised = error;
}

deepStrictEqual(
	mapAfterRollback(
		raised,
		new Map([[issue, { code: "TICKET_TRANSITION_REJECTED", status: 409 }]]),
	),
	{ code: "TICKET_TRANSITION_REJECTED", status: 409 },
);
deepStrictEqual(
	mapAfterRollback(
		raised,
		new Map([[issue, { code: "TICKET_INVALID_ON_CREATE", status: 422 }]]),
	),
	{ code: "TICKET_INVALID_ON_CREATE", status: 422 },
);
deepStrictEqual(mapAfterRollback(raised, new Map()), {
	code: "INTERNAL",
	status: 500,
});
deepStrictEqual(
	mapAfterRollback(
		new CollectionIssue("collection:secrets/issue:rowExists"),
		new Map(),
	),
	{ code: "INTERNAL", status: 500 },
);

throws(
	() =>
		execute(program, {
			summary: 42,
			reference: "x",
			status: "open",
			closedAt: null,
		}),
	TypeError,
);

console.log("collection lifecycle boundary prototype: PASS");
