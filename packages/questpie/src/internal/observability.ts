import type { QuestpieObservability } from "../observability";

export const QUESTPIE_OBSERVABILITY_PACKAGE_VERSION = "4.0.0-beta.1" as const;

export type QuestpieObservationRuntimeMetadataV1 = Readonly<{
	format: "questpie.observation-runtime-metadata";
	version: 1;
	applicationIdentity: string;
	runtimeBuildDigest: string;
	runtimeInstanceId: string;
	signalProjectionDigest: string;
	questpieVersion: typeof QUESTPIE_OBSERVABILITY_PACKAGE_VERSION;
}>;

type OfficialObservationBinder = (
	metadata: QuestpieObservationRuntimeMetadataV1,
) => unknown;

type OfficialObservationPublicMembers = Readonly<{
	close: () => Promise<void>;
}>;

type HandleState = {
	readonly bind: OfficialObservationBinder;
	bound: boolean;
};

const handles = new WeakMap<object, HandleState>();
const metadataKeys = [
	"applicationIdentity",
	"format",
	"questpieVersion",
	"runtimeBuildDigest",
	"runtimeInstanceId",
	"signalProjectionDigest",
	"version",
] as const;
const digest = /^[0-9a-f]{64}$/u;
const uuidV4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const utf8 = new TextEncoder();

function boundedApplicationIdentity(value: unknown): value is string {
	if (typeof value !== "string") return false;
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
	}
	const bytes = utf8.encode(value).byteLength;
	return bytes >= 1 && bytes <= 256;
}

function failMetadata(): never {
	throw new TypeError("Runtime observation metadata is incompatible");
}

function snapshotMetadata(
	value: QuestpieObservationRuntimeMetadataV1,
): QuestpieObservationRuntimeMetadataV1 {
	if (typeof value !== "object" || value === null) return failMetadata();
	let keys: string[];
	try {
		keys = Object.keys(value).sort();
	} catch {
		return failMetadata();
	}
	if (
		keys.length !== metadataKeys.length ||
		metadataKeys.some((key, index) => key !== keys[index])
	)
		return failMetadata();
	let metadata: QuestpieObservationRuntimeMetadataV1;
	try {
		metadata = {
			format: value.format,
			version: value.version,
			applicationIdentity: value.applicationIdentity,
			runtimeBuildDigest: value.runtimeBuildDigest,
			runtimeInstanceId: value.runtimeInstanceId,
			signalProjectionDigest: value.signalProjectionDigest,
			questpieVersion: value.questpieVersion,
		};
	} catch {
		return failMetadata();
	}
	if (
		metadata.format !== "questpie.observation-runtime-metadata" ||
		metadata.version !== 1 ||
		!boundedApplicationIdentity(metadata.applicationIdentity) ||
		!digest.test(metadata.runtimeBuildDigest) ||
		!uuidV4.test(metadata.runtimeInstanceId) ||
		!digest.test(metadata.signalProjectionDigest) ||
		metadata.questpieVersion !== QUESTPIE_OBSERVABILITY_PACKAGE_VERSION
	)
		return failMetadata();
	return Object.freeze(metadata);
}

/** Internal bridge shared only by the generated Runtime and official adapter. */
export function createOfficialQuestpieObservability(
	bind: OfficialObservationBinder,
	publicMembers?: OfficialObservationPublicMembers,
): QuestpieObservability {
	if (typeof bind !== "function")
		throw new TypeError("Runtime observation binder is incompatible");
	if (
		publicMembers !== undefined &&
		(typeof publicMembers !== "object" ||
			publicMembers === null ||
			Object.keys(publicMembers).length !== 1 ||
			Object.keys(publicMembers)[0] !== "close" ||
			typeof publicMembers.close !== "function")
	)
		throw new TypeError("Runtime observation public members are incompatible");
	const handle = Object.assign(Object.create(null), publicMembers);
	Object.freeze(handle);
	handles.set(handle, { bind, bound: false });
	return handle as QuestpieObservability;
}

/** Consumes one official handle before Runtime readiness. */
export function bindOfficialQuestpieObservability(
	handle: unknown,
	metadata: QuestpieObservationRuntimeMetadataV1,
): unknown {
	if (
		(typeof handle !== "object" && typeof handle !== "function") ||
		handle === null
	)
		throw new TypeError("Runtime observation handle is incompatible");
	const state = handles.get(handle);
	if (state === undefined)
		throw new TypeError("Runtime observation handle is incompatible");
	const snapshot = snapshotMetadata(metadata);
	if (state.bound)
		throw new TypeError("Runtime observation handle is already bound");
	state.bound = true;
	return Reflect.apply(state.bind, undefined, [snapshot]);
}
