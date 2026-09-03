type WireField = Readonly<{
	number: number;
	value: number | Uint8Array;
	wire: number;
}>;

function fields(bytes: Uint8Array): readonly WireField[] {
	let offset = 0;
	const readVarint = (): number => {
		let value = 0;
		let shift = 0;
		for (;;) {
			const byte = bytes[offset++];
			if (byte === undefined) throw new Error("truncated OTLP protobuf");
			value += (byte & 0x7f) * 2 ** shift;
			if ((byte & 0x80) === 0) return value;
			shift += 7;
			if (shift > 49) throw new Error("oversized OTLP protobuf varint");
		}
	};
	const result: WireField[] = [];
	while (offset < bytes.length) {
		const tag = readVarint();
		const number = tag >>> 3;
		const wire = tag & 7;
		if (number === 0) throw new Error("invalid OTLP protobuf field");
		if (wire === 0) result.push({ number, value: readVarint(), wire });
		else if (wire === 1 || wire === 5) {
			const width = wire === 1 ? 8 : 4;
			if (offset + width > bytes.length)
				throw new Error("truncated fixed OTLP protobuf field");
			result.push({ number, value: bytes.slice(offset, offset + width), wire });
			offset += width;
		} else if (wire === 2) {
			const length = readVarint();
			if (offset + length > bytes.length)
				throw new Error("truncated embedded OTLP protobuf field");
			result.push({
				number,
				value: bytes.slice(offset, offset + length),
				wire,
			});
			offset += length;
		} else throw new Error(`unsupported OTLP protobuf wire type ${wire}`);
	}
	return result;
}

function embedded(bytes: Uint8Array, number: number): readonly Uint8Array[] {
	return fields(bytes).flatMap((field) =>
		field.number === number && field.wire === 2
			? [field.value as Uint8Array]
			: [],
	);
}

function text(bytes: Uint8Array, number: number): string | null {
	const value = embedded(bytes, number)[0];
	return value === undefined ? null : new TextDecoder().decode(value);
}

function integer(bytes: Uint8Array, number: number): number | null {
	const field = fields(bytes).find(
		(candidate) => candidate.number === number && candidate.wire === 0,
	);
	return field === undefined ? null : (field.value as number);
}

function hexadecimal(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function anyValue(bytes: Uint8Array): string | number | boolean | null {
	const stringValue = text(bytes, 1);
	if (stringValue !== null) return stringValue;
	const boolValue = integer(bytes, 2);
	if (boolValue !== null) return boolValue !== 0;
	const integerValue = integer(bytes, 3);
	if (integerValue !== null) return integerValue;
	return null;
}

function attributes(bytes: Uint8Array): Readonly<Record<string, unknown>> {
	return Object.freeze(
		Object.fromEntries(
			embedded(bytes, 1).map((keyValue) => {
				const key = text(keyValue, 1);
				const value = embedded(keyValue, 2)[0];
				if (key === null || value === undefined)
					throw new Error("invalid OTLP key/value");
				return [key, anyValue(value)];
			}),
		),
	);
}

export type NormalizedOtlpTrace = Readonly<{
	resources: readonly Readonly<Record<string, unknown>>[];
	spans: readonly Readonly<{
		attributes: Readonly<Record<string, unknown>>;
		kind: number;
		name: string;
		parent: string | null;
	}>[];
}>;

export type NormalizedOtlpSpanGraph = readonly Readonly<{
	attributes: Readonly<Record<string, unknown>>;
	links: readonly Readonly<{ spanId: string; traceId: string }>[];
	name: string;
	parentSpanId: string | null;
	spanId: string;
	traceId: string;
}>[];

export function normalizeOtlpSpanGraph(
	bytes: Uint8Array,
): NormalizedOtlpSpanGraph {
	return Object.freeze(
		embedded(bytes, 1).flatMap((resourceSpan) =>
			embedded(resourceSpan, 2).flatMap((scope) =>
				embedded(scope, 2).map((span) => {
					const traceId = embedded(span, 1)[0];
					const spanId = embedded(span, 2)[0];
					const parentSpanId = embedded(span, 4)[0];
					const name = text(span, 5);
					if (traceId === undefined || spanId === undefined || name === null)
						throw new Error("invalid OTLP span graph");
					return Object.freeze({
						attributes: Object.freeze(
							Object.fromEntries(
								embedded(span, 9).flatMap((keyValue) => {
									const key = text(keyValue, 1);
									const value = embedded(keyValue, 2)[0];
									return key === null || value === undefined
										? []
										: [[key, anyValue(value)] as const];
								}),
							),
						),
						links: Object.freeze(
							embedded(span, 13).map((link) => {
								const linkedTraceId = embedded(link, 1)[0];
								const linkedSpanId = embedded(link, 2)[0];
								if (linkedTraceId === undefined || linkedSpanId === undefined)
									throw new Error("invalid OTLP span link");
								return Object.freeze({
									spanId: hexadecimal(linkedSpanId),
									traceId: hexadecimal(linkedTraceId),
								});
							}),
						),
						name,
						parentSpanId:
							parentSpanId === undefined ? null : hexadecimal(parentSpanId),
						spanId: hexadecimal(spanId),
						traceId: hexadecimal(traceId),
					});
				}),
			),
		),
	);
}

export function normalizeOtlpTrace(bytes: Uint8Array): NormalizedOtlpTrace {
	const resourceSpans = embedded(bytes, 1);
	const resources = resourceSpans.map((entry) => {
		const resource = embedded(entry, 1)[0];
		if (resource === undefined) throw new Error("OTLP Resource is missing");
		return attributes(resource);
	});
	const rawSpans = resourceSpans.flatMap((entry) =>
		embedded(entry, 2).flatMap((scope) => embedded(scope, 2)),
	);
	const namesById = new Map(
		rawSpans.map((span) => {
			const id = embedded(span, 2)[0];
			const name = text(span, 5);
			if (id === undefined || name === null)
				throw new Error("invalid OTLP span");
			return [hexadecimal(id), name] as const;
		}),
	);
	const spans = rawSpans
		.map((span) => {
			const name = text(span, 5);
			const kind = integer(span, 6);
			if (name === null || kind === null) throw new Error("invalid OTLP span");
			const parentId = embedded(span, 4)[0];
			return Object.freeze({
				attributes: Object.freeze(
					Object.fromEntries(
						embedded(span, 9).flatMap((keyValue) => {
							const key = text(keyValue, 1);
							const value = embedded(keyValue, 2)[0];
							return key === null || value === undefined
								? []
								: [[key, anyValue(value)] as const];
						}),
					),
				),
				kind,
				name,
				parent:
					parentId === undefined
						? null
						: (namesById.get(hexadecimal(parentId)) ?? "external"),
			});
		})
		.sort((left, right) => left.name.localeCompare(right.name));
	return Object.freeze({ resources: Object.freeze(resources), spans });
}
