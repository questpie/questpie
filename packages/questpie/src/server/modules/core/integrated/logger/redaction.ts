const REDACTED = "[Redacted]";
const SENSITIVE_KEY_SUFFIXES = [
	"authorization",
	"cookie",
	"password",
	"token",
	"secret",
	"apikey",
] as const;

interface RedactionPolicy {
	paths: string[][];
}

export function createRedactionPolicy(paths: string[] = []): RedactionPolicy {
	return { paths: paths.map(parsePath).filter((path) => path.length > 0) };
}

export function redactLogArgs(
	args: unknown[],
	policy: RedactionPolicy,
): unknown[] {
	const seen = new WeakMap<object, unknown>();
	return args.map((value, index) => {
		const redacted = redactValue(value, [], policy, seen);
		return index === 0 &&
			value !== null &&
			typeof value === "object" &&
			isError(value)
			? { err: redacted }
			: redacted;
	});
}

export function redactLogBindings(
	bindings: Record<string, unknown>,
	policy: RedactionPolicy,
): Record<string, unknown> {
	return redactValue(bindings, [], policy, new WeakMap()) as Record<
		string,
		unknown
	>;
}

function redactValue(
	value: unknown,
	path: string[],
	policy: RedactionPolicy,
	seen: WeakMap<object, unknown>,
): unknown {
	if (matchesPath(path, policy.paths)) return REDACTED;
	if (!value || typeof value !== "object") return value;
	const existing = seen.get(value);
	if (existing) return existing;
	const descriptors = getDescriptors(value);
	if (!descriptors) return "[Unserializable]";
	if (isError(value)) return serializeErrorDescriptors(descriptors);
	const supported = serializeSupportedValue(value, path, policy, seen);
	if (supported !== undefined) return supported;
	const clone: Record<string, unknown> | unknown[] = Array.isArray(value)
		? []
		: {};
	seen.set(value, clone);
	for (const [key, descriptor] of Object.entries(descriptors)) {
		if (!descriptor.enumerable || !("value" in descriptor)) continue;
		const nested = descriptor.value;
		if (isSensitiveKey(key)) {
			assignCloneValue(clone, key, REDACTED);
			continue;
		}
		if (isErrorKey(key)) {
			if (typeof nested === "string") {
				assignCloneValue(clone, key, REDACTED);
				continue;
			}
			const errorLike = serializeErrorLike(nested);
			if (errorLike !== undefined) {
				assignCloneValue(clone, key, errorLike);
				continue;
			}
		}
		assignCloneValue(
			clone,
			key,
			redactValue(nested, [...path, key], policy, seen),
		);
	}
	return clone;
}

function assignCloneValue(
	clone: Record<string, unknown> | unknown[],
	key: string,
	value: unknown,
): void {
	Object.defineProperty(clone, key, {
		configurable: true,
		enumerable: true,
		value,
		writable: true,
	});
}

function serializeErrorDescriptors(
	descriptors: Record<string, PropertyDescriptor>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {
		type: dataProperty(descriptors, "name") ?? "Error",
		message: REDACTED,
	};
	const code = dataProperty(descriptors, "code");
	if (["string", "number"].includes(typeof code)) result.code = code;
	return result;
}

function serializeErrorLike(
	value: unknown,
): Record<string, unknown> | string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const descriptors = getDescriptors(value);
	if (!descriptors) return "[Unserializable]";
	const error = isError(value);
	if (!error && !descriptors.message && !descriptors.stack) return undefined;
	if (error) return serializeErrorDescriptors(descriptors);
	const result: Record<string, unknown> = {};
	for (const key of ["type", "name", "code", "status", "statusCode"] as const) {
		const candidate = dataProperty(descriptors, key);
		if (["string", "number"].includes(typeof candidate))
			result[key] = candidate;
	}
	result.message = REDACTED;
	return result;
}

function isError(value: object): boolean {
	try {
		return value instanceof Error;
	} catch {
		return false;
	}
}

function getDescriptors(
	value: object,
): Record<string, PropertyDescriptor> | undefined {
	try {
		return Object.getOwnPropertyDescriptors(value);
	} catch {
		return undefined;
	}
}

function dataProperty(
	descriptors: Record<string, PropertyDescriptor>,
	key: string,
): unknown {
	const descriptor = descriptors[key];
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function serializeSupportedValue(
	value: object,
	path: string[],
	policy: RedactionPolicy,
	seen: WeakMap<object, unknown>,
): unknown {
	try {
		const timestamp = Date.prototype.getTime.call(value);
		if (!Number.isNaN(timestamp))
			return { type: "Date", value: new Date(timestamp).toISOString() };
	} catch {}
	try {
		return { type: "URL", value: URL.prototype.toString.call(value) };
	} catch {}
	try {
		const result: { type: "Map"; entries: unknown[] } = {
			type: "Map",
			entries: [],
		};
		const iterator = Map.prototype.entries.call(value) as IterableIterator<
			[unknown, unknown]
		>;
		seen.set(value, result);
		for (const [key, nested] of iterator) {
			result.entries.push([
				redactValue(key, [...path, "key"], policy, seen),
				redactValue(nested, [...path, "value"], policy, seen),
			]);
		}
		return result;
	} catch {}
	try {
		const result: { type: "Set"; values: unknown[] } = {
			type: "Set",
			values: [],
		};
		const iterator = Set.prototype.values.call(
			value,
		) as IterableIterator<unknown>;
		seen.set(value, result);
		for (const nested of iterator)
			result.values.push(redactValue(nested, [...path, "value"], policy, seen));
		return result;
	} catch {}
	if (ArrayBuffer.isView(value)) {
		const values = Object.values(getDescriptors(value) ?? {})
			.filter((descriptor) => descriptor.enumerable && "value" in descriptor)
			.map((descriptor) => descriptor.value);
		return { type: "TypedArray", values };
	}
	return undefined;
}

function isErrorKey(key: string): boolean {
	const normalized = normalizeKey(key);
	return normalized === "err" || normalized === "error";
}

function isSensitiveKey(key: string): boolean {
	const normalized = normalizeKey(key);
	return SENSITIVE_KEY_SUFFIXES.some(
		(suffix) => normalized === suffix || normalized.endsWith(suffix),
	);
}

function normalizeKey(key: string): string {
	return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function matchesPath(path: string[], patterns: string[][]): boolean {
	return patterns.some(
		(pattern) =>
			pattern.length === path.length &&
			pattern.every((part, index) => part === "*" || part === path[index]),
	);
}

function parsePath(path: string): string[] {
	const parts: string[] = [];
	const matcher = /(?:^|\.)([^.[\]]+)|\[(?:"([^"]+)"|'([^']+)'|(\d+|\*))\]/g;
	for (const match of path.matchAll(matcher)) {
		const part = match[1] ?? match[2] ?? match[3] ?? match[4];
		if (part) parts.push(part);
	}
	return parts;
}

export type { RedactionPolicy };
