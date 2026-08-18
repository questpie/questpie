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

/**
 * Where one projected fact came from.
 *
 * `freshness-and-provenance.md` decided per-answer provenance rather than a
 * global freshness header, and a contract fact's source is the artifact that
 * declared it. There is deliberately no timestamp: a compiled artifact has no
 * meaningful clock, and the record chose identity over time precisely because
 * a staleness figure nothing can honestly populate teaches operators to trust
 * decoration.
 *
 * It sits on the fact rather than on the catalog because Studio lifts facts out
 * of the catalog into detail views. Container-level provenance would satisfy
 * the criterion and lose the property it exists for — that a joined view is
 * never presented as one authoritative record.
 */
export type StudioProvenance = Readonly<{
	source: "artifact";
	artifact: string;
	/**
	 * The Runtime Build the artifact came from, so two facts can never be joined
	 * across builds without it being visible. `freshness-and-provenance.md` chose
	 * this over a timestamp deliberately: the identity is the stronger statement.
	 */
	runtimeBuild: string;
}>;

export type StudioResource = Readonly<{
	identity: string;
	kind: string;
	provenance: StudioProvenance;
}>;

export type StudioOperation = Readonly<{
	identity: string;
	/** Recorded, not used to hide: Studio explains server-only Operations too. */
	network: boolean;
	provenance: StudioProvenance;
}>;

/**
 * A migration is an object rather than a bare identity string only so it can
 * carry its source. A string cannot, and "a fact with no source is not
 * rendered" is the load-bearing half of the provenance decision.
 */
export type StudioMigration = Readonly<{
	identity: string;
	provenance: StudioProvenance;
}>;

export type StudioCatalog = Readonly<{
	application: string;
	resources: readonly StudioResource[];
	operations: readonly StudioOperation[];
	migrations: readonly StudioMigration[];
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

/**
 * The Runtime Build these artifacts came from.
 *
 * Served as a projection rather than read from `runtime-build.json`, which the
 * mount does not serve: that artifact carries the executable inventory. The
 * identity also cannot be a compiled artifact of its own — the compiler builds
 * the inventory by excluding `runtime-build.json` and digesting every other
 * generated file, so a file containing the build digest would feed the digest
 * it contains.
 *
 * Required, not optional. A build that will not say which build it is cannot
 * have its facts rendered, which is the same rule as "a fact with no source is
 * not rendered" applied one level up.
 */
function buildIdentity(artifacts: StudioArtifactBytes): string {
	const identity = parsed(artifacts, "runtime-build-identity.json");
	return text(identity, "digest", "runtime-build-identity.json");
}

/**
 * Built from the same `path` constant the bytes were read through, so a fact
 * cannot be attributed to an artifact it did not come from.
 */
function from(path: string, runtimeBuild: string): StudioProvenance {
	return Object.freeze({
		source: "artifact" as const,
		artifact: path,
		runtimeBuild,
	});
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
	const build = buildIdentity(artifacts);
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
						provenance: from("manifest.json", build),
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
						provenance: from("operation-contracts.json", build),
					}),
				)
				.sort((left, right) => (left.identity < right.identity ? -1 : 1)),
		),
		migrations: Object.freeze(
			entries(migrations, "migrations", "committed-migrations.json")
				.map((entry) =>
					Object.freeze({
						identity: text(entry, "identity", "migration"),
						provenance: from("committed-migrations.json", build),
					}),
				)
				.sort((left, right) => (left.identity < right.identity ? -1 : 1)),
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
	provenance: StudioProvenance;
}>;

export type StudioExplainedOperation = Readonly<{
	identity: string;
	owner: string | null;
	origin: string | null;
	provenance: StudioProvenance;
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
	const build = buildIdentity(artifacts);
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
						provenance: from("relational-explain.json", build),
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
						provenance: from("collection-operation-explain.json", build),
					}),
				)
				.sort((left, right) => (left.identity < right.identity ? -1 : 1)),
		),
	});
}

export type StudioRunExecutable = Readonly<{
	compatible: boolean;
	/**
	 * `resourceAbsent` and `executableRetired` are different operator problems.
	 * The first means the Reaction is gone from this build; the second means it
	 * is present but the run pins bytes this build no longer carries. Collapsing
	 * them would tell an operator to look in the wrong place.
	 */
	reason: "executableRetired" | "resourceAbsent" | null;
	expectedDigest: string | null;
}>;

/**
 * Explains why a run is not progressing when the durable log cannot.
 *
 * A claim whose executable digest no longer matches returns `EXECUTABLE_RETIRED`
 * from a transaction that has only selected, so it writes nothing: the run stays
 * `ready` with a history containing only `accepted`, and looks healthy. The
 * compiled contract is the only witness, which is why this is a join against
 * the reaction projection rather than a durable read.
 *
 * Deliberately not a kernel change. Recording the refusal durably would need a
 * schema and would still leave every already-refused run unexplained.
 */
export function explainRunExecutable(
	run: Readonly<{ resource: string; executableDigest: string }>,
	artifacts: StudioArtifactBytes,
): StudioRunExecutable {
	const projection = parsed(artifacts, "reaction-projection.json");
	const declared = entries(
		projection,
		"reactions",
		"reaction-projection.json",
	).find((entry) => text(entry, "identity", "reaction") === run.resource);
	if (!declared)
		return Object.freeze({
			compatible: false,
			reason: "resourceAbsent" as const,
			expectedDigest: null,
		});
	const expectedDigest = text(declared, "contractDigest", "reaction");
	return Object.freeze({
		compatible: expectedDigest === run.executableDigest,
		reason:
			expectedDigest === run.executableDigest
				? null
				: ("executableRetired" as const),
		expectedDigest,
	});
}
