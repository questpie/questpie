/**
 * Skill SKILL.md frontmatter — the CANONICAL parse + validation.
 *
 * Design: `.private/miniapps-v2-design.md` §8.2 (the SKILL.md contract) + §8.7
 * (governance). A skill is a `kind:"skill"` file in the unified `assets` store at
 * `company/skills/{skill-id}/SKILL.md` (+ project skills under
 * `projects/{slug}/skills/...`). The YAML frontmatter at the top of the `body` is
 * CANONICAL; a parsed MIRROR is written into the row's `metadata` by the write-time
 * validator hook (`collections/assets.ts`) so DISCOVERY never re-parses bodies
 * (`lib/skill-discovery.ts` reads the mirror).
 *
 * WHY A RESTRICTED PARSER, NOT A FULL YAML LIBRARY:
 *   The SKILL.md frontmatter is a FLAT block of `key: value` pairs — scalar
 *   strings/numbers/booleans plus a few string arrays (inline `[a, b]` or block
 *   `- item`). A full YAML engine (anchors, merge keys, custom tags, deep nesting)
 *   would ADD attack surface for an UNTRUSTED, possibly agent-self-authored
 *   document (§8.5). So we parse the exact subset we accept and FAIL CLOSED on
 *   everything else — mirroring the static, no-`eval`, prototype-pollution-guarded
 *   posture of `apps/manifest.ts` (`literalNodeToValue`).
 *
 * HARDENING (security):
 *   - Prototype-pollution: forbidden keys (`__proto__`/`constructor`/`prototype`)
 *     are REJECTED; the parsed object is null-prototype with OWN data properties.
 *   - Fail-closed: any structure we do not explicitly accept (nested maps, tags,
 *     anchors, multi-doc, tabs-as-indent, duplicate keys, unterminated frontmatter)
 *     throws {@link SkillFrontmatterError} — a malformed skill is NEVER silently
 *     half-parsed into the mirror.
 *   - The Anthropic field LIMITS (`name` ≤64 lowercase-hyphen, `description` ≤1024)
 *     are enforced here, so an over-budget skill cannot be stored.
 */

import { z } from "zod";

/** Object-literal keys that would pollute the prototype chain — always rejected. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Anthropic SKILL.md limits (`overview` docs): name ≤64, description ≤1024. */
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;

/** `name` must be a lowercase, hyphen-separated slug (Anthropic convention). */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The TOOL vocabulary `allowed_tools` may name — the REAL agent-facing MCP tool
 * names registered in `mcp-tools/*` (`mcpTool("<name>", …)`). A skill's procedure
 * "bottoms out in existing MCP tools / `run_code` / mini-app actions" (§8.4: "a
 * skill orchestrates primitives, it is not a new execution engine"), so the
 * vocabulary is exactly those tool ids.
 *
 * ADVISORY, NOT ENFORCED (status / scope): `allowed_tools` is currently DECLARATIVE
 * METADATA ONLY. There is no tool-layer gate that filters a run's toolset by the
 * active skill's `allowed_tools` — and there cannot be a meaningful one in this cut,
 * because the agent self-selects 0..N skills mid-run (it reads SKILL.md bodies on
 * demand) while the run's toolset is fixed at run-creation. Per §8.1 ("cut the
 * governance automation until there is demand") the enforcing gate is DEFERRED; the
 * declared tools are surfaced to the agent as advisory DATA in the discovery block
 * (`lib/skill-discovery.ts`). This set exists ONLY to keep `allowed_tools` from
 * naming a tool that does not exist (a fail-closed AUTHORING check at write time),
 * so a published skill cannot advertise a phantom tool.
 *
 * These are the autopilot MCP tools an agent actually invokes: `knowledge_*` are the
 * unified-store file tools (`mcp-tools/knowledge.ts`); `run_code` is the code-mode
 * tool (`mcp-tools/run-code.ts`); the `task_*` / `schedule_*` tools are the
 * board/scheduling surface. (Note: `questpie.files.*` is an in-SANDBOX binding
 * available to `run_code` guest code, NOT an agent-facing MCP tool, so it is NOT in
 * this vocabulary.)
 */
export const KNOWN_SKILL_TOOLS: ReadonlySet<string> = new Set([
	"knowledge_read",
	"knowledge_write",
	"knowledge_list",
	"knowledge_delete",
	"knowledge_search",
	"run_code",
	"task_create",
	"task_list",
	"task_get",
	"task_update",
	"task_cancel",
	"task_retry",
	"task_dependencies",
	"task_dependents",
	"schedule_list",
	"schedule_get",
	"schedule_trigger",
]);

/**
 * The parsed, validated frontmatter MIRROR stored in `metadata.skill`. Discovery
 * reads ONLY `name` + `description` from this (Anthropic L1, ~100 tok/skill); the
 * rest is governance/provenance metadata.
 */
export interface SkillFrontmatter {
	/** Lowercase-hyphen slug, ≤64 chars — the trigger identity. */
	name: string;
	/** WHAT the skill does + WHEN to use it, ≤1024 chars — the trigger signal. */
	description: string;
	/** Free-form version string (semver-like; versioned like code). */
	version?: string;
	/**
	 * `"published"` = human-approved → injectable as L1 guidance. `"draft"` =
	 * agent-self-authored / unreviewed → NEVER injected (§8.5/§8.7).
	 */
	status: "draft" | "published";
	/** Optional natural-language trigger phrases (advisory; NOT the auth). */
	triggers?: string[];
	/**
	 * Optional TOOL allowlist for the skill's procedure — names from
	 * {@link KNOWN_SKILL_TOOLS}. ADVISORY metadata: it is surfaced to the agent as
	 * data but is NOT enforced by a tool-layer gate in this cut (the gate is
	 * DEFERRED — see {@link KNOWN_SKILL_TOOLS}). Write-time validation only rejects a
	 * name OUTSIDE the vocabulary, so a published skill cannot advertise a tool that
	 * does not exist.
	 */
	allowed_tools?: string[];
	/** Optional sibling L3 file paths the body references (relative). */
	references?: string[];
}

/** Error thrown when SKILL.md frontmatter is absent, malformed, or over-limit. */
export class SkillFrontmatterError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SkillFrontmatterError";
	}
}

/**
 * zod schema for the validated frontmatter. Enforces the Anthropic limits + the
 * lowercase-hyphen `name`, the `status` enum, and the tool vocabulary. `.strict()`
 * so an UNKNOWN frontmatter key fails closed (it is never carried into the mirror).
 */
const skillFrontmatterSchema = z
	.object({
		name: z
			.string()
			.min(1, "skill `name` is required")
			.max(SKILL_NAME_MAX, `skill \`name\` must be ≤${SKILL_NAME_MAX} chars`)
			.regex(
				SKILL_NAME_RE,
				"skill `name` must be a lowercase-hyphen slug (e.g. make-a-miniapp)",
			),
		description: z
			.string()
			.min(1, "skill `description` is required (WHAT the skill does + WHEN to use it)")
			.max(
				SKILL_DESCRIPTION_MAX,
				`skill \`description\` must be ≤${SKILL_DESCRIPTION_MAX} chars`,
			),
		version: z.string().min(1).optional(),
		status: z.enum(["draft", "published"]),
		triggers: z.array(z.string().min(1)).optional(),
		allowed_tools: z
			.array(
				z
					.string()
					.min(1)
					.refine((t) => KNOWN_SKILL_TOOLS.has(t), {
						message: `unknown tool (allowed: ${[...KNOWN_SKILL_TOOLS].join(", ")})`,
					}),
			)
			.optional(),
		references: z.array(z.string().min(1)).optional(),
	})
	.strict();

/**
 * Split a SKILL.md `body` into its `---`-fenced frontmatter block and the
 * remaining markdown. Fails closed if the body does not OPEN with a `---` fence or
 * the fence is never closed.
 */
function splitFrontmatter(body: string): { frontmatter: string; rest: string } {
	// Tolerate a leading BOM / blank lines before the opening fence is NOT allowed:
	// the Anthropic convention is the frontmatter is the very first thing. We do
	// allow a leading newline only (common from editors), nothing else.
	const normalized = body.startsWith("\n") ? body.slice(1) : body;
	if (!normalized.startsWith("---")) {
		throw new SkillFrontmatterError(
			"SKILL.md must open with a `---` YAML frontmatter fence",
		);
	}
	// The opening fence is the first line; it must be exactly `---`.
	const firstNewline = normalized.indexOf("\n");
	if (firstNewline === -1 || normalized.slice(0, firstNewline).trim() !== "---") {
		throw new SkillFrontmatterError("malformed opening `---` frontmatter fence");
	}
	const afterOpen = normalized.slice(firstNewline + 1);
	// Find the closing fence: a line that is exactly `---` (or `...`).
	const lines = afterOpen.split("\n");
	let closeIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === "---" || trimmed === "...") {
			closeIdx = i;
			break;
		}
	}
	if (closeIdx === -1) {
		throw new SkillFrontmatterError("unterminated frontmatter (no closing `---`)");
	}
	return {
		frontmatter: lines.slice(0, closeIdx).join("\n"),
		rest: lines.slice(closeIdx + 1).join("\n"),
	};
}

/** Strip a trailing `# comment` from a scalar/line (respecting quotes). */
function stripComment(line: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === "#" && !inSingle && !inDouble) {
			// A `#` starts a comment only when preceded by whitespace or at line start.
			if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
		}
	}
	return line;
}

/** Unquote a scalar token (`"x"` / `'x'`) or return the trimmed bareword. */
function parseScalar(raw: string): string | number | boolean {
	const value = raw.trim();
	if (value.length === 0) return "";
	const first = value[0];
	if ((first === '"' || first === "'") && value.endsWith(first) && value.length >= 2) {
		const inner = value.slice(1, -1);
		// Only support simple escapes inside double quotes; reject nothing — a
		// literal backslash is kept (frontmatter strings are plain text).
		return first === '"' ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n") : inner;
	}
	// Barewords: a few well-known scalars, else the string as-is.
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null" || value === "~") return "";
	if (/^-?\d+$/.test(value)) return Number(value);
	return value;
}

/** Parse an inline `[a, "b", c]` flow array into a string list. */
function parseInlineArray(raw: string): string[] {
	const body = raw.trim();
	if (body === "[]") return [];
	const inner = body.slice(1, -1);
	if (inner.trim().length === 0) return [];
	// Split on commas that are NOT inside quotes.
	const items: string[] = [];
	let buf = "";
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		if (ch === "," && !inSingle && !inDouble) {
			items.push(buf);
			buf = "";
			continue;
		}
		buf += ch;
	}
	items.push(buf);
	return items.map((it) => {
		const scalar = parseScalar(it);
		if (typeof scalar !== "string") {
			throw new SkillFrontmatterError(
				`array items must be strings (got ${JSON.stringify(scalar)})`,
			);
		}
		return scalar;
	});
}

/**
 * Parse the RESTRICTED frontmatter subset into a null-prototype record. Accepts
 * ONLY top-level `key: value` entries where `value` is a scalar, an inline flow
 * array, or an empty value followed by an indented block `- item` list. Anything
 * else (nested maps, tags `!x`, anchors `&a`/`*a`, merge `<<`, tabs) FAILS CLOSED.
 */
function parseRestrictedYaml(text: string): Record<string, unknown> {
	const out = Object.create(null) as Record<string, unknown>;
	const lines = text.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];
		// Skip blank lines and whole-line comments.
		if (rawLine.trim().length === 0) continue;
		if (rawLine.trimStart().startsWith("#")) continue;

		if (rawLine.includes("\t")) {
			throw new SkillFrontmatterError(
				"frontmatter must not contain tabs (use spaces)",
			);
		}
		// Top-level keys start at column 0 (no leading indentation).
		if (/^\s/.test(rawLine)) {
			throw new SkillFrontmatterError(
				`unexpected indentation in frontmatter: ${JSON.stringify(rawLine)}`,
			);
		}
		// Reject YAML features we do not support, fail-closed.
		const lineNoComment = stripComment(rawLine);
		const colon = lineNoComment.indexOf(":");
		if (colon === -1) {
			throw new SkillFrontmatterError(
				`expected \`key: value\` in frontmatter: ${JSON.stringify(rawLine)}`,
			);
		}
		const key = lineNoComment.slice(0, colon).trim();
		if (key.length === 0) {
			throw new SkillFrontmatterError("empty frontmatter key");
		}
		if (FORBIDDEN_KEYS.has(key)) {
			throw new SkillFrontmatterError(`forbidden frontmatter key "${key}"`);
		}
		if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
			throw new SkillFrontmatterError(`invalid frontmatter key "${key}"`);
		}
		if (Object.prototype.hasOwnProperty.call(out, key)) {
			throw new SkillFrontmatterError(`duplicate frontmatter key "${key}"`);
		}

		const valuePart = lineNoComment.slice(colon + 1).trim();

		if (valuePart.length === 0) {
			// Either an empty scalar OR the header of a block `- item` list on the
			// following indented lines. Look ahead for `  - ` entries.
			const items: string[] = [];
			let j = i + 1;
			for (; j < lines.length; j++) {
				const next = lines[j];
				if (next.trim().length === 0) continue;
				if (next.trimStart().startsWith("#")) continue;
				const m = next.match(/^(\s+)-\s?(.*)$/);
				if (!m) break;
				if (next.includes("\t")) {
					throw new SkillFrontmatterError("block list must not use tabs");
				}
				const scalar = parseScalar(m[2]);
				if (typeof scalar !== "string") {
					throw new SkillFrontmatterError("block list items must be strings");
				}
				items.push(scalar);
			}
			if (items.length > 0) {
				Object.defineProperty(out, key, {
					value: items,
					enumerable: true,
					writable: true,
					configurable: true,
				});
				i = j - 1;
			} else {
				Object.defineProperty(out, key, {
					value: "",
					enumerable: true,
					writable: true,
					configurable: true,
				});
			}
			continue;
		}

		// Reject anchors/aliases/tags/merge-keys outright (fail-closed).
		if (/^[&*!]|^<<\s*:/.test(valuePart)) {
			throw new SkillFrontmatterError(
				`unsupported YAML feature in frontmatter: ${JSON.stringify(valuePart)}`,
			);
		}

		let value: unknown;
		if (valuePart.startsWith("[")) {
			if (!valuePart.endsWith("]")) {
				throw new SkillFrontmatterError(
					`unterminated inline array for "${key}"`,
				);
			}
			value = parseInlineArray(valuePart);
		} else if (valuePart.startsWith("{")) {
			throw new SkillFrontmatterError(
				`nested maps are not supported in frontmatter ("${key}")`,
			);
		} else {
			value = parseScalar(valuePart);
		}

		Object.defineProperty(out, key, {
			value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}

	return out;
}

/**
 * Parse + validate a SKILL.md `body` into its frontmatter mirror.
 *
 * @param body - the raw SKILL.md document (frontmatter + markdown).
 * @returns the validated {@link SkillFrontmatter} (the `metadata.skill` mirror).
 * @throws {SkillFrontmatterError} when the frontmatter is absent, malformed, uses
 *   an unsupported YAML feature, or violates the Anthropic limits / vocabulary.
 */
export function parseSkillFrontmatter(body: string): SkillFrontmatter {
	if (typeof body !== "string") {
		throw new SkillFrontmatterError("SKILL.md body must be a string");
	}
	const { frontmatter } = splitFrontmatter(body);
	const raw = parseRestrictedYaml(frontmatter);

	const result = skillFrontmatterSchema.safeParse(raw);
	if (!result.success) {
		const first = result.error.issues[0];
		const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
		throw new SkillFrontmatterError(
			`invalid SKILL.md frontmatter — ${path}${first?.message ?? "validation failed"}`,
		);
	}
	return result.data;
}

/**
 * The SKILL.md body with its YAML frontmatter stripped — the markdown procedure
 * only. Used to materialise a published skill as a harness-NATIVE skill
 * (`HarnessAgentSkill.content`): the claude-code adapter re-adds its own
 * `name`/`description` frontmatter fence, so the QUESTPIE frontmatter must NOT be
 * carried into `content` (it would double the fence). Throws (via
 * {@link splitFrontmatter}) if the body has no opening `---` fence.
 */
export function skillBodyWithoutFrontmatter(body: string): string {
	return splitFrontmatter(body).rest;
}
