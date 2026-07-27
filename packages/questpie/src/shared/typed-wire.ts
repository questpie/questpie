import superjson, { type SuperJSONValue } from "superjson";

export const QUESTPIE_TYPED_EVENT_WIRE_KEY = "__questpieTypedWire";
export const QUESTPIE_TYPED_EVENT_WIRE_VERSION = 1;

const MAX_DATE_PATHS = 16_384;
const MAX_DATE_PATH_DEPTH = 128;
const MAX_DATE_PATH_SEGMENT_LENGTH = 1_024;

type TypedEventWireMetadata = {
	version: typeof QUESTPIE_TYPED_EVENT_WIRE_VERSION;
	dates: string[][];
};

type WireRecord = Record<string, unknown>;

const isWireRecord = (value: unknown): value is WireRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasDataToJSON = (value: object): boolean => {
	let candidate: object | null = value;
	while (candidate) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, "toJSON");
		if (descriptor) {
			return "value" in descriptor && typeof descriptor.value === "function";
		}
		candidate = Object.getPrototypeOf(candidate) as object | null;
	}
	return false;
};

const collectDatePaths = (
	source: unknown,
	json: unknown,
	path: string[],
	paths: string[][],
	ancestors: Set<object>,
): void => {
	if (source instanceof Date) {
		if (
			Number.isFinite(source.getTime()) &&
			typeof json === "string" &&
			json === source.toISOString()
		) {
			paths.push(path);
		}
		return;
	}
	if (typeof source !== "object" || source === null || hasDataToJSON(source)) {
		return;
	}
	if (ancestors.has(source)) return;

	const jsonContainer =
		Array.isArray(json) || isWireRecord(json) ? json : undefined;
	if (!jsonContainer) return;

	ancestors.add(source);
	for (const key of Object.keys(jsonContainer)) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (!descriptor || !("value" in descriptor)) continue;
		collectDatePaths(
			descriptor.value,
			jsonContainer[key as keyof typeof jsonContainer],
			[...path, key],
			paths,
			ancestors,
		);
	}
	ancestors.delete(source);
};

const invalidTypedEventWire = (descriptor: unknown): Error => {
	const version = isWireRecord(descriptor)
		? String(descriptor.version)
		: "invalid";
	return new Error(`Unsupported QUESTPIE typed event wire version: ${version}`);
};

/**
 * Serialize a QUESTPIE-owned typed HTTP body.
 *
 * The SuperJSON envelope is intentionally used only when both endpoints opted
 * into the typed MIME contract. Plain JSON callers remain plain JSON.
 */
export const stringifyTypedWire = (value: unknown): string =>
	superjson.stringify(value as SuperJSONValue);

export const parseTypedWire = <T = unknown>(value: string): T =>
	superjson.parse<T>(value);

/**
 * Add exact Date paths to a framework-owned event record while retaining
 * JSON.stringify semantics for every other value. Older consumers therefore
 * continue to see the same top-level event and ISO strings at Date positions.
 */
export const serializeCompatibleTypedEventWire = (
	value: WireRecord,
): WireRecord => {
	if (Object.hasOwn(value, QUESTPIE_TYPED_EVENT_WIRE_KEY)) {
		throw new Error(
			`QUESTPIE typed event payload uses reserved metadata key "${QUESTPIE_TYPED_EVENT_WIRE_KEY}"`,
		);
	}

	const baseline = JSON.stringify(value);
	if (baseline === undefined) {
		throw new TypeError("QUESTPIE typed event wire requires an object payload");
	}
	const json = JSON.parse(baseline) as unknown;
	if (!isWireRecord(json)) {
		throw new TypeError("QUESTPIE typed event wire requires an object payload");
	}

	const dates: string[][] = [];
	collectDatePaths(value, json, [], dates, new Set());
	if (dates.length === 0) return json;
	if (dates.length > MAX_DATE_PATHS) {
		throw new Error("QUESTPIE typed event wire contains too many Date values");
	}

	const metadata: TypedEventWireMetadata = {
		version: QUESTPIE_TYPED_EVENT_WIRE_VERSION,
		dates,
	};
	return {
		...json,
		[QUESTPIE_TYPED_EVENT_WIRE_KEY]: metadata,
	};
};

export const stringifyCompatibleTypedEventWire = (value: WireRecord): string =>
	JSON.stringify(serializeCompatibleTypedEventWire(value));

export const deserializeCompatibleTypedEventWire = <T = unknown>(
	value: unknown,
): T => {
	if (!isWireRecord(value)) return value as T;

	const descriptor = value[QUESTPIE_TYPED_EVENT_WIRE_KEY];
	if (descriptor === undefined) return value as T;
	if (
		!isWireRecord(descriptor) ||
		descriptor.version !== QUESTPIE_TYPED_EVENT_WIRE_VERSION ||
		!Array.isArray(descriptor.dates) ||
		descriptor.dates.length > MAX_DATE_PATHS
	) {
		throw invalidTypedEventWire(descriptor);
	}

	const { [QUESTPIE_TYPED_EVENT_WIRE_KEY]: _metadata, ...wireJson } = value;
	const json = JSON.parse(JSON.stringify(wireJson)) as WireRecord;
	const seenPaths = new Set<string>();

	for (const candidate of descriptor.dates) {
		if (
			!Array.isArray(candidate) ||
			candidate.length === 0 ||
			candidate.length > MAX_DATE_PATH_DEPTH ||
			candidate.some(
				(segment) =>
					typeof segment !== "string" ||
					segment.length === 0 ||
					segment.length > MAX_DATE_PATH_SEGMENT_LENGTH,
			)
		) {
			throw invalidTypedEventWire(descriptor);
		}

		const pathKey = JSON.stringify(candidate);
		if (seenPaths.has(pathKey)) throw invalidTypedEventWire(descriptor);
		seenPaths.add(pathKey);

		let parent: unknown = json;
		for (const segment of candidate.slice(0, -1)) {
			if (
				typeof parent !== "object" ||
				parent === null ||
				!Object.hasOwn(parent, segment)
			) {
				throw invalidTypedEventWire(descriptor);
			}
			parent = (parent as WireRecord)[segment];
		}

		const leaf = candidate.at(-1)!;
		if (
			typeof parent !== "object" ||
			parent === null ||
			!Object.hasOwn(parent, leaf)
		) {
			throw invalidTypedEventWire(descriptor);
		}
		const encoded = (parent as WireRecord)[leaf];
		if (typeof encoded !== "string") throw invalidTypedEventWire(descriptor);
		const date = new Date(encoded);
		if (!Number.isFinite(date.getTime()) || date.toISOString() !== encoded) {
			throw invalidTypedEventWire(descriptor);
		}
		Object.defineProperty(parent, leaf, {
			configurable: true,
			enumerable: true,
			value: date,
			writable: true,
		});
	}

	return json as T;
};

export const parseCompatibleTypedEventWire = <T = unknown>(value: string): T =>
	deserializeCompatibleTypedEventWire<T>(JSON.parse(value));
