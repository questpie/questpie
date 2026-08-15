import type { SQL } from "bun";
import type { CollectionDefinition, ContextBootstrap } from "questpie";

import { executePostgresStatement } from "./postgres";

type RecordValue = Readonly<Record<string, unknown>>;

type BootstrapCodec =
	| Readonly<{ kind: "uuid" }>
	| Readonly<{
			kind: "text";
			minLength: number | null;
			maxLength: number | null;
	  }>
	| Readonly<{ kind: "boolean" }>
	| Readonly<{
			kind: "integer";
			minimum: number | null;
			maximum: number | null;
	  }>
	| Readonly<{ kind: "timestamp"; withTimezone: boolean }>
	| Readonly<{ kind: "unsupported" }>;

interface BootstrapField {
	readonly identity: string;
	readonly key: string;
	readonly postgresName: string;
	readonly nullable: boolean;
	readonly codec: BootstrapCodec;
}

interface BootstrapCollection {
	readonly identity: string;
	readonly postgresName: string;
	readonly fields: ReadonlyMap<string, BootstrapField>;
	readonly primaryKey: readonly BootstrapField[];
}

interface BootstrapLookup {
	readonly key: Readonly<Record<string, unknown>>;
	readonly select: Readonly<Record<string, unknown>>;
}

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const physicalNamePattern = /^[a-z][a-z0-9_]*$/;

function invalid(label: string): never {
	throw new TypeError(`invalid ContextBootstrap Schema Projection: ${label}`);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		invalid(label);
	return value as RecordValue;
}

function records(value: unknown, label: string): readonly RecordValue[] {
	if (!Array.isArray(value)) invalid(label);
	return value.map((item, index) => record(item, `${label}[${index}]`));
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) invalid(label);
	return value;
}

function physicalName(value: unknown, label: string): string {
	const name = string(value, label);
	if (
		!physicalNamePattern.test(name) ||
		Buffer.byteLength(name) > 63 ||
		name.startsWith("pg_") ||
		name.startsWith("questpie_")
	)
		invalid(label);
	return name;
}

function hasLoneUnicodeSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
	}
	return false;
}

function logicalKey(value: unknown, label: string): string {
	const key = string(value, label);
	if (hasLoneUnicodeSurrogate(key) || key.includes("\0")) invalid(label);
	return key;
}

function nullableBound(value: unknown, label: string): number | null {
	if (value === undefined || value === null) return null;
	if (!Number.isSafeInteger(value)) invalid(label);
	return value as number;
}

function codec(value: unknown, label: string): BootstrapCodec {
	const raw = record(value, label);
	if (raw.kind === "uuid" || raw.kind === "boolean") return { kind: raw.kind };
	if (raw.kind === "text")
		return {
			kind: "text",
			minLength: nullableBound(raw.minLength, `${label}.minLength`),
			maxLength: nullableBound(raw.maxLength, `${label}.maxLength`),
		};
	if (raw.kind === "integer")
		return {
			kind: "integer",
			minimum: nullableBound(raw.minimum, `${label}.minimum`),
			maximum: nullableBound(raw.maximum, `${label}.maximum`),
		};
	if (raw.kind === "timestamp") {
		if (typeof raw.withTimezone !== "boolean") invalid(`${label}.withTimezone`);
		return { kind: "timestamp", withTimezone: raw.withTimezone };
	}
	return { kind: "unsupported" };
}

function field(
	value: RecordValue,
	collectionIdentity: string,
	label: string,
): BootstrapField | null {
	const path = value.path;
	if (!Array.isArray(path) || path.length === 0) invalid(`${label}.path`);
	if (path.length !== 1) return null;
	const key = logicalKey(path[0], `${label}.path[0]`);
	const identity = string(value.identity, `${label}.identity`);
	if (identity !== `${collectionIdentity}/field:${key}`)
		invalid(`${label}.identity`);
	if (typeof value.nullable !== "boolean") invalid(`${label}.nullable`);
	return Object.freeze({
		identity,
		key,
		postgresName: physicalName(value.postgresName, `${label}.postgresName`),
		nullable: value.nullable,
		codec: codec(value.type, `${label}.type`),
	});
}

function projectCollection(
	value: RecordValue,
	index: number,
): BootstrapCollection {
	const label = `collections[${index}]`;
	const identity = string(value.identity, `${label}.identity`);
	if (
		!identity.startsWith("collection:") ||
		identity.length === "collection:".length
	)
		invalid(`${label}.identity`);
	const fields = new Map<string, BootstrapField>();
	const fieldsByIdentity = new Map<string, BootstrapField>();
	for (const [fieldIndex, rawField] of records(
		value.fields,
		`${label}.fields`,
	).entries()) {
		const projected = field(
			rawField,
			identity,
			`${label}.fields[${fieldIndex}]`,
		);
		if (!projected) continue;
		if (fields.has(projected.key) || fieldsByIdentity.has(projected.identity))
			invalid(`${label}.fields contains a duplicate top-level Field`);
		fields.set(projected.key, projected);
		fieldsByIdentity.set(projected.identity, projected);
	}
	const primaryConstraints = records(
		value.constraints,
		`${label}.constraints`,
	).filter((constraint) => constraint.kind === "primaryKey");
	if (primaryConstraints.length !== 1)
		invalid(`${label} must contain exactly one primary key`);
	const primaryIdentities = primaryConstraints[0]?.fields;
	if (!Array.isArray(primaryIdentities) || primaryIdentities.length === 0)
		invalid(`${label} primary key Fields`);
	const seenPrimary = new Set<string>();
	const primaryKey = primaryIdentities.map((fieldIdentity, fieldIndex) => {
		const candidate = string(
			fieldIdentity,
			`${label}.primaryKey.fields[${fieldIndex}]`,
		);
		const projected = fieldsByIdentity.get(candidate);
		if (!projected || projected.nullable || seenPrimary.has(candidate))
			invalid(`${label} primary key Field`);
		seenPrimary.add(candidate);
		return projected;
	});
	return Object.freeze({
		identity,
		postgresName: physicalName(value.postgresName, `${label}.postgresName`),
		fields,
		primaryKey: Object.freeze(primaryKey),
	});
}

function projectSchema(schema: unknown): Readonly<{
	postgresSchema: string;
	collections: ReadonlyMap<string, BootstrapCollection>;
}> {
	const raw = record(schema, "root");
	if (raw.format !== "questpie.schema-projection" || raw.version !== 1)
		invalid("format/version");
	const application = record(raw.application, "application");
	const collections = new Map<string, BootstrapCollection>();
	for (const [index, rawCollection] of records(
		raw.collections,
		"collections",
	).entries()) {
		const projected = projectCollection(rawCollection, index);
		if (collections.has(projected.identity))
			invalid(`duplicate ${projected.identity}`);
		collections.set(projected.identity, projected);
	}
	return Object.freeze({
		postgresSchema: physicalName(
			application.postgresSchema,
			"application.postgresSchema",
		),
		collections,
	});
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function exactKeys(value: unknown, label: string): readonly string[] {
	const source = record(value, label);
	return Object.keys(source).sort();
}

function validTimestamp(value: string, withTimezone: boolean): boolean {
	const pattern = withTimezone
		? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
		: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;
	if (!pattern.test(value)) return false;
	const comparable = withTimezone ? value : `${value}Z`;
	return new Date(comparable).toISOString() === comparable;
}

function decodeScalar(value: unknown, field: BootstrapField): unknown {
	if (value === null) {
		if (field.nullable) return null;
		throw new TypeError("invalid PostgreSQL ContextBootstrap value");
	}
	const codec = field.codec;
	if (
		codec.kind === "uuid" &&
		typeof value === "string" &&
		uuidPattern.test(value)
	)
		return value;
	if (codec.kind === "text" && typeof value === "string") {
		const length = Array.from(value).length;
		if (
			!hasLoneUnicodeSurrogate(value) &&
			value.normalize("NFC") === value &&
			(codec.minLength === null || length >= codec.minLength) &&
			(codec.maxLength === null || length <= codec.maxLength)
		)
			return value;
	}
	if (codec.kind === "boolean" && typeof value === "boolean") return value;
	if (
		codec.kind === "integer" &&
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		!Object.is(value, -0) &&
		value >= -2_147_483_648 &&
		value <= 2_147_483_647 &&
		(codec.minimum === null || value >= codec.minimum) &&
		(codec.maximum === null || value <= codec.maximum)
	)
		return value;
	if (codec.kind === "timestamp") {
		const normalized =
			value instanceof Date && !Number.isNaN(value.getTime())
				? codec.withTimezone
					? value.toISOString()
					: value.toISOString().slice(0, -1)
				: value;
		if (
			typeof normalized === "string" &&
			validTimestamp(normalized, codec.withTimezone)
		)
			return normalized;
	}
	throw new TypeError("invalid PostgreSQL ContextBootstrap value");
}

function fieldForUse(
	collection: BootstrapCollection,
	key: string,
	usage: "key" | "selected",
): BootstrapField {
	const field = collection.fields.get(key);
	if (!field) throw new TypeError(`unknown ${usage} Field in ContextBootstrap`);
	if (field.codec.kind === "unsupported")
		throw new TypeError(`unsupported ${usage} Field in ContextBootstrap`);
	return field;
}

function resolveCollection(
	collections: ReadonlyMap<string, BootstrapCollection>,
	definition: CollectionDefinition,
): BootstrapCollection {
	const candidate = record(definition, "ContextBootstrap Collection");
	const brand = record(
		candidate["__questpie"],
		"ContextBootstrap Collection brand",
	);
	if (
		brand.category !== "definition" ||
		brand.resourceKind !== "collection" ||
		typeof candidate.name !== "string"
	)
		throw new TypeError("unknown ContextBootstrap Collection");
	const collection = collections.get(`collection:${candidate.name}`);
	if (!collection) throw new TypeError("unknown ContextBootstrap Collection");
	return collection;
}

export function createPostgresContextBootstrap(
	input: Readonly<{
		sql: SQL;
		schema: unknown;
		signal?: AbortSignal;
	}>,
): ContextBootstrap {
	const projection = projectSchema(input.schema);
	const get = async (
		definition: CollectionDefinition,
		lookup: BootstrapLookup,
	): Promise<Readonly<Record<string, unknown>> | null> => {
		input.signal?.throwIfAborted();
		const collection = resolveCollection(projection.collections, definition);
		const suppliedKeyNames = exactKeys(lookup?.key, "lookup.key");
		const requiredKeyNames = collection.primaryKey
			.map((field) => field.key)
			.sort();
		if (
			suppliedKeyNames.length !== requiredKeyNames.length ||
			suppliedKeyNames.some((key, index) => key !== requiredKeyNames[index])
		)
			throw new TypeError("ContextBootstrap requires the exact primary key");
		const selectedKeys = exactKeys(lookup?.select, "lookup.select");
		if (selectedKeys.length === 0)
			throw new TypeError("ContextBootstrap requires selected Fields");
		const selectedFields = selectedKeys.map((key) => {
			if (lookup.select[key] !== true)
				throw new TypeError("ContextBootstrap selected Fields must be true");
			return fieldForUse(collection, key, "selected");
		});
		const parameters = collection.primaryKey.map((field) =>
			decodeScalar(lookup.key[field.key], field),
		);
		const statement = [
			`SELECT ${selectedFields
				.map(
					(field) =>
						`${quoteIdentifier(field.postgresName)} AS ${quoteIdentifier(field.key)}`,
				)
				.join(", ")}`,
			`FROM ${quoteIdentifier(projection.postgresSchema)}.${quoteIdentifier(collection.postgresName)}`,
			`WHERE ${collection.primaryKey
				.map(
					(field, index) =>
						`${quoteIdentifier(field.postgresName)} = $${index + 1}`,
				)
				.join(" AND ")}`,
			"LIMIT 1",
			"",
		].join("\n");
		const rows = await executePostgresStatement(input.sql, {
			statement,
			parameters,
			signal: input.signal,
		});
		input.signal?.throwIfAborted();
		if (rows.length === 0) return null;
		if (rows.length !== 1)
			throw new TypeError("invalid PostgreSQL ContextBootstrap row count");
		const row = record(rows[0], "PostgreSQL ContextBootstrap row");
		const rowKeys = Object.keys(row).sort();
		if (
			rowKeys.length !== selectedKeys.length ||
			rowKeys.some((key, index) => key !== selectedKeys[index])
		)
			throw new TypeError("invalid PostgreSQL ContextBootstrap row shape");
		return Object.freeze(
			Object.fromEntries(
				selectedFields.map((field) => [
					field.key,
					decodeScalar(row[field.key], field),
				]),
			),
		);
	};
	return Object.freeze({ get }) as ContextBootstrap;
}
