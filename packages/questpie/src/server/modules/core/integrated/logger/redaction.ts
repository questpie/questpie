const REDACTED = "[Redacted]";
const SENSITIVE_KEY_SUFFIXES = [
	"authorization",
	"authorizations",
	"cookie",
	"cookies",
	"password",
	"passwords",
	"passwordhash",
	"passwordhashes",
	"token",
	"tokens",
	"secret",
	"secrets",
	"apikey",
	"apikeys",
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
	const seen = new WeakSet<object>();
	return args.map((value, index) => {
		const redacted = redactValue(value, [], policy, seen);
		return index === 0 &&
			value !== null &&
			typeof value === "object" &&
			isError(value)
			? inertRecord({ err: redacted })
			: redacted;
	});
}

export function redactLogBindings(
	bindings: Record<string, unknown>,
	policy: RedactionPolicy,
): Record<string, unknown> {
	const redacted = redactValue(bindings, [], policy, new WeakSet());
	return redacted && typeof redacted === "object" && !Array.isArray(redacted)
		? (redacted as Record<string, unknown>)
		: Object.create(null);
}

function redactValue(
	value: unknown,
	path: string[],
	policy: RedactionPolicy,
	seen: WeakSet<object>,
): unknown {
	if (matchesPath(path, policy.paths)) return REDACTED;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : "[NonFinite]";
	if (value === null || ["string", "boolean"].includes(typeof value))
		return value;
	if (typeof value !== "object") return "[Unsupported]";
	if (seen.has(value)) return "[Circular]";
	seen.add(value);
	const descriptors = getDescriptors(value);
	if (!descriptors) {
		seen.delete(value);
		return "[Unserializable]";
	}
	if (isError(value)) {
		const result = serializeErrorDescriptors(
			value,
			descriptors,
			path,
			policy,
			seen,
		);
		seen.delete(value);
		return result;
	}
	const supported = serializeSupportedValue(value, path, policy, seen);
	if (supported !== undefined) {
		seen.delete(value);
		return supported;
	}
	const clone: Record<string, unknown> | unknown[] = Array.isArray(value)
		? []
		: Object.create(null);
	for (const [key, descriptor] of Object.entries(descriptors)) {
		if (!descriptor.enumerable || !("value" in descriptor)) continue;
		const nested = descriptor.value;
		if (matchesPath([...path, key], policy.paths)) {
			assignCloneValue(clone, key, REDACTED);
			continue;
		}
		if (isSensitiveKey(key)) {
			assignCloneValue(clone, key, REDACTED);
			continue;
		}
		if (isErrorKey(key)) {
			if (typeof nested === "string") {
				assignCloneValue(clone, key, REDACTED);
				continue;
			}
			const errorLike = serializeErrorLike(
				nested,
				[...path, key],
				policy,
				seen,
			);
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
	seen.delete(value);
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
	error: object,
	descriptors: Record<string, PropertyDescriptor>,
	path: string[],
	policy: RedactionPolicy,
	seen: WeakSet<object>,
): Record<string, unknown> {
	const ownName = dataProperty(descriptors, "name");
	const result: Record<string, unknown> = Object.assign(Object.create(null), {
		type:
			typeof ownName === "string" &&
			/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(ownName)
				? ownName
				: trustedErrorType(error),
		message: REDACTED,
	});
	const code = dataProperty(descriptors, "code");
	if (["string", "number"].includes(typeof code))
		result.code = redactValue(code, [...path, "code"], policy, seen);
	result.type = redactValue(result.type, [...path, "type"], policy, seen);
	return result;
}

function serializeErrorLike(
	value: unknown,
	path: string[],
	policy: RedactionPolicy,
	seen: WeakSet<object>,
): Record<string, unknown> | string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const descriptors = getDescriptors(value);
	if (!descriptors) return "[Unserializable]";
	const error = isError(value);
	if (!error && !descriptors.message && !descriptors.stack) return undefined;
	if (error)
		return serializeErrorDescriptors(value, descriptors, path, policy, seen);
	const result: Record<string, unknown> = Object.create(null);
	for (const key of ["type", "name", "code", "status", "statusCode"] as const) {
		const candidate = dataProperty(descriptors, key);
		if (["string", "number"].includes(typeof candidate))
			result[key] = redactValue(candidate, [...path, key], policy, seen);
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

function trustedErrorType(value: object): string {
	const trusted = new Map<object, string>([
		[AggregateError.prototype, "AggregateError"],
		[EvalError.prototype, "EvalError"],
		[RangeError.prototype, "RangeError"],
		[ReferenceError.prototype, "ReferenceError"],
		[SyntaxError.prototype, "SyntaxError"],
		[TypeError.prototype, "TypeError"],
		[URIError.prototype, "URIError"],
		[Error.prototype, "Error"],
		[DOMException.prototype, "DOMException"],
		[WebAssembly.CompileError.prototype, "WebAssembly.CompileError"],
		[WebAssembly.LinkError.prototype, "WebAssembly.LinkError"],
		[WebAssembly.RuntimeError.prototype, "WebAssembly.RuntimeError"],
	]);
	const suppressed = (globalThis as { SuppressedError?: { prototype: object } })
		.SuppressedError;
	if (suppressed) trusted.set(suppressed.prototype, "SuppressedError");
	try {
		let prototype = Object.getPrototypeOf(value);
		while (prototype) {
			const type = trusted.get(prototype);
			if (type) return type;
			prototype = Object.getPrototypeOf(prototype);
		}
	} catch {}
	return "Error";
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
	seen: WeakSet<object>,
): unknown {
	try {
		const timestamp = Date.prototype.getTime.call(value);
		if (!Number.isNaN(timestamp))
			return inertRecord({
				type: "Date",
				value: new Date(timestamp).toISOString(),
			});
	} catch {}
	try {
		const url = new URL(URL.prototype.toString.call(value));
		url.username = "";
		url.password = "";
		url.hash = "";
		for (const key of url.searchParams.keys()) {
			if (isSensitiveKey(key) || matchesPath([...path, key], policy.paths)) {
				url.searchParams.set(key, REDACTED);
			}
		}
		return inertRecord({ type: "URL", value: url.toString() });
	} catch {}
	try {
		const result = inertRecord({
			type: "Map",
			entries: [] as unknown[],
		});
		const iterator = Map.prototype.entries.call(value) as IterableIterator<
			[unknown, unknown]
		>;
		for (const [key, nested] of iterator) {
			const policySegment = typeof key === "string" ? key : "<non-string-key>";
			const redactEntry =
				typeof key === "string" &&
				(isSensitiveKey(key) || matchesPath([...path, key], policy.paths));
			result.entries.push([
				redactValue(key, [...path, "key"], policy, seen),
				redactEntry
					? REDACTED
					: redactValue(nested, [...path, policySegment], policy, seen),
			]);
		}
		return result;
	} catch {}
	try {
		const result = inertRecord({
			type: "Set",
			values: [] as unknown[],
		});
		const iterator = Set.prototype.values.call(
			value,
		) as IterableIterator<unknown>;
		for (const nested of iterator)
			result.values.push(redactValue(nested, [...path, "value"], policy, seen));
		return result;
	} catch {}
	if (ArrayBuffer.isView(value)) {
		const values = Object.entries(getDescriptors(value) ?? {})
			.filter(([key, descriptor]) => /^\d+$/.test(key) && "value" in descriptor)
			.sort(([left], [right]) => Number(left) - Number(right))
			.map(([key, descriptor]) =>
				redactValue(descriptor.value, [...path, key], policy, seen),
			);
		return inertRecord({ type: "TypedArray", values });
	}
	return undefined;
}

function inertRecord<T extends Record<string, unknown>>(values: T): T {
	return Object.assign(Object.create(null), values) as T;
}

function isErrorKey(key: string): boolean {
	const normalized = normalizeKey(key);
	return normalized === "err" || normalized === "error";
}

function isSensitiveKey(key: string): boolean {
	const words = key
		.replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	const last = words.at(-1) ?? "";
	const compound = words.slice(-2).join("");
	return (
		SENSITIVE_KEY_SUFFIXES.includes(
			last as (typeof SENSITIVE_KEY_SUFFIXES)[number],
		) ||
		compound === "apikey" ||
		compound === "apikeys" ||
		compound === "passwordhash" ||
		compound === "passwordhashes"
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
