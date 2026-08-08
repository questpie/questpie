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
	return {
		paths: paths.map(parsePath).filter((path) => path.length > 0),
	};
}

export function redactLogArgs(
	args: unknown[],
	policy: RedactionPolicy,
): unknown[] {
	const seen = new WeakMap<object, unknown>();
	return args.map((value, index) => {
		const redacted = redactValue(value, [], policy, seen);
		return index === 0 && value instanceof Error ? { err: redacted } : redacted;
	});
}

export function redactLogBindings(
	bindings: Record<string, unknown>,
	policy: RedactionPolicy,
): Record<string, unknown> {
	return redactValue(
		bindings,
		[],
		policy,
		new WeakMap<object, unknown>(),
	) as Record<string, unknown>;
}

function redactValue(
	value: unknown,
	path: string[],
	policy: RedactionPolicy,
	seen: WeakMap<object, unknown>,
): unknown {
	if (matchesPath(path, policy.paths)) return REDACTED;
	if (value instanceof Error) return serializeError(value);
	if (!value || typeof value !== "object") return value;

	const existing = seen.get(value);
	if (existing) return existing;

	if (Array.isArray(value)) {
		const clone: unknown[] = [];
		seen.set(value, clone);
		for (let index = 0; index < value.length; index += 1) {
			clone.push(
				redactValue(value[index], [...path, String(index)], policy, seen),
			);
		}
		return clone;
	}
	if (!isPlainObject(value)) return value;

	const clone: Record<string, unknown> = {};
	seen.set(value, clone);
	for (const [key, nested] of Object.entries(value)) {
		if (isSensitiveKey(key)) {
			clone[key] = REDACTED;
			continue;
		}

		if (isErrorKey(key)) {
			if (typeof nested === "string") {
				clone[key] = REDACTED;
				continue;
			}
			if (isErrorLike(nested)) {
				clone[key] = serializeErrorLike(nested);
				continue;
			}
		}

		clone[key] = redactValue(nested, [...path, key], policy, seen);
	}
	return clone;
}

function isPlainObject(value: object): value is Record<string, unknown> {
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || prototype === Object.prototype;
}

function serializeError(error: Error): Record<string, unknown> {
	const result: Record<string, unknown> = {
		type: error.name,
		message: REDACTED,
	};
	const code = (error as Error & { code?: unknown }).code;
	if (["string", "number"].includes(typeof code)) result.code = code;
	return result;
}

function serializeErrorLike(
	value: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of ["type", "name", "code", "status", "statusCode"] as const) {
		const candidate = value[key];
		if (["string", "number"].includes(typeof candidate))
			result[key] = candidate;
	}
	if ("message" in value || "stack" in value) result.message = REDACTED;
	return result;
}

function isErrorLike(value: unknown): value is Record<string, unknown> {
	return (
		value instanceof Error ||
		(value !== null &&
			typeof value === "object" &&
			("message" in value || "stack" in value))
	);
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
