/**
 * The independent Studio projection producer.
 *
 * Studio explains a compiled application. This turns the canonical artifact
 * bytes the Runtime already digest-verifies into the flat catalogs
 * `studio-purpose.md` decided the entrance opens onto: Resources, Operations,
 * and migrations, addressed by canonical identity.
 *
 * Independence is the point, and it is structural rather than stated. This
 * module reads *bytes* and shares nothing with the compiler that produced them
 * — no import from `@questpie/compiler`, no in-process object, and its own
 * canonical serialization. A divergence introduced in either path therefore
 * shows up as a digest difference instead of cancelling out.
 */

export type StudioResource = Readonly<{ identity: string; kind: string }>;

export type StudioOperation = Readonly<{
	identity: string;
	/** Recorded, not used to hide: Studio explains server-only Operations too. */
	network: boolean;
}>;

export type StudioCatalog = Readonly<{
	application: string;
	resources: readonly StudioResource[];
	operations: readonly StudioOperation[];
	migrations: readonly string[];
}>;

export type StudioArtifactBytes = Readonly<Record<string, string>>;

function parsed(
	artifacts: StudioArtifactBytes,
	path: string,
): Readonly<Record<string, unknown>> {
	const raw = artifacts[path];
	if (raw === undefined)
		throw new TypeError(`Studio projection requires ${path}`);
	const value = JSON.parse(raw) as unknown;
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} is not a canonical artifact`);
	return value as Readonly<Record<string, unknown>>;
}

function entries(
	value: Readonly<Record<string, unknown>>,
	key: string,
	path: string,
): readonly Readonly<Record<string, unknown>>[] {
	const list = value[key];
	if (!Array.isArray(list)) throw new TypeError(`${path} has no ${key}`);
	return list as readonly Readonly<Record<string, unknown>>[];
}

function text(
	value: Readonly<Record<string, unknown>>,
	key: string,
	label: string,
): string {
	const member = value[key];
	if (typeof member !== "string" || member.length === 0)
		throw new TypeError(`${label}.${key} must be nonempty text`);
	return member;
}

export function projectStudioCatalog(
	artifacts: StudioArtifactBytes,
): StudioCatalog {
	const manifest = parsed(artifacts, "manifest.json");
	const contracts = parsed(artifacts, "operation-contracts.json");
	const migrations = parsed(artifacts, "committed-migrations.json");
	const application = manifest.application;
	if (!application || typeof application !== "object")
		throw new TypeError("manifest.application is missing");
	const composition = manifest.composition;
	if (!composition || typeof composition !== "object")
		throw new TypeError("manifest.composition is missing");
	return Object.freeze({
		application: text(
			application as Readonly<Record<string, unknown>>,
			"name",
			"manifest.application",
		),
		resources: Object.freeze(
			entries(
				composition as Readonly<Record<string, unknown>>,
				"resources",
				"manifest.json",
			)
				.map((entry) => {
					// A Resource Identity is `<kind>:<name>`, and the kind is the
					// half Studio groups a catalog by.
					const identity = text(entry, "identity", "resource");
					const separator = identity.indexOf(":");
					if (separator <= 0)
						throw new TypeError(`resource identity ${identity} has no kind`);
					return Object.freeze({
						identity,
						kind: identity.slice(0, separator),
					});
				})
				.sort((left, right) => (left.identity < right.identity ? -1 : 1)),
		),
		operations: Object.freeze(
			entries(contracts, "operations", "operation-contracts.json")
				.map((entry) =>
					Object.freeze({
						identity: text(entry, "identity", "operation"),
						network: entry.network === true,
					}),
				)
				.sort((left, right) => (left.identity < right.identity ? -1 : 1)),
		),
		migrations: Object.freeze(
			entries(migrations, "migrations", "committed-migrations.json")
				.map((entry) => text(entry, "identity", "migration"))
				.sort(),
		),
	});
}

/**
 * Canonical bytes of the catalog, so two producers can be compared for byte
 * parity without depending on object key order or on how either got there.
 */
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => (left < right ? -1 : 1))
			.map(([key, member]) => `${JSON.stringify(key)}:${canonical(member)}`)
			.join(",")}}`;
	return JSON.stringify(value ?? null);
}

export function studioProjectionBytes(artifacts: StudioArtifactBytes): string {
	return canonical(projectStudioCatalog(artifacts));
}

export type StudioExplainedPolicy = Readonly<{
	identity: string;
	target: string;
	origin: string | null;
}>;

export type StudioExplainedOperation = Readonly<{
	identity: string;
	owner: string | null;
	origin: string | null;
}>;

export type StudioExplain = Readonly<{
	policies: readonly StudioExplainedPolicy[];
	operations: readonly StudioExplainedOperation[];
}>;

/**
 * The compiler records where each Policy and Collection Operation came from.
 * Studio's job is to explain the compiled application, and an explanation
 * without provenance is a listing — so the projection keeps identity, what it
 * targets or owns, and the recorded origin, and drops the lowered programs,
 * which are compiler detail rather than something an operator reads.
 *
 * Explain artifacts are public contract, not operational fact, so this lane
 * carries no disclosure question. That is why it is buildable at this base
 * while the operational reads stay server-internal.
 */
function originOf(value: Readonly<Record<string, unknown>>): string | null {
	const origin = value.origin;
	if (typeof origin === "string") return origin;
	if (origin && typeof origin === "object" && !Array.isArray(origin)) {
		const path = (origin as Readonly<Record<string, unknown>>).logicalPath;
		if (typeof path === "string") return path;
	}
	return null;
}

export function projectStudioExplain(
	artifacts: StudioArtifactBytes,
): StudioExplain {
	const relational = parsed(artifacts, "relational-explain.json");
	const operations = parsed(artifacts, "collection-operation-explain.json");
	return Object.freeze({
		policies: Object.freeze(
			entries(relational, "policies", "relational-explain.json")
				.map((entry) =>
					Object.freeze({
						identity: text(entry, "identity", "policy"),
						target: text(entry, "target", "policy"),
						origin: originOf(entry),
					}),
				)
				.sort((left, right) => (left.identity < right.identity ? -1 : 1)),
		),
		operations: Object.freeze(
			entries(operations, "resources", "collection-operation-explain.json")
				.map((entry) =>
					Object.freeze({
						identity: text(entry, "identity", "operation"),
						owner: typeof entry.owner === "string" ? entry.owner : null,
						origin: originOf(entry),
					}),
				)
				.sort((left, right) => (left.identity < right.identity ? -1 : 1)),
		),
	});
}
