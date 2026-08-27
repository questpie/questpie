import { deepStrictEqual, strictEqual, throws } from "node:assert";

type Provenance = Readonly<{
	immutable?: true;
	server?: true;
	required?: true;
	default?: unknown;
}>;

type Schema = Readonly<Record<string, Provenance>>;
type ValueMap = Readonly<Record<string, unknown>>;

type WriteMode = "create" | "update";
type Lane = "caller" | "values";

function accepts(field: Provenance, mode: WriteMode, lane: Lane): boolean {
	if (lane === "caller") {
		if (field.server) return false;
		return mode === "create" || !field.immutable;
	}
	return mode === "create" || !field.immutable;
}

function fieldsFor(
	schema: Schema,
	mode: WriteMode,
	lane: Lane,
): readonly string[] {
	return Object.entries(schema)
		.filter(([, field]) => accepts(field, mode, lane))
		.map(([name]) => name)
		.sort();
}

function exactLane(
	schema: Schema,
	mode: WriteMode,
	lane: Lane,
	values: ValueMap,
): void {
	for (const name of Object.keys(values)) {
		const field = schema[name];
		if (!field || !accepts(field, mode, lane)) {
			throw new TypeError(`unsupported ${lane} Field: ${name}`);
		}
	}
}

type UpdateOptions = Readonly<{
	schema: Schema;
	current: ValueMap;
	patch?: ValueMap;
	values?: ValueMap;
	policy: (candidate: ValueMap) => boolean;
}>;

function update(options: UpdateOptions): ValueMap {
	const patch = options.patch ?? {};
	const values = options.values ?? {};
	exactLane(options.schema, "update", "caller", patch);
	exactLane(options.schema, "update", "values", values);
	for (const name of Object.keys(patch)) {
		if (Object.hasOwn(values, name)) {
			throw new TypeError(`Field appears in patch and values: ${name}`);
		}
	}
	if (Object.keys(patch).length === 0 && Object.keys(values).length === 0) {
		throw new TypeError("empty update");
	}
	const candidate = Object.freeze({ ...options.current, ...patch, ...values });
	if (!options.policy(candidate))
		throw new TypeError("candidate Policy denied");
	return candidate;
}

function create(
	options: Readonly<{
		schema: Schema;
		input?: ValueMap;
		values?: ValueMap;
		policy: (candidate: ValueMap) => boolean;
	}>,
): ValueMap {
	const input = options.input ?? {};
	const values = options.values ?? {};
	exactLane(options.schema, "create", "caller", input);
	exactLane(options.schema, "create", "values", values);
	for (const name of Object.keys(input)) {
		if (Object.hasOwn(values, name)) {
			throw new TypeError(`Field appears in input and values: ${name}`);
		}
	}
	const defaults = Object.fromEntries(
		Object.entries(options.schema)
			.filter(([, field]) => Object.hasOwn(field, "default"))
			.map(([name, field]) => [name, field.default]),
	);
	const candidate = Object.freeze({ ...defaults, ...input, ...values });
	for (const [name, field] of Object.entries(options.schema)) {
		if (field.required && !Object.hasOwn(candidate, name)) {
			throw new TypeError(`missing required Field: ${name}`);
		}
	}
	if (!options.policy(candidate))
		throw new TypeError("candidate Policy denied");
	return candidate;
}

const tickets = Object.freeze({
	id: { server: true, immutable: true, required: true },
	organizationId: { server: true, immutable: true, required: true },
	requesterId: { server: true, required: true },
	reference: { immutable: true, required: true },
	summary: { required: true },
	status: { server: true, required: true, default: "open" },
	closedAt: { server: true },
} satisfies Schema);

deepStrictEqual(fieldsFor(tickets, "create", "caller"), [
	"reference",
	"summary",
]);
deepStrictEqual(fieldsFor(tickets, "update", "caller"), ["summary"]);
deepStrictEqual(fieldsFor(tickets, "create", "values"), [
	"closedAt",
	"id",
	"organizationId",
	"reference",
	"requesterId",
	"status",
	"summary",
]);
deepStrictEqual(fieldsFor(tickets, "update", "values"), [
	"closedAt",
	"requesterId",
	"status",
	"summary",
]);

const current = Object.freeze({
	id: "ticket-1",
	organizationId: "organization-1",
	requesterId: "person-1",
	reference: "SUP-1",
	summary: "Printer offline",
	status: "open",
	closedAt: null,
});

const closed = update({
	schema: tickets,
	current,
	patch: {},
	values: { status: "closed", closedAt: "2026-08-28T00:00:00.000Z" },
	policy: (candidate) => candidate.organizationId === "organization-1",
});
strictEqual(closed.status, "closed");

throws(
	() =>
		update({
			schema: tickets,
			current,
			patch: { status: "closed" },
			policy: () => true,
		}),
	/unsupported caller Field: status/,
);
throws(
	() =>
		update({
			schema: tickets,
			current,
			patch: { reference: "SUP-2" },
			policy: () => true,
		}),
	/unsupported caller Field: reference/,
);
throws(
	() =>
		update({
			schema: tickets,
			current,
			patch: { summary: "Fixed" },
			values: { summary: "Forged" },
			policy: () => true,
		}),
	/Field appears in patch and values: summary/,
);
throws(
	() =>
		update({
			schema: tickets,
			current,
			values: { requesterId: "person-2" },
			policy: (candidate) => candidate.requesterId === "person-1",
		}),
	/candidate Policy denied/,
);
throws(
	() => update({ schema: tickets, current, policy: () => true }),
	/empty update/,
);
throws(
	() =>
		create({
			schema: tickets,
			input: { reference: "SUP-2", summary: "No id" },
			values: { organizationId: "organization-1", requesterId: "person-1" },
			policy: () => true,
		}),
	/missing required Field: id/,
);

const created = create({
	schema: tickets,
	input: { reference: "SUP-2", summary: "Cannot sign in" },
	values: {
		id: "ticket-2",
		organizationId: "organization-1",
		requesterId: "person-1",
	},
	policy: (candidate) => candidate.organizationId === "organization-1",
});
deepStrictEqual(created, {
	status: "open",
	reference: "SUP-2",
	summary: "Cannot sign in",
	id: "ticket-2",
	organizationId: "organization-1",
	requesterId: "person-1",
});

console.log("collection provenance and trusted values prototype: PASS");
