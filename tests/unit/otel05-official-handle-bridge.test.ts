import { expect, test } from "bun:test";

import {
	bindOfficialQuestpieObservability,
	createOfficialQuestpieObservability,
	type QuestpieObservationRuntimeMetadataV1,
} from "questpie/internal/observability";

import { createApplicationObservation } from "../../packages/runtime/src/application/observation";
import type { ObservationAdapterV1 } from "../../packages/runtime/src/observation";

const metadata = Object.freeze({
	format: "questpie.observation-runtime-metadata",
	version: 1,
	applicationIdentity: "application:collaboration",
	runtimeBuildDigest: "a".repeat(64),
	runtimeInstanceId: "01234567-89ab-4def-8123-456789abcdef",
	signalProjectionDigest: "b".repeat(64),
	questpieVersion: "4.0.0-beta.2",
}) satisfies QuestpieObservationRuntimeMetadataV1;

test("binds one official opaque handle exactly once", () => {
	const adapter = Object.freeze({ marker: "adapter" });
	const received: QuestpieObservationRuntimeMetadataV1[] = [];
	const handle = createOfficialQuestpieObservability((input) => {
		received.push(input);
		return adapter;
	});

	expect(bindOfficialQuestpieObservability(handle, metadata)).toBe(adapter);
	expect(received).toEqual([metadata]);
	expect(Object.isFrozen(received[0])).toBe(true);
	expect(() => bindOfficialQuestpieObservability(handle, metadata)).toThrow(
		"Runtime observation handle is already bound",
	);
});

test("rejects structural forgeries and malformed metadata before binding", () => {
	let calls = 0;
	const handle = createOfficialQuestpieObservability(() => {
		calls += 1;
		return Object.freeze({});
	});

	expect(() =>
		bindOfficialQuestpieObservability({} as never, metadata),
	).toThrow("Runtime observation handle is incompatible");
	expect(() =>
		bindOfficialQuestpieObservability(handle, {
			...metadata,
			questpieVersion: "4.0.0-beta.1",
		} as never),
	).toThrow("Runtime observation metadata is incompatible");
	expect(() =>
		bindOfficialQuestpieObservability(handle, {
			...metadata,
			unknown: true,
		} as never),
	).toThrow("Runtime observation metadata is incompatible");
	expect(calls).toBe(0);
	expect(bindOfficialQuestpieObservability(handle, metadata)).toEqual({});
	expect(calls).toBe(1);
});

test("does not retry a binder that failed after accepting metadata", () => {
	let calls = 0;
	const handle = createOfficialQuestpieObservability(() => {
		calls += 1;
		throw new Error("adapter startup failed");
	});

	expect(() => bindOfficialQuestpieObservability(handle, metadata)).toThrow(
		"adapter startup failed",
	);
	expect(() => bindOfficialQuestpieObservability(handle, metadata)).toThrow(
		"Runtime observation handle is already bound",
	);
	expect(calls).toBe(1);
});

test("binds the official handle to verified Runtime metadata before observation starts", () => {
	const received: QuestpieObservationRuntimeMetadataV1[] = [];
	const adapter: ObservationAdapterV1 = Object.freeze({
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => null,
		begin: () =>
			Object.freeze({
				context: null,
				run: async <Result>(use: () => Result | Promise<Result>) => await use(),
				event: () => undefined,
				end: () => undefined,
			}),
	});
	const handle = createOfficialQuestpieObservability((input) => {
		received.push(input);
		return adapter;
	});
	const observation = createApplicationObservation({
		applicationIdentity: metadata.applicationIdentity,
		createRuntimeInstanceId: () => metadata.runtimeInstanceId,
		observability: handle,
		runtimeBuildDigest: metadata.runtimeBuildDigest,
		questpieVersion: metadata.questpieVersion,
		signalProjectionDigest: metadata.signalProjectionDigest,
	});

	expect(observation?.runtimeInstanceId).toBe(metadata.runtimeInstanceId);
	expect(observation?.hasAdapter).toBe(true);
	expect(received).toEqual([metadata]);
});
