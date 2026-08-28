type RecordValue = Readonly<Record<string, unknown>>;

export type CollectionFieldCodecProjection = Readonly<{
	readonly kind: string;
	readonly [member: string]: unknown;
}>;

export type CollectionFieldCodecSource = "dataContract" | "schemaProjection";

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

function project(
	value: unknown,
	source: CollectionFieldCodecSource,
	embedded: boolean,
): CollectionFieldCodecProjection {
	const codec = record(
		value,
		source === "dataContract"
			? "Collection Field codec"
			: embedded
				? "embedded Field codec"
				: "Field codec",
	);
	const kind = source === "dataContract" ? String(codec.kind) : codec.kind;
	let projected: CollectionFieldCodecProjection;

	if (kind === "object") {
		const raw = codec.properties;
		if (source === "schemaProjection" && !Array.isArray(raw))
			throw new TypeError("embedded object properties must be an array");
		const entries = Array.isArray(raw)
			? raw.map((candidate) => {
					const property = record(candidate, "embedded object property");
					if (source === "schemaProjection" && typeof property.key !== "string")
						throw new TypeError("embedded object property key is invalid");
					return [
						String(property.key),
						project(property.codec, source, true),
					] as const;
				})
			: Object.entries(record(raw, "object properties")).map(
					([key, child]) => [key, project(child, source, true)] as const,
				);
		projected = Object.freeze({
			kind,
			properties: Object.freeze(Object.fromEntries(entries)),
		});
	} else if (kind === "array") {
		const maximum =
			source === "schemaProjection"
				? codec.maximumItems
				: (codec.maximum ?? codec.maximumItems);
		if (source === "schemaProjection" && !Number.isSafeInteger(maximum))
			throw new TypeError("embedded array maximumItems is invalid");
		projected = Object.freeze({
			kind,
			items: project(codec.items, source, true),
			...(maximum === undefined ? {} : { maximum }),
		});
	} else if (
		source === "dataContract" &&
		(kind === "nullable" || kind === "optional")
	) {
		projected = Object.freeze({
			kind,
			codec: project(codec.codec, source, true),
		});
	} else if (
		kind === "boolean" ||
		kind === "date" ||
		kind === "json" ||
		kind === "uuid" ||
		(source === "dataContract" && kind === "cursor")
	) {
		projected = Object.freeze({ kind });
	} else if (kind === "text") {
		projected = Object.freeze({
			kind,
			...(codec.minLength === undefined || codec.minLength === null
				? {}
				: { minLength: codec.minLength }),
			...(codec.maxLength === undefined || codec.maxLength === null
				? {}
				: { maxLength: codec.maxLength }),
		});
	} else if (kind === "integer" || kind === "bigint") {
		projected = Object.freeze({
			kind,
			...(codec.minimum === undefined || codec.minimum === null
				? {}
				: { minimum: codec.minimum }),
			...(codec.maximum === undefined || codec.maximum === null
				? {}
				: { maximum: codec.maximum }),
		});
	} else if (kind === "numeric") {
		projected = Object.freeze({
			kind,
			precision: codec.precision,
			scale: codec.scale,
		});
	} else if (kind === "timestamp") {
		projected = Object.freeze({
			kind,
			withTimezone: codec.withTimezone === true,
		});
	} else {
		throw new TypeError(
			source === "dataContract"
				? `unsupported Collection Operation codec ${String(kind)}`
				: "embedded Field codec is unsupported",
		);
	}

	return source === "schemaProjection" && embedded && codec.nullable === true
		? Object.freeze({ kind: "nullable", codec: projected })
		: projected;
}

/** Projects a Collection Field codec into the closed Operation codec shape. */
export function projectCollectionFieldCodec(
	value: unknown,
	source: CollectionFieldCodecSource,
): CollectionFieldCodecProjection {
	return project(value, source, false);
}
