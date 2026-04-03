/**
 * Route Matcher — compiled trie-based matcher with priority resolution.
 *
 * Priority: literal > parameterized > wildcard
 * Collision: throws at compile time when two routes produce
 * the same match specificity for any possible path.
 *
 * Terminal nodes store a Map<method, THandler> so that multiple HTTP methods
 * can share the same path pattern (e.g., GET + PATCH on /:collection/:id).
 *
 * @module
 */

// ============================================================================
// Types
// ============================================================================

/** Matched route result with extracted params — returns all methods for the path. */
export interface RouteMatch<T = unknown> {
	/** Map of HTTP method to handler (e.g., GET -> handler, PATCH -> handler) */
	methods: Map<string, T>;
	/** Extracted path parameters (e.g., { id: "123" }) */
	params: Record<string, string>;
	/** The route pattern that matched */
	pattern: string;
}

/** Segment types, ordered by priority (lower = higher priority). */
const enum SegmentKind {
	Literal = 0,
	Param = 1,
	Wildcard = 2,
}

/** Internal node in the route trie. */
interface TrieNode<T> {
	/** Literal children keyed by segment string */
	literals: Map<string, TrieNode<T>>;
	/** Param child (:name) — at most one */
	param: { name: string; child: TrieNode<T> } | null;
	/** Wildcard child (*name or *) — terminal */
	wildcard: { name: string; methods: Map<string, T>; pattern: string } | null;
	/** Terminal method-grouped handlers for this node */
	terminal: { methods: Map<string, T>; pattern: string } | null;
}

// ============================================================================
// Compilation
// ============================================================================

function createNode<T>(): TrieNode<T> {
	return { literals: new Map(), param: null, wildcard: null, terminal: null };
}

/** Parse a segment into its kind and name. */
function parseSegment(
	seg: string,
): { kind: SegmentKind; name: string } {
	if (seg.startsWith(":")) {
		return { kind: SegmentKind.Param, name: seg.slice(1) };
	}
	if (seg === "*" || seg.startsWith("*")) {
		const name = seg.length > 1 ? seg.slice(1) : "wildcard";
		return { kind: SegmentKind.Wildcard, name };
	}
	return { kind: SegmentKind.Literal, name: seg };
}

/**
 * Compute a specificity score for collision detection.
 * Each segment contributes: literal=0, param=1, wildcard=2.
 * Two patterns with identical specificity vectors at the same depth collide.
 */
function specificityKey(pattern: string): string {
	const segs = pattern.split("/").filter(Boolean);
	return segs
		.map((seg) => {
			const { kind } = parseSegment(seg);
			return kind;
		})
		.join(",");
}

/**
 * Check if two patterns can collide (match the same path).
 * Conservative: two patterns collide if they have the same depth
 * and each pair of segments is either both literal-identical,
 * or at least one is parameterized/wildcard.
 */
function patternsCollide(a: string, b: string): boolean {
	const segsA = a.split("/").filter(Boolean);
	const segsB = b.split("/").filter(Boolean);

	// Wildcard patterns can match any depth
	const aHasWild = segsA.some((s) => s.startsWith("*"));
	const bHasWild = segsB.some((s) => s.startsWith("*"));

	if (aHasWild || bHasWild) {
		// Both wildcards at same prefix depth = collision
		const aWildIdx = segsA.findIndex((s) => s.startsWith("*"));
		const bWildIdx = segsB.findIndex((s) => s.startsWith("*"));
		const prefixA = segsA.slice(0, aHasWild ? aWildIdx : segsA.length);
		const prefixB = segsB.slice(0, bHasWild ? bWildIdx : segsB.length);
		const minLen = Math.min(prefixA.length, prefixB.length);
		for (let i = 0; i < minLen; i++) {
			const pa = parseSegment(prefixA[i]);
			const pb = parseSegment(prefixB[i]);
			if (
				pa.kind === SegmentKind.Literal &&
				pb.kind === SegmentKind.Literal &&
				pa.name !== pb.name
			) {
				return false; // Different literals = can't collide
			}
		}
		// If both are wildcards at same prefix, they collide
		if (aHasWild && bHasWild && aWildIdx === bWildIdx) {
			return true;
		}
		return false;
	}

	// Fixed-depth patterns
	if (segsA.length !== segsB.length) return false;

	for (let i = 0; i < segsA.length; i++) {
		const pa = parseSegment(segsA[i]);
		const pb = parseSegment(segsB[i]);

		// Two different literals at same position = can't collide
		if (
			pa.kind === SegmentKind.Literal &&
			pb.kind === SegmentKind.Literal &&
			pa.name !== pb.name
		) {
			return false;
		}
	}

	return true;
}

export class RouteCollisionError extends Error {
	constructor(
		public patternA: string,
		public patternB: string,
		public method?: string,
	) {
		const methodInfo = method ? ` for method ${method}` : "";
		super(
			`Route collision: "${patternA}" and "${patternB}" are ambiguous${methodInfo} — they can match the same paths with equal specificity`,
		);
		this.name = "RouteCollisionError";
	}
}

/**
 * Compile a set of route patterns into an optimized matcher.
 *
 * @param routes - Array of [pattern, method, handler] entries
 * @returns Compiled matcher
 * @throws RouteCollisionError if two patterns with the same method are ambiguous
 */
export function compileMatcher<T>(
	routes:
		| Map<string, T>
		| [string, T][]
		| [string, string, T][],
): RouteMatcher<T> {
	const root = createNode<T>();

	// Normalize input: detect whether we have 2-tuples or 3-tuples
	const entries: [string, string, T][] = [];

	if (routes instanceof Map) {
		// Legacy: Map<pattern, handler> — use "*" as wildcard method
		for (const [pattern, handler] of routes) {
			entries.push([pattern, "*", handler]);
		}
	} else if (routes.length > 0) {
		const first = routes[0];
		if (first.length === 3) {
			// 3-tuples: [pattern, method, handler]
			entries.push(...(routes as [string, string, T][]));
		} else {
			// 2-tuples: [pattern, handler] — use "*" as wildcard method
			for (const entry of routes as [string, T][]) {
				entries.push([entry[0], "*", entry[1]]);
			}
		}
	}

	// Group entries by pattern for collision detection
	// Per-method collision: same pattern + same method = collision
	const patternMethodMap = new Map<string, Map<string, string>>();

	for (const [pattern, method] of entries) {
		const key = specificityKey(pattern);
		let methodMap = patternMethodMap.get(key);
		if (!methodMap) {
			methodMap = new Map();
			patternMethodMap.set(key, methodMap);
		}
	}

	// Cross-pattern collision detection (same as before, but per-method)
	const specGroups = new Map<string, [string, string][]>();
	for (const [pattern, method] of entries) {
		const key = specificityKey(pattern);
		const group = specGroups.get(key);
		if (group) {
			for (const [existingPattern, existingMethod] of group) {
				// Only collision if same method (or either is wildcard "*")
				if (
					existingMethod === method ||
					existingMethod === "*" ||
					method === "*"
				) {
					if (patternsCollide(pattern, existingPattern)) {
						throw new RouteCollisionError(existingPattern, pattern, method);
					}
				}
			}
			group.push([pattern, method]);
		} else {
			specGroups.set(key, [[pattern, method]]);
		}
	}

	// --- Build trie ---
	for (const [pattern, method, handler] of entries) {
		const segments = pattern.split("/").filter(Boolean);
		let node = root;

		for (let i = 0; i < segments.length; i++) {
			const { kind, name } = parseSegment(segments[i]);

			if (kind === SegmentKind.Wildcard) {
				if (!node.wildcard) {
					node.wildcard = { name, methods: new Map(), pattern };
				}
				if (node.wildcard.methods.has(method)) {
					throw new RouteCollisionError(
						node.wildcard.pattern,
						pattern,
						method,
					);
				}
				node.wildcard.methods.set(method, handler);
				break; // Wildcard consumes rest
			}

			if (kind === SegmentKind.Param) {
				if (!node.param) {
					node.param = { name, child: createNode() };
				}
				node = node.param.child;
			} else {
				// Literal
				let child = node.literals.get(name);
				if (!child) {
					child = createNode();
					node.literals.set(name, child);
				}
				node = child;
			}

			// If last segment, mark as terminal
			if (i === segments.length - 1) {
				if (!node.terminal) {
					node.terminal = { methods: new Map(), pattern };
				}
				if (node.terminal.methods.has(method)) {
					throw new RouteCollisionError(
						node.terminal.pattern,
						pattern,
						method,
					);
				}
				node.terminal.methods.set(method, handler);
			}
		}
	}

	return new RouteMatcher(root);
}

// ============================================================================
// Matching
// ============================================================================

/**
 * Compiled route matcher with trie-based lookup.
 * Priority at each level: literal > param > wildcard.
 */
export class RouteMatcher<T> {
	constructor(private root: TrieNode<T>) {}

	/**
	 * Match a URL path against compiled routes.
	 *
	 * @param path - URL path (e.g., "/users/123/posts")
	 * @returns Match result or null if no route matches
	 */
	match(path: string): RouteMatch<T> | null {
		const segments = path.split("/").filter(Boolean);
		return this._match(this.root, segments, 0, {});
	}

	private _match(
		node: TrieNode<T>,
		segments: string[],
		idx: number,
		params: Record<string, string>,
	): RouteMatch<T> | null {
		// Terminal: all segments consumed
		if (idx === segments.length) {
			if (node.terminal) {
				return {
					methods: node.terminal.methods,
					params: { ...params },
					pattern: node.terminal.pattern,
				};
			}
			return null;
		}

		const seg = segments[idx];

		// 1. Try literal child (highest priority)
		const literalChild = node.literals.get(seg);
		if (literalChild) {
			const result = this._match(literalChild, segments, idx + 1, params);
			if (result) return result;
		}

		// 2. Try param child
		if (node.param) {
			const result = this._match(
				node.param.child,
				segments,
				idx + 1,
				{ ...params, [node.param.name]: seg },
			);
			if (result) return result;
		}

		// 3. Try wildcard (lowest priority, consumes rest)
		if (node.wildcard) {
			const rest = segments.slice(idx).join("/");
			return {
				methods: node.wildcard.methods,
				params: { ...params, [node.wildcard.name]: rest },
				pattern: node.wildcard.pattern,
			};
		}

		return null;
	}
}
