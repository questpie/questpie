import { decodeRuntimeCodec, encodeRuntimeCodec } from "../codec";
import type {
	JobAcceptance,
	JobAcceptanceOptions,
	JobAcceptanceReceipt,
	LinkedJobProjection,
	LinkedReactionMember,
	LinkedReactionProjection,
} from "../durable";
import { canonicalMutationBytes } from "./canonical";

export type PendingDurableDispatch = Readonly<{
	slot: string;
	resourceKind: "reaction";
	resource: LinkedReactionMember;
	payloadBytes: Uint8Array;
}>;

type JobCapability = Readonly<{
	accept(
		payload: unknown,
		options: JobAcceptanceOptions,
	): Promise<JobAcceptanceReceipt>;
}>;

function freezeJobCapabilities(
	jobs: LinkedJobProjection,
	jobAcceptance: JobAcceptance,
): Readonly<Record<string, unknown>> {
	const root: Record<string, unknown> = Object.create(null);
	for (const [member, job] of jobs.members) {
		const segments = member.split(".");
		let branch = root;
		for (const [index, segment] of segments.entries()) {
			const leaf = index === segments.length - 1;
			const existing = branch[segment];
			if (leaf) {
				if (existing !== undefined)
					throw new TypeError("Job capability path collides");
				branch[segment] = Object.freeze({
					async accept(payload: unknown, options: JobAcceptanceOptions) {
						return jobAcceptance.accept(job, payload, options);
					},
				} satisfies JobCapability);
				continue;
			}
			if (existing === undefined) {
				const child: Record<string, unknown> = Object.create(null);
				branch[segment] = child;
				branch = child;
				continue;
			}
			if (
				typeof existing !== "object" ||
				existing === null ||
				Object.hasOwn(existing, "accept")
			)
				throw new TypeError("Job capability path collides");
			branch = existing as Record<string, unknown>;
		}
	}
	const freeze = (branch: Record<string, unknown>): void => {
		for (const value of Object.values(branch)) {
			if (
				typeof value === "object" &&
				value !== null &&
				!Object.hasOwn(value, "accept")
			)
				freeze(value as Record<string, unknown>);
		}
		Object.freeze(branch);
	};
	freeze(root);
	return root;
}

/** Reactions retain one legacy fact slot; Jobs use independently keyed acceptance. */
export function createDurableDispatch(
	reactions: LinkedReactionProjection,
	jobs: LinkedJobProjection,
	jobAcceptance: JobAcceptance,
): Readonly<{
	dispatch: Readonly<Record<string, (payload: unknown) => Promise<void>>>;
	jobs: Readonly<Record<string, unknown>>;
	pending: readonly PendingDurableDispatch[];
}> {
	const pending: PendingDurableDispatch[] = [];
	const accept = (
		slot: string,
		resource: LinkedReactionMember,
		payload: unknown,
	) => {
		if (pending.length >= 1)
			throw new TypeError(
				"Mutation exceeded its pending durable dispatch limit",
			);
		const decoded = decodeRuntimeCodec(
			resource.input,
			payload,
			`$dispatch.${slot}`,
		);
		const payloadBytes = canonicalMutationBytes(
			encodeRuntimeCodec(resource.input, decoded, `$dispatch.${slot}`),
		);
		if (payloadBytes.byteLength > 262_144)
			throw new TypeError("Durable payload exceeds its byte limit");
		pending.push(
			Object.freeze({
				slot,
				resourceKind: "reaction" as const,
				resource,
				payloadBytes,
			}),
		);
	};
	const dispatch = Object.fromEntries(
		[...reactions.members].map(([member, reaction]) => [
			member,
			async (payload: unknown) => accept(member, reaction, payload),
		]),
	);
	return Object.freeze({
		dispatch: Object.freeze(dispatch),
		jobs: freezeJobCapabilities(jobs, jobAcceptance),
		pending,
	});
}
