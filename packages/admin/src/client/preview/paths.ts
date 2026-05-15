import type { CollectionSchema, FieldSchema } from "questpie/client";

type FieldMetadataLike = {
	type?: string;
	nestedFields?: Record<string, FieldMetadataLike>;
};

type FieldSchemaLike = Pick<FieldSchema, "metadata">;

type BlockSchemaLike = {
	fields?: Record<string, FieldSchemaLike>;
};

type ResolveKnownPreviewPathOptions = {
	schema?: Pick<CollectionSchema, "fields">;
	blocks?: Record<string, BlockSchemaLike> | null;
	values?: unknown;
	previousValues?: unknown;
};

export function resolveKnownPreviewPath(
	path: string | undefined,
	{ schema, blocks, values, previousValues }: ResolveKnownPreviewPathOptions,
): string | undefined {
	if (!schema?.fields || !isSafePreviewPath(path)) {
		return undefined;
	}

	const segments = path!.split(".");
	const [fieldName, ...rest] = segments;
	if (!fieldName) return undefined;

	const field = schema.fields[fieldName];
	if (!field) return undefined;

	if (rest.length === 0) {
		return fieldName;
	}

	if (
		resolveFieldPath({
			field,
			fieldName,
			segments: rest,
			blocks,
			values,
			previousValues,
		})
	) {
		return path;
	}

	return undefined;
}

function isSafePreviewPath(path: string | undefined): path is string {
	if (!path || path.length > 512) return false;

	return path
		.split(".")
		.every(
			(segment) =>
				segment.length > 0 &&
				segment !== "__proto__" &&
				segment !== "prototype" &&
				segment !== "constructor",
		);
}

function resolveFieldPath({
	field,
	fieldName,
	segments,
	blocks,
	values,
	previousValues,
}: {
	field: FieldSchemaLike;
	fieldName: string;
	segments: string[];
	blocks?: Record<string, BlockSchemaLike> | null;
	values?: unknown;
	previousValues?: unknown;
}) {
	const metadata = field.metadata as FieldMetadataLike | undefined;
	if (!metadata) return false;

	if (metadata.type === "blocks") {
		return resolveBlocksPath({
			fieldName,
			segments,
			blocks,
			values,
			previousValues,
		});
	}

	return resolveMetadataPath(metadata, segments);
}

function resolveMetadataPath(
	metadata: FieldMetadataLike,
	segments: string[],
): boolean {
	if (segments.length === 0) {
		return true;
	}

	if (metadata.type === "richText" || metadata.type === "json") {
		return true;
	}

	if (metadata.type === "object") {
		const [fieldName, ...rest] = segments;
		const nested = fieldName ? metadata.nestedFields?.[fieldName] : undefined;
		return nested ? resolveMetadataPath(nested, rest) : false;
	}

	if (metadata.type === "array") {
		const [first, ...rest] = segments;
		const itemSegments = first && isArrayIndex(first) ? rest : segments;
		if (itemSegments.length === 0) {
			return true;
		}

		const [fieldName, ...fieldRest] = itemSegments;
		const nested = fieldName ? metadata.nestedFields?.[fieldName] : undefined;
		return nested ? resolveMetadataPath(nested, fieldRest) : false;
	}

	return false;
}

function resolveBlocksPath({
	fieldName,
	segments,
	blocks,
	values,
	previousValues,
}: {
	fieldName: string;
	segments: string[];
	blocks?: Record<string, BlockSchemaLike> | null;
	values?: unknown;
	previousValues?: unknown;
}) {
	const [section, blockId, blockFieldName, ...rest] = segments;

	if (section === "_tree") {
		return true;
	}

	if (section !== "_values" || !blockId || !blockFieldName) {
		return false;
	}

	const blockType =
		findBlockTypeById(readPath(values, `${fieldName}._tree`), blockId) ??
		findBlockTypeById(readPath(previousValues, `${fieldName}._tree`), blockId);
	if (!blockType) {
		return false;
	}

	const blockField = blocks?.[blockType]?.fields?.[blockFieldName];
	if (!blockField) {
		return false;
	}

	return resolveMetadataPath(blockField.metadata as FieldMetadataLike, rest);
}

function findBlockTypeById(tree: unknown, blockId: string): string | undefined {
	if (!Array.isArray(tree)) {
		return undefined;
	}

	for (const node of tree) {
		if (!node || typeof node !== "object") {
			continue;
		}

		const record = node as {
			id?: unknown;
			type?: unknown;
			children?: unknown;
		};

		if (record.id === blockId && typeof record.type === "string") {
			return record.type;
		}

		const childType = findBlockTypeById(record.children, blockId);
		if (childType) {
			return childType;
		}
	}

	return undefined;
}

function readPath(value: unknown, path: string): unknown {
	let current = value;

	for (const segment of path.split(".")) {
		if (!current || typeof current !== "object") {
			return undefined;
		}

		current = (current as Record<string, unknown>)[segment];
	}

	return current;
}

function isArrayIndex(segment: string): boolean {
	return /^(0|[1-9]\d*)$/.test(segment);
}
