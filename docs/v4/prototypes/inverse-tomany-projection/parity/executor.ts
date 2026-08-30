import { linkArtifacts, projectArtifacts, v2Vector } from "../artifacts/v2";
import {
	collectSelectionDependencies,
	ObservedResult,
} from "../live-query/dependencies";
import {
	decodeInverseList,
	type InverseListRow,
} from "../postgres/proof-kernel";

export type InvocationResult =
	| Readonly<{ kind: "result"; value: ReturnType<typeof decodeInverseList> }>
	| Readonly<{
			kind: "failure";
			code: "CANCELLED" | "DEADLINE_EXCEEDED" | "INTERNAL" | "QUERY_LIMIT";
	  }>;

export interface LinkedInverseKernel {
	readonly statementSql: string;
	execute(
		rows: readonly InverseListRow[],
		input: Readonly<{
			rootFirst: number;
			childFirst: number;
			resultBytes: number;
			signal?: AbortSignal;
		}>,
	): InvocationResult;
}

function normalizeFailure(error: unknown): InvocationResult {
	if (error instanceof Error && error.message.includes("QP-DATA-012"))
		return Object.freeze({ kind: "failure", code: "QUERY_LIMIT" });
	if (error instanceof Error && error.message === "cancelled")
		return Object.freeze({ kind: "failure", code: "CANCELLED" });
	if (error instanceof Error && error.message === "deadline")
		return Object.freeze({ kind: "failure", code: "DEADLINE_EXCEEDED" });
	return Object.freeze({ kind: "failure", code: "INTERNAL" });
}

export function createLinkedInverseKernel(): LinkedInverseKernel {
	const artifacts = projectArtifacts(v2Vector);
	linkArtifacts(artifacts);
	const statement = artifacts.plans.plans[0]?.statement;
	if (!statement)
		throw new TypeError("readiness: missing executable statement");
	return Object.freeze({
		statementSql: statement.sql,
		execute(
			rows: readonly InverseListRow[],
			input: Parameters<LinkedInverseKernel["execute"]>[1],
		) {
			try {
				return Object.freeze({
					kind: "result" as const,
					value: decodeInverseList(rows, input),
				});
			} catch (error) {
				return normalizeFailure(error);
			}
		},
	});
}

export function invokeDirect(
	kernel: LinkedInverseKernel,
	rows: readonly InverseListRow[],
	input: Parameters<LinkedInverseKernel["execute"]>[1],
): InvocationResult {
	return kernel.execute(rows, input);
}

export function invokeGeneratedNetworkClient(
	kernel: LinkedInverseKernel,
	rows: readonly InverseListRow[],
	input: Parameters<LinkedInverseKernel["execute"]>[1],
): InvocationResult {
	const request = JSON.parse(
		JSON.stringify({
			rootFirst: input.rootFirst,
			childFirst: input.childFirst,
			resultBytes: input.resultBytes,
		}),
	) as Omit<typeof input, "signal">;
	const response = kernel.execute(rows, { ...request, signal: input.signal });
	return JSON.parse(JSON.stringify(response)) as InvocationResult;
}

export function createWatch(
	kernel: LinkedInverseKernel,
	rows: readonly InverseListRow[],
	input: Parameters<LinkedInverseKernel["execute"]>[1],
) {
	const result = kernel.execute(rows, input);
	const plan = collectSelectionDependencies(
		"collection:tickets",
		{
			identity: "policy:tickets.default",
			evidenceCollections: ["collection:memberships"],
			tenant: true,
		},
		[
			{
				kind: "toManyList",
				relation: "collection:tickets/relation:comments",
				collection: "collection:comments",
				policy: {
					identity: "policy:comments.default",
					evidenceCollections: ["collection:commentReaders"],
					tenant: true,
				},
				select: [],
			},
		],
	);
	return new ObservedResult(plan, result);
}
