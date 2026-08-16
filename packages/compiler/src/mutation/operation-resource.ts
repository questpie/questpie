import { compareAscii, digest } from "../canonical";
import type { CollectionOperationProgramsV1 } from "./operation-set-contract";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

export function projectCollectionOperationResourceMetadata(
	input: Readonly<{
		sets: Readonly<{
			sets: readonly RecordValue[];
		}>;
		programs: CollectionOperationProgramsV1;
		origins: readonly RecordValue[];
	}>,
): Readonly<{
	compositionResources: readonly RecordValue[];
	resourceOrigins: readonly RecordValue[];
	explain: Readonly<{
		format: "questpie.collection-operation-explain";
		version: 1;
		resources: readonly RecordValue[];
	}>;
}> {
	const programs = new Map(
		input.programs.operations.map((program) => [program.identity, program]),
	);
	const compositionResources: RecordValue[] = [];
	const resourceOrigins: RecordValue[] = [];
	const explained: RecordValue[] = [];
	for (const setValue of input.sets.sets) {
		const set = record(setValue, "Collection Operation Set projection");
		const setOrigin = input.origins.find(
			(candidate) =>
				candidate.target === set.target && candidate.name === set.name,
		);
		if (!setOrigin)
			throw new TypeError(`missing Origin for ${String(set.name)}`);
		const establishedAt = record(
			setOrigin.establishedAt,
			"Collection Operation Set Origin",
		);
		const memberOrigins = setOrigin.members as readonly RecordValue[];
		for (const childValue of set.children as readonly unknown[]) {
			const child = record(childValue, "Collection Operation child");
			const identity = String(child.identity);
			const member = String(child.member);
			const program = programs.get(
				identity as CollectionOperationProgramsV1["operations"][number]["identity"],
			);
			if (!program)
				throw new TypeError(`missing executable program ${identity}`);
			const contract = {
				kind: child.kind,
				mode: child.mode,
				engine: child.engine,
				policy: child.policy,
				inputCodec: child.inputCodec,
				outputCodec: child.outputCodec,
				errors: child.errors,
				exposure: child.exposure,
				limits: child.limits,
				executableSlot: child.executableSlot,
			};
			compositionResources.push({
				identity,
				contributions: [],
				structuralContractDigest: digest(
					"questpie-structural-contract-v1",
					contract,
				),
			});
			const memberOrigin = memberOrigins.find(
				(candidate) => candidate.identity === identity,
			);
			resourceOrigins.push({
				identity,
				establishedAt: {
					kind: "collectionOperationSetMember",
					packageId: establishedAt.packageId,
					path: establishedAt.path,
					exportName: establishedAt.exportName,
					member,
					span: memberOrigin?.span ?? establishedAt.span,
					declaredAt: null,
				},
				augmentations: [],
				members: [],
			});
			explained.push({
				identity,
				owner: child.owner,
				origin: child.origin,
				contract,
				executable: {
					kind: "frameworkGenerated",
					slot: child.executableSlot,
					program: identity,
				},
				program,
			});
		}
	}
	const byIdentity = (left: RecordValue, right: RecordValue) =>
		compareAscii(String(left.identity), String(right.identity));
	compositionResources.sort(byIdentity);
	resourceOrigins.sort(byIdentity);
	explained.sort(byIdentity);
	return {
		compositionResources,
		resourceOrigins,
		explain: {
			format: "questpie.collection-operation-explain",
			version: 1,
			resources: explained,
		},
	};
}
