import {
	exactRuntimeArtifactKeys as exact,
	failRuntimeArtifact as fail,
	runtimeArtifactDigestValue as digestValue,
	runtimeArtifactRecord as record,
	runtimeArtifactString as string,
} from "./artifact-protocol";

type RuntimeExecutableSlotV1 = Readonly<{
	identity: string;
	kind: "context" | "query" | "service";
	slot: "create" | "dispose" | "handler" | "resolve";
	origin: Readonly<{
		path: string;
		exportName: string;
		packageId: string | null;
	}>;
	sourceDigest: string;
	contractDigest: string;
	runtimeGraphDigest: string;
	bundleExport: string;
}>;

export type RuntimeExecutablesV1 = Readonly<{
	format: "questpie.runtime-executables";
	version: 1;
	slots: readonly RuntimeExecutableSlotV1[];
}>;

export function decodeRuntimeExecutables(value: unknown): RuntimeExecutablesV1 {
	const artifact = record(value, "runtime executables");
	exact(artifact, ["format", "version", "slots"], "runtime executables");
	if (
		artifact.format !== "questpie.runtime-executables" ||
		artifact.version !== 1 ||
		!Array.isArray(artifact.slots)
	)
		fail("runtime executables header is invalid");
	const slots = artifact.slots.map((raw, index) => {
		const slot = record(raw, `slot ${index}`);
		exact(
			slot,
			[
				"identity",
				"kind",
				"slot",
				"origin",
				"sourceDigest",
				"contractDigest",
				"runtimeGraphDigest",
				"bundleExport",
			],
			`slot ${index}`,
		);
		if (
			(slot.kind !== "context" &&
				slot.kind !== "query" &&
				slot.kind !== "service") ||
			(slot.slot !== "create" &&
				slot.slot !== "dispose" &&
				slot.slot !== "handler" &&
				slot.slot !== "resolve") ||
			(slot.kind === "query" && slot.slot !== "handler") ||
			(slot.kind === "context" && slot.slot !== "resolve") ||
			(slot.kind === "service" &&
				slot.slot !== "create" &&
				slot.slot !== "dispose")
		)
			fail(`slot ${index} has an unsupported kind`);
		const origin = record(slot.origin, `slot ${index} origin`);
		exact(origin, ["path", "exportName", "packageId"], `slot ${index} origin`);
		if (origin.packageId !== null && typeof origin.packageId !== "string")
			fail(`slot ${index} packageId is invalid`);
		return Object.freeze({
			identity: string(slot.identity, `slot ${index} identity`),
			kind: slot.kind as RuntimeExecutableSlotV1["kind"],
			slot: slot.slot as RuntimeExecutableSlotV1["slot"],
			origin: Object.freeze({
				path: string(origin.path, `slot ${index} origin path`),
				exportName: string(origin.exportName, `slot ${index} origin export`),
				packageId: origin.packageId as string | null,
			}),
			sourceDigest: digestValue(slot.sourceDigest, `slot ${index} source`),
			contractDigest: digestValue(
				slot.contractDigest,
				`slot ${index} contract`,
			),
			runtimeGraphDigest: digestValue(
				slot.runtimeGraphDigest,
				`slot ${index} runtime graph`,
			),
			bundleExport: string(slot.bundleExport, `slot ${index} bundle export`),
		});
	});
	const identities = slots.map((slot) => `${slot.identity}#${slot.slot}`);
	if (
		new Set(identities).size !== identities.length ||
		identities.some(
			(identity, index) => identity !== [...identities].sort()[index],
		)
	)
		fail("runtime executable slots must be unique and sorted");
	return Object.freeze({
		format: "questpie.runtime-executables" as const,
		version: 1 as const,
		slots: Object.freeze(slots),
	});
}
