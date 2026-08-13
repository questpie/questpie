import { readFileSync } from "node:fs";

type Slice = {
	release: string;
	promise: string;
	compatibility: Record<string, string>;
	beta1: Array<{
		id: string;
		requires: string[];
		owns: string;
		evidence: string;
	}>;
	deferred: Array<{ capability: string; seam: string; absence: string }>;
	laterBetas: string[];
	releaseGates: string[];
};

export function validate(slice: Slice): void {
	if (slice.release !== "4.0.0-beta.1" || !slice.promise)
		throw new Error("release promise missing");
	for (const key of ["data", "behavior", "source", "wire", "durable"])
		if (!slice.compatibility[key])
			throw new Error(`compatibility missing: ${key}`);
	const ids = slice.beta1.map(({ id }) => id);
	if (new Set(ids).size !== ids.length) throw new Error("duplicate beta slice");
	for (const item of slice.beta1) {
		if (!item.owns || !item.evidence)
			throw new Error(`incomplete beta slice ${item.id}`);
		for (const dependency of item.requires) {
			if (
				!ids.includes(dependency) ||
				ids.indexOf(dependency) >= ids.indexOf(item.id)
			)
				throw new Error(`invalid dependency ${item.id} -> ${dependency}`);
		}
	}
	for (const required of [
		"foundation",
		"schema",
		"services",
		"context-policy",
		"operations",
		"runtime-client",
		"realtime",
		"reaction",
		"studio",
		"connected-conformance",
	])
		if (!ids.includes(required))
			throw new Error(`missing beta slice ${required}`);
	const services = slice.beta1.find(({ id }) => id === "services");
	if (
		!services ||
		![
			"Service Definition",
			"application versus execution lifetime",
			"external-effect classification",
			"reverse-dependency cleanup",
			"Package isolation",
		].every((invariant) =>
			`${services.owns} ${services.evidence}`.includes(invariant),
		)
	)
		throw new Error("Service ownership incomplete");
	const contextPolicy = slice.beta1.find(({ id }) => id === "context-policy");
	if (!contextPolicy?.requires.includes("services"))
		throw new Error("Context/Policy must depend on Service lifetime");
	for (const capability of [
		"Action",
		"raw Route and credential Auth integration",
		"Job and Workflow breadth",
		"Channel",
		"File bytes",
		"Search",
		"OpenAPI, MCP and skills",
		"optional cache, broker and carrier",
		"split Runtime roles and remote Studio",
	])
		if (
			!slice.deferred.some(
				(item) => item.capability === capability && item.seam && item.absence,
			)
		)
			throw new Error(`missing deferral ${capability}`);
	if (slice.releaseGates.length < 8)
		throw new Error("release gates incomplete");
	const encoded = JSON.stringify(slice);
	for (const invariant of [
		"B-tree-only",
		"PostgreSQL",
		"no bundled auth",
		"no ORM types",
		"slice-owned performance budgets",
	])
		if (!encoded.includes(invariant))
			throw new Error(`missing invariant ${invariant}`);
}

if (import.meta.main) {
	const slice = JSON.parse(
		readFileSync(new URL("./SLICE.json", import.meta.url), "utf8"),
	) as Slice;
	validate(slice);
	console.log(
		`P15 beta slice: dependency closure and ${slice.deferred.length} absence stories valid`,
	);
}
