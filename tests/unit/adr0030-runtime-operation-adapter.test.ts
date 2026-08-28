import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
	createCollectionOperationAdapterExecutor,
	linkCollectionOperationAdapters,
} from "../../packages/runtime/src/mutation";
import { canonicalMutationBytes } from "../../packages/runtime/src/mutation/canonical";
import { linkCollectionMutationPrograms } from "../../packages/runtime/src/mutation/program";

function digest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0`)
		.update(canonicalMutationBytes(value))
		.digest("hex");
}

const kernel = {
	identity: "mutation:__collectionKernel.records.create",
	kind: "mutation",
	mode: "writeTransaction",
	target: "collection:records",
	member: "create",
	policy: "policy:records.default",
	keyFields: [],
	callerInputFields: [["body"], ["title"]],
	requiredCallerInputFields: [["body"]],
	trustedValueFields: [["createdAt"], ["id"]],
	requiredTrustedValueFields: [["createdAt"]],
	selectedFieldPaths: [["body"], ["createdAt"], ["id"], ["title"]],
	dataQuery: null,
	dataQueryDigest: null,
	normalizerProgramDigest: null,
	serverValueProgramDigest: null,
	outputCardinality: "one",
	limits: {
		inputBytes: 65_536,
		resultBytes: 1_048_576,
		rowsWritten: 100,
		durationMilliseconds: 5_000,
	},
} as const;

const updateKernel = {
	...kernel,
	identity: "mutation:__collectionKernel.records.update",
	member: "update",
	keyFields: [["id"]],
	callerInputFields: [["body"]],
	requiredCallerInputFields: [],
	trustedValueFields: [["updatedAt"]],
	requiredTrustedValueFields: [],
	selectedFieldPaths: [["body"], ["id"], ["updatedAt"]],
	outputCardinality: "optionalOne",
} as const;

const normalizer = {
	artifact: "questpie.field-normalizer-program",
	version: 1,
	target: "collection:records",
	operation: "create",
	steps: [
		{
			target: ["body"],
			expression: { kind: "trim", source: ["body"] },
		},
	],
	capabilities: [],
} as const;

const serverValues = {
	artifact: "questpie.server-value-program",
	version: 1,
	target: "collection:records",
	operation: "create",
	assignments: [
		{
			target: ["createdAt"],
			mode: "overwrite",
			source: ["operationTime"],
		},
	],
	capabilities: [],
} as const;

const updateServerValues = {
	...serverValues,
	operation: "update",
	assignments: [
		{
			target: ["updatedAt"],
			mode: "overwrite",
			source: ["operationTime"],
		},
	],
} as const;

function linkedAdapters() {
	const kernels = linkCollectionMutationPrograms({
		collectionOperations: {
			format: "questpie.collection-operation-programs",
			version: 1,
			operations: [kernel, updateKernel],
		},
		fieldNormalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [],
		},
		policies: [
			{ identity: "policy:records.default", target: "collection:records" },
		],
	});
	return linkCollectionOperationAdapters({
		artifact: {
			format: "questpie.collection-operation-adapters",
			version: 1,
			adapters: [
				{
					identity: "mutation:records.create",
					target: "collection:records",
					member: "create",
					kernelIdentity: kernel.identity,
					keyFields: [],
					callerInputFields: [["body"]],
					requiredCallerInputFields: [["body"]],
					selectedFieldPaths: [["id"], ["body"]],
					normalizerProgramDigest: digest(
						"questpie-field-normalizer-program-v1",
						normalizer,
					),
					serverValueProgramDigest: digest(
						"questpie-server-value-program-v1",
						serverValues,
					),
					outputCardinality: "one",
					limits: kernel.limits,
				},
				{
					identity: "mutation:records.update",
					target: "collection:records",
					member: "update",
					kernelIdentity: updateKernel.identity,
					keyFields: [["id"]],
					callerInputFields: [["body"]],
					requiredCallerInputFields: [],
					selectedFieldPaths: [["id"], ["body"]],
					normalizerProgramDigest: null,
					serverValueProgramDigest: digest(
						"questpie-server-value-program-v1",
						updateServerValues,
					),
					outputCardinality: "optionalOne",
					limits: updateKernel.limits,
				},
			],
		},
		fieldNormalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [normalizer],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [serverValues, updateServerValues],
		},
		kernels,
	});
}

test("validates and projects an Operation Set write around one kernel delegation", async () => {
	const operationTime = new Date("2026-08-28T10:00:00.000Z");
	const calls: unknown[] = [];
	const execute = createCollectionOperationAdapterExecutor({
		adapters: linkedAdapters(),
		facts: {
			operationTime,
			principal: { id: "principal-1", kind: "user" },
			tenant: { id: "tenant-1" },
		},
		invokeKernel: async (kernelIdentity, request) => {
			calls.push({ kernelIdentity, request });
			return {
				id: "record-1",
				body: "hello",
				title: "kernel-only",
				createdAt: operationTime,
			};
		},
	});

	await expect(
		execute("mutation:records.create", { input: { body: "  hello  " } }),
	).resolves.toEqual({ id: "record-1", body: "hello" });
	expect(calls).toEqual([
		{
			kernelIdentity: kernel.identity,
			request: {
				input: { body: "  hello  " },
				values: { createdAt: operationTime },
			},
		},
	]);
});

test("rejects input outside the pinned adapter before kernel delegation", async () => {
	let calls = 0;
	const execute = createCollectionOperationAdapterExecutor({
		adapters: linkedAdapters(),
		facts: {
			operationTime: new Date("2026-08-28T10:00:00.000Z"),
			principal: { id: "principal-1", kind: "user" },
			tenant: { id: "tenant-1" },
		},
		invokeKernel: async () => {
			calls += 1;
			return {};
		},
	});

	await expect(
		execute("mutation:records.create", {
			input: { body: "hello", title: "not pinned" },
		}),
	).rejects.toThrow(/undeclared Fields/);
	await expect(
		execute("mutation:records.create", { input: {} }),
	).rejects.toThrow(/missing required Fields/);
	expect(calls).toBe(0);
});

test("preserves an omitted update patch separately from explicit null", async () => {
	const operationTime = new Date("2026-08-28T10:00:00.000Z");
	const calls: unknown[] = [];
	const execute = createCollectionOperationAdapterExecutor({
		adapters: linkedAdapters(),
		facts: {
			operationTime,
			principal: { id: "principal-1", kind: "user" },
			tenant: { id: "tenant-1" },
		},
		invokeKernel: async (kernelIdentity, request) => {
			calls.push({ kernelIdentity, request });
			return { id: "record-1", body: "current" };
		},
	});

	await execute("mutation:records.update", { key: { id: "record-1" } });
	await execute("mutation:records.update", {
		key: { id: "record-1" },
		expected: { body: "current" },
		patch: { body: null },
	});
	expect(calls).toEqual([
		{
			kernelIdentity: updateKernel.identity,
			request: {
				key: { id: "record-1" },
				patch: {},
				values: { updatedAt: operationTime },
			},
		},
		{
			kernelIdentity: updateKernel.identity,
			request: {
				key: { id: "record-1" },
				expected: { body: "current" },
				patch: { body: null },
				values: { updatedAt: operationTime },
			},
		},
	]);
});
