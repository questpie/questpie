/**
 * CRUD Method Guard
 *
 * Wraps the object returned by `CRUDGenerator.generate()` in a Proxy that
 * fails loud when an unknown method is accessed. Untyped call sites (auth
 * callbacks, seeds, AI-generated glue) that call a non-existent method like
 * `crud.updateMnay(...)` previously got `undefined is not a function` — or
 * worse, a silent no-op when swallowed by a bare `catch`. The guard converts
 * that into an instructive `TypeError` at the access site, naming the closest
 * real method and listing the full vocabulary.
 *
 * Behavior is unchanged for every property that exists:
 * - own keys (all CRUD methods, `~internal*` state) pass through
 * - symbols pass through (`Symbol.iterator`, `util.inspect.custom`, ...)
 * - anything on the prototype chain passes through (`toString`, `valueOf`,
 *   `constructor`, `hasOwnProperty`, ...)
 * - a small probe allowlist returns `undefined` exactly as before: thenable
 *   probes (`await crud`), serializers (`JSON.stringify`), test matchers, and
 *   the sanctioned `crud.upload` capability check on non-upload collections
 * - `has`/`ownKeys`/`getOwnPropertyDescriptor` are not trapped, so spreads,
 *   `Object.keys(crud)`, and `"updateMany" in crud` (the supported
 *   feature-detection idiom) behave exactly as today and never throw.
 */

/**
 * Property names that legitimate runtime machinery probes on arbitrary
 * objects. These must keep returning `undefined` instead of throwing.
 */
const PROBE_ALLOWLIST = new Set<string>([
	// Thenable probe: `await crud` / Promise.resolve(crud)
	"then",
	"catch",
	"finally",
	// Serialization
	"toJSON",
	// React element probe
	"$$typeof",
	// Test matcher probes (bun:test / vitest / jest)
	"asymmetricMatch",
	// Sanctioned capability probes — only present on upload collections
	"upload",
	"uploadMany",
]);

/**
 * CRUD keys kept as deprecated aliases (ambiguous across surfaces).
 * Listed separately in the error message so suggestions steer users
 * toward the canonical vocabulary.
 */
const DEPRECATED_CRUD_KEYS = new Set<string>(["update", "delete"]);

/** Classic Levenshtein distance (case-insensitive). */
function levenshtein(a: string, b: string): number {
	const s = a.toLowerCase();
	const t = b.toLowerCase();
	const m = s.length;
	const n = t.length;
	if (m === 0) return n;
	if (n === 0) return m;

	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		const curr: number[] = [i];
		for (let j = 1; j <= n; j++) {
			const cost = s[i - 1] === t[j - 1] ? 0 : 1;
			curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
		}
		prev = curr;
	}
	return prev[n];
}

/**
 * Closest real method name for a typo, or undefined when nothing is close.
 * Canonical keys are checked first so they win ties over deprecated aliases.
 */
function closestMethod(prop: string, keys: string[]): string | undefined {
	const ordered = [
		...keys.filter((key) => !DEPRECATED_CRUD_KEYS.has(key)),
		...keys.filter((key) => DEPRECATED_CRUD_KEYS.has(key)),
	];

	let best: string | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const key of ordered) {
		const distance = levenshtein(prop, key);
		if (distance < bestDistance) {
			best = key;
			bestDistance = distance;
		}
	}
	// Only suggest when plausibly a typo of the best match
	const threshold = Math.max(2, Math.floor(prop.length / 3));
	return bestDistance <= threshold ? best : undefined;
}

function buildUnknownMethodError(
	collectionName: string,
	prop: string,
	target: object,
): TypeError {
	const keys = Object.keys(target).filter((key) => !key.startsWith("~"));
	const canonical = keys.filter((key) => !DEPRECATED_CRUD_KEYS.has(key));
	const deprecated = keys.filter((key) => DEPRECATED_CRUD_KEYS.has(key));
	const suggestion = closestMethod(prop, keys);

	let message = `collections.${collectionName}.${prop} is not a CRUD method.`;
	if (suggestion) {
		message += ` Did you mean "${suggestion}"?`;
	}
	message += ` Available: ${canonical.join(", ")}`;
	if (deprecated.length > 0) {
		message += ` (deprecated: ${deprecated.join(", ")})`;
	}
	return new TypeError(message);
}

/**
 * Wrap a generated CRUD object so unknown method access throws a helpful
 * `TypeError` instead of returning `undefined`.
 *
 * Runtime-only: returns the input type unchanged.
 */
export function guardCrudMethods<T extends object>(
	crud: T,
	collectionName: string,
): T {
	return new Proxy(crud, {
		get(target, prop, receiver) {
			if (
				typeof prop === "symbol" ||
				prop in target ||
				PROBE_ALLOWLIST.has(prop)
			) {
				return Reflect.get(target, prop, receiver);
			}
			throw buildUnknownMethodError(collectionName, prop, target);
		},
	});
}
