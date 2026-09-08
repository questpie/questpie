import type { NormalizedResource } from "../../../../packages/compiler/src/types";

// Compiler IR fixture: one contract input, no handwritten client DTOs or keys.
export const contextCodec = {
	kind: "object",
	properties: { companyId: { kind: "uuid" } },
} as const;

const task = {
	kind: "object",
	properties: {
		id: { kind: "uuid" },
		title: { kind: "text", maxLength: 200 },
		updatedAt: { kind: "timestamp", withTimezone: true },
	},
} as const;

function operation(
	kind: "query" | "mutation",
	name: string,
	contract: NormalizedResource["contract"],
): NormalizedResource {
	return {
		kind,
		name,
		identity: `${kind}:${name}`,
		contract: { exposure: "network", declaredErrors: {}, ...contract },
		contributions: [],
		origin: {
			logicalPath: "task-contract.fixture.ts",
			exportName: name.replaceAll(".", "_"),
			packageId: null,
			span: null,
			memberSpans: {},
		},
		value: {},
	};
}

export const resources: readonly NormalizedResource[] = [
	operation("query", "tasks.detail", {
		input: {
			kind: "object",
			properties: {
				id: { kind: "uuid" },
				asOf: {
					kind: "optional",
					codec: { kind: "timestamp", withTimezone: true },
				},
			},
		},
		output: { kind: "nullable", codec: task },
	}),
	operation("mutation", "tasks.transition", {
		input: {
			kind: "object",
			properties: {
				id: { kind: "uuid" },
				expectedVersion: { kind: "integer", minimum: 1 },
				targetStatus: { kind: "text", maxLength: 40 },
			},
		},
		output: task,
		declaredErrors: {
			versionConflict: {
				code: "VERSION_CONFLICT",
				status: 409,
				payload: {
					kind: "object",
					properties: { currentVersion: { kind: "integer", minimum: 1 } },
				},
			},
		},
	}),
];
