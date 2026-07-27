import type { Collection } from "#questpie/server/collection/builder/collection.js";
import type { AnyCollectionState } from "#questpie/server/collection/builder/types.js";
import { getCrdtFieldEligibilityIssues } from "#questpie/server/fields/crdt.js";
import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";
import type { Global } from "#questpie/server/global/builder/global.js";
import type { AnyGlobalState } from "#questpie/server/global/builder/types.js";

export type CrdtFieldRegistration =
	| Readonly<{ format: "text" }>
	| Readonly<{ format: "set"; conflict: "add-wins" }>;

export type CrdtOwnerRegistration = Readonly<{
	ownerName: string;
	awarenessSchema?: unknown;
	fields: Readonly<Record<string, CrdtFieldRegistration>>;
}>;

export type CrdtRegistry = Readonly<{
	collections: Readonly<Record<string, CrdtOwnerRegistration>>;
	globals: Readonly<Record<string, CrdtOwnerRegistration>>;
}>;

type CrdtRegistryInput = {
	collections: Record<string, Collection<AnyCollectionState>>;
	globals: Record<string, Global<AnyGlobalState>>;
};

function createOwnerRegistration(
	ownerKind: "collections" | "globals",
	ownerKey: string,
	owner: Collection<AnyCollectionState> | Global<AnyGlobalState>,
): CrdtOwnerRegistration | undefined {
	const fields: Record<string, CrdtFieldRegistration> = {};
	const fieldDefinitions = owner.state.fieldDefinitions ?? {};
	const collaborative = owner.state.collaborative;
	const markedFieldPaths = Object.keys(fieldDefinitions)
		.filter(
			(fieldPath) =>
				(fieldDefinitions[fieldPath] as Field<FieldState>)._state.crdt !==
				undefined,
		)
		.sort();

	if (markedFieldPaths.length === 0 && collaborative === undefined) {
		return undefined;
	}
	if (markedFieldPaths.length > 0 && collaborative === undefined) {
		throw new Error(
			`QUESTPIE CRDT owner "${ownerKind}.${ownerKey}" has field markers but is not collaborative`,
		);
	}
	if (markedFieldPaths.length === 0) {
		throw new Error(
			`QUESTPIE collaborative owner "${ownerKind}.${ownerKey}" has no CRDT fields`,
		);
	}
	if (
		ownerKind === "globals" &&
		"scoped" in owner.state.options &&
		owner.state.options.scoped !== undefined
	) {
		throw new Error(
			`QUESTPIE collaborative global "${ownerKind}.${ownerKey}" cannot be scoped`,
		);
	}
	if (
		collaborative?.awarenessSchema !== undefined &&
		typeof (collaborative.awarenessSchema as { safeParse?: unknown })
			.safeParse !== "function"
	) {
		throw new Error(
			`QUESTPIE collaborative owner "${ownerKind}.${ownerKey}" has an invalid awareness schema`,
		);
	}

	for (const fieldPath of markedFieldPaths) {
		const field = fieldDefinitions[fieldPath] as Field<FieldState>;

		const issues = getCrdtFieldEligibilityIssues(field);
		if (issues.length > 0) {
			throw new Error(
				`Invalid QUESTPIE CRDT field "${ownerKind}.${ownerKey}.${fieldPath}": ${issues.join(", ")}`,
			);
		}

		const capability = field._state.crdt!;
		fields[fieldPath] = Object.freeze(
			capability.format === "set"
				? { format: "set", conflict: "add-wins" }
				: { format: "text" },
		);
	}

	return Object.freeze({
		ownerName: owner.state.name,
		...(collaborative?.awarenessSchema
			? { awarenessSchema: collaborative.awarenessSchema }
			: {}),
		fields: Object.freeze(fields),
	});
}

function createOwnersRegistry(
	ownerKind: "collections" | "globals",
	owners: CrdtRegistryInput[typeof ownerKind],
): Readonly<Record<string, CrdtOwnerRegistration>> {
	const registry: Record<string, CrdtOwnerRegistration> = {};

	for (const ownerKey of Object.keys(owners).sort()) {
		const registration = createOwnerRegistration(
			ownerKind,
			ownerKey,
			owners[ownerKey]!,
		);
		if (registration) registry[ownerKey] = registration;
	}

	return Object.freeze(registry);
}

export function createCrdtRegistry(input: CrdtRegistryInput): CrdtRegistry {
	return Object.freeze({
		collections: createOwnersRegistry("collections", input.collections),
		globals: createOwnersRegistry("globals", input.globals),
	});
}
