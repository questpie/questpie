import { deepStrictEqual, strictEqual, throws } from "node:assert";

type Provenance = Readonly<{
	immutable?: true;
	server?: true;
	nullable?: true;
	default?: unknown;
	normalize?: (value: unknown) => unknown;
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

function decodeExact(schema: Schema, values: ValueMap): void {
	for (const name of Object.keys(values)) {
		if (!schema[name]) throw new TypeError(`unknown Field: ${name}`);
	}
}

function authorizeLane(
	schema: Schema,
	mode: WriteMode,
	lane: Lane,
	values: ValueMap,
): void {
	for (const name of Object.keys(values)) {
		const field = schema[name]!;
		if (!accepts(field, mode, lane)) {
			throw new TypeError(`unsupported ${lane} Field: ${name}`);
		}
	}
}

function normalizeLane(schema: Schema, values: ValueMap): ValueMap {
	return Object.fromEntries(
		Object.entries(values).map(([name, value]) => {
			const normalize = schema[name]?.normalize;
			return [name, normalize ? normalize(value) : value];
		}),
	);
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
	decodeExact(options.schema, patch);
	decodeExact(options.schema, values);
	for (const name of Object.keys(patch)) {
		if (Object.hasOwn(values, name)) {
			throw new TypeError(`Field appears in patch and values: ${name}`);
		}
	}
	if (Object.keys(patch).length === 0 && Object.keys(values).length === 0) {
		throw new TypeError("empty update");
	}
	authorizeLane(options.schema, "update", "caller", patch);
	authorizeLane(options.schema, "update", "values", values);
	const candidate = Object.freeze({
		...options.current,
		...normalizeLane(options.schema, patch),
		...normalizeLane(options.schema, values),
	});
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
	decodeExact(options.schema, input);
	decodeExact(options.schema, values);
	for (const name of Object.keys(input)) {
		if (Object.hasOwn(values, name)) {
			throw new TypeError(`Field appears in input and values: ${name}`);
		}
	}
	authorizeLane(options.schema, "create", "caller", input);
	authorizeLane(options.schema, "create", "values", values);
	const candidateDraft: Record<string, unknown> = {
		...normalizeLane(options.schema, input),
	};
	for (const [name, field] of Object.entries(options.schema)) {
		if (Object.hasOwn(candidateDraft, name)) continue;
		if (Object.hasOwn(field, "default")) candidateDraft[name] = field.default;
		else if (field.nullable) candidateDraft[name] = null;
	}
	Object.assign(candidateDraft, normalizeLane(options.schema, values));
	const candidate = Object.freeze(candidateDraft);
	for (const [name, field] of Object.entries(options.schema)) {
		if (
			!field.nullable &&
			!Object.hasOwn(field, "default") &&
			!Object.hasOwn(candidate, name)
		) {
			throw new TypeError(`missing required Field: ${name}`);
		}
	}
	if (!options.policy(candidate))
		throw new TypeError("candidate Policy denied");
	return candidate;
}

const tickets = Object.freeze({
	id: { server: true, immutable: true },
	organizationId: { server: true, immutable: true },
	requesterId: { server: true },
	reference: { immutable: true },
	summary: {
		normalize: (value: unknown) => String(value).trim(),
	},
	status: {
		server: true,
		default: "open",
		normalize: (value: unknown) => String(value).toLowerCase(),
	},
	closedAt: {
		server: true,
		nullable: true,
		normalize: (value: unknown) => (value === "" ? null : value),
	},
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
	values: { status: "CLOSED", closedAt: "2026-08-28T00:00:00.000Z" },
	policy: (candidate) =>
		candidate.organizationId === "organization-1" &&
		candidate.status === "closed",
});
strictEqual(closed.status, "closed");

const reopened = update({
	schema: tickets,
	current: closed,
	values: { status: "OPEN", closedAt: "" },
	policy: (candidate) =>
		candidate.status === "open" && candidate.closedAt === null,
});
strictEqual(reopened.closedAt, null);

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
			patch: { ghost: "caller" },
			values: { ghost: "trusted" },
			policy: () => true,
		}),
	/unknown Field: ghost/,
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
throws(
	() =>
		create({
			schema: tickets,
			input: { reference: "SUP-2", summary: "Forged tenant" },
			values: {
				id: "ticket-2",
				organizationId: "organization-2",
				requesterId: "person-1",
			},
			policy: (candidate) => candidate.organizationId === "organization-1",
		}),
	/candidate Policy denied/,
);

const created = create({
	schema: tickets,
	input: { reference: "SUP-2", summary: "  Cannot sign in  " },
	values: {
		id: "ticket-2",
		organizationId: "organization-1",
		requesterId: "person-1",
	},
	policy: (candidate) => candidate.organizationId === "organization-1",
});
deepStrictEqual(created, {
	status: "open",
	closedAt: null,
	reference: "SUP-2",
	summary: "Cannot sign in",
	id: "ticket-2",
	organizationId: "organization-1",
	requesterId: "person-1",
});

console.log("collection provenance and trusted values prototype: PASS");
