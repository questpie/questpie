type RecordValue = Readonly<Record<string, unknown>>;

const digestPattern = /^[0-9a-f]{64}$/;
const identity = (kind: string) => new RegExp(`^collection:[^/]+/${kind}:.+$`);
const collectionPattern = /^collection:.+$/;

function fail(label: string): never {
	throw new TypeError(
		`Invalid Collection Mutation program: ${label} is invalid`,
	);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(label);
	return value as RecordValue;
}

function exact(
	value: RecordValue,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => key !== actual[index])
	)
		fail(`${label} keys`);
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) fail(label);
	return value;
}

function text(value: unknown, label: string, pattern?: RegExp): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		(pattern && !pattern.test(value))
	)
		fail(label);
	return value;
}

function nullableInteger(value: unknown, label: string): void {
	if (value !== null && !Number.isSafeInteger(value)) fail(label);
}

function codec(value: unknown, label: string): void {
	const item = record(value, label);
	if (["uuid", "boolean", "date"].includes(String(item.kind))) {
		exact(item, ["kind"], label);
		return;
	}
	if (item.kind === "text") {
		exact(item, ["kind", "minLength", "maxLength", "collation"], label);
		nullableInteger(item.minLength, `${label} minLength`);
		nullableInteger(item.maxLength, `${label} maxLength`);
		if (item.collation !== "questpie.binary") fail(`${label} collation`);
		return;
	}
	if (item.kind === "integer") {
		exact(item, ["kind", "minimum", "maximum"], label);
		nullableInteger(item.minimum, `${label} minimum`);
		nullableInteger(item.maximum, `${label} maximum`);
		return;
	}
	if (item.kind === "bigint") {
		exact(item, ["kind", "minimum", "maximum"], label);
		for (const key of ["minimum", "maximum"])
			if (item[key] !== null && typeof item[key] !== "string") fail(label);
		return;
	}
	if (item.kind === "numeric") {
		exact(item, ["kind", "precision", "scale"], label);
		if (
			!Number.isSafeInteger(item.precision) ||
			!Number.isSafeInteger(item.scale)
		)
			fail(label);
		return;
	}
	if (item.kind === "timestamp") {
		exact(item, ["kind", "withTimezone"], label);
		if (typeof item.withTimezone !== "boolean") fail(label);
		return;
	}
	fail(`${label} kind`);
}

function parameter(value: unknown, label: string): void {
	const item = record(value, label);
	text(item.name, `${label} name`);
	if (item.kind === "cursor") {
		exact(item, ["name", "kind", "nullable"], label);
		if (item.nullable !== true) fail(label);
		return;
	}
	if (item.kind === "scalar") {
		exact(item, ["name", "kind", "codec", "nullable"], label);
		if (item.nullable !== false) fail(label);
		codec(item.codec, `${label} codec`);
		return;
	}
	if (item.kind === "list") {
		exact(
			item,
			["name", "kind", "codec", "maximumItems", "nullable", "semantics"],
			label,
		);
		if (
			item.nullable !== false ||
			item.semantics !== "set" ||
			!Number.isSafeInteger(item.maximumItems) ||
			(item.maximumItems as number) <= 0
		)
			fail(label);
		codec(item.codec, `${label} codec`);
		return;
	}
	fail(`${label} kind`);
}

function operand(value: unknown, label: string): void {
	const item = record(value, label);
	if (item.kind === "parameter") {
		exact(item, ["kind", "parameter"], label);
		text(item.parameter, `${label} parameter`);
		return;
	}
	exact(item, ["kind", "codec", "value"], label);
	if (
		item.kind !== "literal" ||
		!["boolean", "number", "string"].includes(typeof item.value)
	)
		fail(label);
	codec(item.codec, `${label} codec`);
}

function filter(value: unknown, label: string, related: boolean): void {
	const item = record(value, label);
	if (item.kind === "and" || item.kind === "or") {
		exact(item, ["kind", "expressions"], label);
		array(item.expressions, `${label} expressions`).forEach((entry, index) =>
			filter(entry, `${label} expression ${index}`, related),
		);
		return;
	}
	if (item.kind === "not") {
		exact(item, ["kind", "expression"], label);
		filter(item.expression, `${label} expression`, related);
		return;
	}
	if (
		!related &&
		(item.kind === "relationExists" || item.kind === "relationNotExists")
	) {
		exact(item, ["kind", "relation", "filter"], label);
		text(item.relation, `${label} relation`, identity("relation"));
		const nested = record(item.filter, `${label} filter`);
		if (nested.kind === "true") exact(nested, ["kind"], `${label} filter`);
		else filter(nested, `${label} filter`, true);
		return;
	}
	text(item.field, `${label} field`, identity("field"));
	if (item.kind === "isNull" || item.kind === "isNotNull") {
		exact(item, ["kind", "field"], label);
		return;
	}
	if (item.kind === "in" || item.kind === "notIn") {
		exact(item, ["kind", "field", "set"], label);
		const set = record(item.set, `${label} set`);
		if (set.kind === "parameter") {
			exact(set, ["kind", "parameter"], `${label} set`);
			text(set.parameter, `${label} set parameter`);
		} else {
			exact(set, ["kind", "codec", "values"], `${label} set`);
			if (set.kind !== "literal") fail(`${label} set`);
			codec(set.codec, `${label} set codec`);
			array(set.values, `${label} set values`).forEach((entry) => {
				if (!["boolean", "number", "string"].includes(typeof entry))
					fail(`${label} set value`);
			});
		}
		return;
	}
	if (
		![
			"equal",
			"notEqual",
			"lessThan",
			"lessThanOrEqual",
			"greaterThan",
			"greaterThanOrEqual",
		].includes(String(item.kind))
	)
		fail(`${label} kind`);
	exact(item, ["kind", "field", "operand"], label);
	operand(item.operand, `${label} operand`);
}

function selection(value: unknown, label: string, nested = false): void {
	const item = record(value, label);
	if (item.kind === "field") {
		exact(item, ["kind", "key", "field"], label);
		text(item.key, `${label} key`);
		text(item.field, `${label} field`, identity("field"));
		return;
	}
	if (nested) fail(`${label} kind`);
	exact(item, ["kind", "key", "relation", "select"], label);
	if (item.kind !== "toOne") fail(`${label} kind`);
	text(item.key, `${label} key`);
	text(item.relation, `${label} relation`, identity("relation"));
	array(item.select, `${label} select`).forEach((entry, index) =>
		selection(entry, `${label} field ${index}`, true),
	);
}

export function decodeMutationDataQueryTemplate(
	value: unknown,
	label: string,
): RecordValue {
	const query = record(value, label);
	exact(
		query,
		[
			"format",
			"version",
			"from",
			"schemaProjectionDigest",
			"dataContractProjectionDigest",
			"parameters",
			"select",
			"filter",
			"order",
			"page",
		],
		label,
	);
	if (query.format !== "questpie.data-query-template" || query.version !== 1)
		fail(`${label} header`);
	text(query.from, `${label} from`, collectionPattern);
	text(query.schemaProjectionDigest, `${label} schema digest`, digestPattern);
	text(
		query.dataContractProjectionDigest,
		`${label} data-contract digest`,
		digestPattern,
	);
	const parameters = array(query.parameters, `${label} parameters`);
	parameters.forEach((entry, index) =>
		parameter(entry, `${label} parameter ${index}`),
	);
	const names = parameters.map((entry) => record(entry, label).name);
	if (new Set(names).size !== names.length) fail(`${label} parameter names`);
	array(query.select, `${label} select`).forEach((entry, index) =>
		selection(entry, `${label} selection ${index}`),
	);
	if (query.filter !== null) filter(query.filter, `${label} filter`, false);
	array(query.order, `${label} order`).forEach((entry, index) => {
		const item = record(entry, `${label} order ${index}`);
		exact(item, ["field", "direction", "nulls"], `${label} order ${index}`);
		text(item.field, `${label} order field`, identity("field"));
		if (
			!["asc", "desc"].includes(String(item.direction)) ||
			!["first", "last"].includes(String(item.nulls))
		)
			fail(`${label} order ${index}`);
	});
	const page = record(query.page, `${label} page`);
	exact(page, ["kind", "first", "after", "uniqueConstraint"], `${label} page`);
	if (page.kind !== "forwardCursor") fail(`${label} page kind`);
	for (const name of ["first", "after"] as const) {
		const reference = record(page[name], `${label} page ${name}`);
		exact(reference, ["kind", "parameter"], `${label} page ${name}`);
		if (reference.kind !== "parameter") fail(`${label} page ${name}`);
		text(reference.parameter, `${label} page ${name} parameter`);
	}
	text(
		page.uniqueConstraint,
		`${label} page uniqueConstraint`,
		identity("constraint"),
	);
	return query;
}
