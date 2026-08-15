import { createHash } from "node:crypto";

import { CompilerDiagnosticError } from "../diagnostic";

const reservedApplicationSchemas = new Set([
	"information_schema",
	"pg_catalog",
	"public",
	"questpie_internal",
]);

function invalidPhysicalName(identity: string, candidate: string): never {
	throw new CompilerDiagnosticError(
		"QP-SCHEMA-005",
		"invalidPhysicalName",
		`${identity} has invalid PostgreSQL name ${candidate}`,
	);
}

export function shortenedPostgresName(
	identity: string,
	candidate: string,
): string {
	if (Buffer.byteLength(candidate) <= 63) return candidate;
	const suffix = createHash("sha256")
		.update(`questpie-postgres-name-v1\0${identity}`)
		.digest("hex")
		.slice(0, 12);
	let prefix = candidate;
	while (Buffer.byteLength(`${prefix}_${suffix}`) > 63)
		prefix = prefix.slice(0, -1);
	return `${prefix}_${suffix}`;
}

export function validatedPhysicalName(
	identity: string,
	candidate: string,
): string {
	if (
		!/^[a-z][a-z0-9_]*$/.test(candidate) ||
		Buffer.byteLength(candidate) > 63 ||
		candidate.startsWith("pg_") ||
		candidate.startsWith("questpie_")
	)
		return invalidPhysicalName(identity, candidate);
	return candidate;
}

export function validatedApplicationSchemaName(
	identity: string,
	candidate: string,
): string {
	const name = validatedPhysicalName(identity, candidate);
	if (reservedApplicationSchemas.has(name))
		return invalidPhysicalName(identity, candidate);
	return name;
}
