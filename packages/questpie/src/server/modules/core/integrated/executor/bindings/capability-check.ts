/**
 * Capability enforcement — the SECURITY CORE of the untrusted bindings path.
 *
 * `checkBindingCapability(method, args, caps)` decides, PER CALL and
 * DEFAULT-DENY, whether an untrusted sandbox guest may invoke a primitive given
 * its run's declared {@link ExecutorCapabilities} (the mini-app manifest scope).
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §14. This function is intended to
 * be a PURE, exhaustively-tested unit — it performs NO IO and never throws on a
 * policy decision; an out-of-scope call returns `{ allowed:false }`, not an
 * exception. The broker ({@link ./broker}) calls it before dispatching.
 *
 * INVARIANTS (fail closed):
 *   - An omitted capability axis grants NOTHING (default-deny).
 *   - Knowledge path args are normalized and `..`/absolute escapes are REJECTED
 *     before glob matching, so an in-scope-looking glob can't be escaped.
 *   - Method strings are re-parsed here; an unrecognized method is denied.
 *   - A write/mutation op requires the matching verb (`create`/`update`/etc.),
 *     never just `read`.
 */

import type { ExecutorCapabilities } from "../adapter.js";
import { type ParsedBindingMethod, parseBindingMethod } from "./protocol.js";

/** Result of a capability decision. `reason` is populated only when denied. */
export interface CapabilityDecision {
	allowed: boolean;
	/** Stable, log-safe reason when `allowed` is false. */
	reason?: string;
}

const ALLOW: CapabilityDecision = { allowed: true };
function deny(reason: string): CapabilityDecision {
	return { allowed: false, reason };
}

/**
 * Normalize a knowledge path for matching and ESCAPE-CHECK it. Returns the
 * normalized POSIX-style path, or `null` if the path is unsafe (absolute,
 * contains a `..` traversal segment, a NUL byte, or a backslash). A `null`
 * result must be treated as DENY by the caller.
 *
 * We intentionally do NOT use `path.normalize` (which would silently RESOLVE
 * `..`, masking an escape attempt). Instead we reject any `..` segment outright.
 */
export function normalizeKnowledgePath(raw: unknown): string | null {
	if (typeof raw !== "string" || raw.length === 0) return null;
	// Reject NUL bytes and backslashes (Windows-style / smuggling).
	if (raw.includes("\0") || raw.includes("\\")) return null;
	// Reject absolute paths.
	if (raw.startsWith("/")) return null;
	// Collapse duplicate slashes and strip a single leading "./".
	const collapsed = raw.replace(/\/{2,}/g, "/").replace(/^\.\//, "");
	const segments = collapsed.split("/");
	for (const s of segments) {
		// Any parent-dir segment is an escape attempt → reject.
		if (s === "..") return null;
	}
	return collapsed;
}

/**
 * Match a normalized path against a single glob.
 *
 * Glob semantics (deliberately small + fully anchored):
 *   - `**`  matches any characters INCLUDING `/` (recursive).
 *   - `*`   matches any characters EXCEPT `/` (one segment).
 *   - `?`   matches a single non-`/` character.
 *   - all other characters are literal (regex-escaped).
 * The whole pattern is anchored (`^…$`) so a glob can't partial-match.
 *
 * The glob is normalized through {@link normalizeKnowledgePath} first; an unsafe
 * glob (absolute / `..`) never matches.
 */
export function knowledgePathMatches(pathn: string, glob: string): boolean {
	const safeGlob = normalizeKnowledgePath(glob);
	if (safeGlob === null) return false;

	let re = "^";
	for (let i = 0; i < safeGlob.length; i++) {
		const c = safeGlob[i];
		if (c === "*") {
			if (safeGlob[i + 1] === "*") {
				re += ".*"; // ** → across separators
				i++;
			} else {
				re += "[^/]*"; // * → within a segment
			}
		} else if (c === "?") {
			re += "[^/]";
		} else {
			// Escape regex metacharacters.
			re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	re += "$";
	return new RegExp(re).test(pathn);
}

/** True if `pathn` matches ANY glob in `globs` (default-deny on empty/absent). */
function anyGlobMatches(pathn: string, globs: string[] | undefined): boolean {
	if (!Array.isArray(globs) || globs.length === 0) return false;
	for (const g of globs) {
		if (knowledgePathMatches(pathn, g)) return true;
	}
	return false;
}

/**
 * Safely read a per-entity grant array from a capability record keyed by NAME.
 *
 * Uses an OWN-property check so a method like `collections.__proto__.find` (whose
 * `name` segment passes the syntactic classifier) can NEVER resolve to a value
 * up the prototype chain (`Object.prototype`) and be mistaken for a grant — it
 * resolves to `undefined` → default-deny. Also rejects a non-array grant value.
 */
function ownGrants<T>(
	record: Record<string, T[]> | undefined,
	name: string,
): T[] | undefined {
	if (!record || !Object.prototype.hasOwnProperty.call(record, name)) {
		return undefined;
	}
	const value = (record as Record<string, unknown>)[name];
	return Array.isArray(value) ? (value as T[]) : undefined;
}

/** Decide a parsed `knowledge.*` call. */
function checkKnowledge(
	parsed: Extract<ParsedBindingMethod, { kind: "knowledge" }>,
	args: unknown,
	caps: ExecutorCapabilities,
): CapabilityDecision {
	const scope = caps.knowledge;
	if (!scope) return deny("knowledge access not granted");

	const a = (args ?? {}) as { path?: unknown };

	if (parsed.op === "list") {
		// `list` may pass an optional path PREFIX. Default-deny unless a read glob
		// is configured; if a prefix is given it must itself be safe + in a read
		// glob, otherwise the listing could enumerate outside scope.
		if (!scope.read || scope.read.length === 0) {
			return deny("knowledge.list requires a knowledge.read scope");
		}
		if (a.path !== undefined && a.path !== null) {
			const pathn = normalizeKnowledgePath(a.path);
			if (pathn === null) return deny("knowledge.list path is unsafe");
			if (!anyGlobMatches(pathn, scope.read)) {
				return deny(`knowledge.list path "${pathn}" is outside read scope`);
			}
		}
		return ALLOW;
	}

	// read / write both require a concrete path.
	const pathn = normalizeKnowledgePath(a.path);
	if (pathn === null) return deny("knowledge path is missing or unsafe");

	if (parsed.op === "read") {
		if (!anyGlobMatches(pathn, scope.read)) {
			return deny(`knowledge.read path "${pathn}" is outside read scope`);
		}
		return ALLOW;
	}

	// write
	if (!anyGlobMatches(pathn, scope.write)) {
		return deny(`knowledge.write path "${pathn}" is outside write scope`);
	}
	return ALLOW;
}

/** Map a collection op to the data-access verb it requires. */
const COLLECTION_OP_VERB: Record<
	Extract<ParsedBindingMethod, { kind: "collection" }>["op"],
	"read" | "create" | "update" | "delete"
> = {
	find: "read",
	findOne: "read",
	create: "create",
	update: "update",
	delete: "delete",
};

/** Decide a parsed `collections.<name>.<op>` call. */
function checkCollection(
	parsed: Extract<ParsedBindingMethod, { kind: "collection" }>,
	caps: ExecutorCapabilities,
): CapabilityDecision {
	const grants = ownGrants(caps.data?.collections, parsed.name);
	if (!grants || grants.length === 0) {
		return deny(`collection "${parsed.name}" not in data scope`);
	}
	const verb = COLLECTION_OP_VERB[parsed.op];
	if (!grants.includes(verb)) {
		return deny(
			`collection "${parsed.name}" op "${parsed.op}" requires "${verb}" (granted: ${grants.join(",")})`,
		);
	}
	return ALLOW;
}

/** Decide a parsed `globals.<name>.<op>` call. */
function checkGlobal(
	parsed: Extract<ParsedBindingMethod, { kind: "global" }>,
	caps: ExecutorCapabilities,
): CapabilityDecision {
	const grants = ownGrants(caps.data?.globals, parsed.name);
	if (!grants || grants.length === 0) {
		return deny(`global "${parsed.name}" not in data scope`);
	}
	const verb = parsed.op === "get" ? "read" : "write";
	if (!grants.includes(verb)) {
		return deny(`global "${parsed.name}" op "${parsed.op}" requires "${verb}"`);
	}
	return ALLOW;
}

/**
 * Decide, default-deny, whether `method(args)` is within `caps`.
 *
 * @returns `{ allowed: true }` when in scope; otherwise `{ allowed:false, reason }`.
 *   The `reason` is safe to log and to return to the guest (no secrets).
 */
export function checkBindingCapability(
	method: string,
	args: unknown,
	caps: ExecutorCapabilities | undefined,
): CapabilityDecision {
	// No capabilities object at all = nothing granted.
	const scope = caps ?? {};

	const parsed = parseBindingMethod(method);
	if (!parsed) return deny(`unrecognized method "${String(method)}"`);

	switch (parsed.kind) {
		case "knowledge":
			return checkKnowledge(parsed, args, scope);
		case "collection":
			return checkCollection(parsed, scope);
		case "global":
			return checkGlobal(parsed, scope);
		case "service":
			return (scope.services ?? []).includes(parsed.name)
				? ALLOW
				: deny(`service "${parsed.name}" not in scope`);
		case "job":
			return (scope.jobs ?? []).includes(parsed.name)
				? ALLOW
				: deny(`job "${parsed.name}" not in scope`);
		case "workflow":
			return (scope.workflows ?? []).includes(parsed.name)
				? ALLOW
				: deny(`workflow "${parsed.name}" not in scope`);
		case "email":
			// `email.send` has no dedicated allowlist axis in the MVP manifest;
			// fail closed until one is defined.
			return deny(
				"email.send is not grantable in the current capability model",
			);
		default: {
			// Exhaustiveness guard — if a new `kind` is added, this assignment fails
			// to typecheck until it is handled (and we still default-deny at runtime).
			parsed satisfies never;
			return deny("unhandled method kind");
		}
	}
}
