import { compareAscii } from "./canonical";

type RecordValue = Readonly<Record<string, unknown>>;

interface DataTypeNode {
	field?: RecordValue;
	children: Map<string, DataTypeNode>;
}

function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("expected an object while rendering declarations");
	return value as RecordValue;
}

function literalType(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "number")
		return JSON.stringify(value);
	if (typeof value === "boolean") return String(value);
	if (Array.isArray(value))
		return `readonly [${value.map(literalType).join(", ")}]`;
	return `Readonly<{ ${Object.entries(record(value))
		.sort(([left], [right]) => compareAscii(left, right))
		.map(
			([key, child]) =>
				`readonly ${JSON.stringify(key)}: ${literalType(child)};`,
		)
		.join(" ")} }>`;
}

function dataCodecType(value: unknown): string {
	const codec = record(value);
	let type: string;
	if (
		codec.kind === "uuid" ||
		codec.kind === "text" ||
		codec.kind === "bigint" ||
		codec.kind === "numeric" ||
		codec.kind === "date" ||
		codec.kind === "timestamp"
	)
		type = "string";
	else if (codec.kind === "boolean") type = "boolean";
	else if (codec.kind === "integer") type = "number";
	else if (codec.kind === "json") type = "TaggedJsonValue";
	else if (codec.kind === "array") {
		const item = dataCodecType(codec.items);
		type = `ReadonlyArray<${item}>`;
	} else if (codec.kind === "object") {
		const rawProperties = codec.properties;
		const properties = Array.isArray(rawProperties)
			? rawProperties.map((item) => {
					const property = record(item);
					return [String(property.key), property.codec] as const;
				})
			: Object.entries(record(rawProperties));
		type = `Readonly<{ ${properties
			.sort(([left], [right]) => compareAscii(left, right))
			.map(
				([key, child]) =>
					`readonly ${JSON.stringify(key)}: ${dataCodecType(child)};`,
			)
			.join(" ")} }>`;
	} else type = "never";
	return codec.nullable === true ? `${type} | null` : type;
}

function dataTree(fields: readonly unknown[]): DataTypeNode {
	const root: DataTypeNode = { children: new Map() };
	for (const rawField of fields) {
		const field = record(rawField);
		const path = field.path as readonly string[];
		let node = root;
		for (const segment of path) {
			let child = node.children.get(segment);
			if (!child) {
				child = { children: new Map() };
				node.children.set(segment, child);
			}
			node = child;
		}
		node.field = field;
	}
	return root;
}

function insertOptional(node: DataTypeNode): boolean {
	if (node.field)
		return node.field.nullable === true || node.field.hasDefault === true;
	return [...node.children.values()].every(insertOptional);
}

function renderDataTree(
	node: DataTypeNode,
	mode: "fields" | "insert" | "row" | "update",
): string {
	if (node.field) {
		const value = dataCodecType(node.field.codec);
		if (mode === "fields")
			return `DataFieldDescriptor<${JSON.stringify(node.field.identity)}, ${literalType(node.field.codec)}, ${value}, ${String(node.field.nullable === true)}, ${String(node.field.hasDefault === true)}>`;
		return node.field.nullable === true ? `${value} | null` : value;
	}
	return `Readonly<{ ${[...node.children.entries()]
		.sort(([left], [right]) => compareAscii(left, right))
		.map(([key, child]) => {
			const optional =
				mode === "update" || (mode === "insert" && insertOptional(child));
			return `readonly ${JSON.stringify(key)}${optional ? "?" : ""}: ${renderDataTree(child, mode)};`;
		})
		.join(" ")} }>`;
}

function renderUniqueConstraints(
	collection: RecordValue,
	schemaCollection: RecordValue,
): string {
	const collectionIdentity = String(collection.identity);
	const paths = new Map(
		(collection.fields as readonly unknown[]).map((rawField) => {
			const field = record(rawField);
			return [String(field.identity), field.path as readonly string[]] as const;
		}),
	);
	return `Readonly<{ ${(
		(schemaCollection.constraints ?? []) as readonly unknown[]
	)
		.map(record)
		.filter(
			(constraint) =>
				constraint.kind === "primaryKey" || constraint.kind === "unique",
		)
		.sort((left, right) =>
			compareAscii(String(left.identity), String(right.identity)),
		)
		.map((constraint) => {
			const fields = (constraint.fields as readonly string[]).map(
				(identity) => {
					const path = paths.get(identity) ?? [];
					return path.length === 1
						? JSON.stringify(path[0])
						: literalType(path);
				},
			);
			const key = String(constraint.identity).slice(
				`${collectionIdentity}/constraint:`.length,
			);
			return `readonly ${JSON.stringify(key)}: Readonly<{ readonly kind: ${JSON.stringify(constraint.kind)}; readonly identity: ${JSON.stringify(constraint.identity)}; readonly fields: readonly [${fields.join(", ")}]; }>;`;
		})
		.join(" ")} }>`;
}

export function renderCoreDataContract(data: unknown, schema: unknown): string {
	const dataProjection = record(data);
	const schemaProjection = record(schema);
	const collections = (dataProjection.collections as readonly unknown[])
		.map(record)
		.sort((left, right) =>
			compareAscii(String(left.identity), String(right.identity)),
		)
		.map((collection) => {
			const identity = String(collection.identity);
			const name = identity.slice("collection:".length);
			const schemaCollection = (
				schemaProjection.collections as readonly unknown[]
			)
				.map(record)
				.find((candidate) => candidate.identity === identity);
			if (!schemaCollection)
				throw new TypeError(`missing Schema Collection ${identity}`);
			const tree = dataTree(collection.fields as readonly unknown[]);
			return `readonly ${JSON.stringify(name)}: Readonly<{ readonly name: ${JSON.stringify(name)}; readonly identity: ${JSON.stringify(identity)}; readonly fields: ${renderDataTree(tree, "fields")}; readonly uniqueConstraints: ${renderUniqueConstraints(collection, schemaCollection)}; readonly row: ${renderDataTree(tree, "row")}; readonly insert: ${renderDataTree(tree, "insert")}; readonly update: ${renderDataTree(tree, "update")}; readonly relations: Readonly<{}>; }>;`;
		})
		.join("\n\t\t\t");
	return `export interface AppContract {
	readonly data: Readonly<{
		readonly collections: Readonly<{
			${collections}
		}>;
	}>;
}

export type AppData = AppContract["data"];
`;
}
