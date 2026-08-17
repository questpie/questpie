import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("projects the executed Reaction and its shared durable kernel contract", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const files = compilation.generatedFiles;

	const reactions = JSON.parse(files["reaction-projection.json"]!) as Readonly<{
		format: string;
		version: number;
		reactions: readonly Readonly<{
			identity: string;
			contractDigest: string;
			effects: readonly string[];
			runAs: Readonly<{ actor: string; whenDenied: string }>;
			retry: Readonly<Record<string, unknown>>;
			declaredErrors: Readonly<Record<string, unknown>>;
			output: unknown;
		}>[];
	}>;
	expect(reactions.format).toBe("questpie.reaction-projection");
	expect(reactions.version).toBe(2);
	expect(reactions.reactions).toHaveLength(1);
	const reaction = reactions.reactions[0]!;
	expect(reaction.identity).toBe("reaction:messagePublished");
	expect(reaction.runAs).toEqual({ actor: "caller", whenDenied: "fail" });
	expect(reaction.retry).toEqual({
		backoff: "exponential",
		horizonMilliseconds: 86_400_000,
		initialDelayMilliseconds: 1_000,
		jitter: "full",
		maximumAttempts: 8,
		maximumDelayMilliseconds: 900_000,
	});
	expect(reaction.effects).toEqual(["deliver-message"]);
	expect(reaction.declaredErrors).toEqual({
		messageUnavailable: {
			code: "MESSAGE_UNAVAILABLE",
			payload: null,
			status: 404,
		},
	});
	expect(reaction.output).toEqual({
		kind: "object",
		properties: {
			deliveryReceipt: { kind: "text" },
			eventId: { kind: "uuid" },
			messageId: { kind: "uuid" },
		},
	});
	expect(reaction.contractDigest).toMatch(/^[0-9a-f]{64}$/);

	const kernel = JSON.parse(files["durable-kernel.json"]!) as Readonly<{
		format: string;
		version: number;
		digest: string;
		states: readonly string[];
		terminalStates: readonly string[];
		budgets: Readonly<Record<string, number>>;
		lease: Readonly<Record<string, unknown>>;
		transitions: readonly Readonly<{ from: string; to: string }>[];
		failureCodes: readonly string[];
		permanentFailureCodes: readonly string[];
		claimRefusalCodes: readonly string[];
		maintenanceCommands: readonly string[];
		maintenanceFencedOn: string;
		maintenanceRejectionCodes: readonly string[];
		eventKinds: readonly string[];
	}>;
	expect(kernel.format).toBe("questpie.durable-kernel");
	expect(kernel.version).toBe(1);
	expect(kernel.states).toEqual([
		"cancelled",
		"delayed",
		"failed",
		"ready",
		"running",
		"succeeded",
	]);
	expect(kernel.terminalStates).toEqual(["cancelled", "failed", "succeeded"]);
	// The compatibility identity a later Job or Workflow slice inherits must
	// describe the state machine and history vocabulary this kernel implements.
	expect(kernel.transitions).toEqual([
		{ from: "delayed", to: "cancelled" },
		{ from: "delayed", to: "running" },
		{ from: "failed", to: "ready" },
		{ from: "ready", to: "cancelled" },
		{ from: "ready", to: "running" },
		{ from: "running", to: "cancelled" },
		{ from: "running", to: "delayed" },
		{ from: "running", to: "failed" },
		{ from: "running", to: "succeeded" },
	]);
	expect(kernel.eventKinds).toEqual([
		"accepted",
		"ambiguityAcknowledged",
		"attemptStarted",
		"cancellationRequested",
		"cancelled",
		"effectAmbiguous",
		"effectSettled",
		"failed",
		"leaseSuperseded",
		"retryScheduled",
		"succeeded",
	]);
	for (const transition of kernel.transitions) {
		expect(kernel.states).toContain(transition.from);
		expect(kernel.states).toContain(transition.to);
	}
	expect(kernel.lease).toEqual({
		attemptDeadlineMilliseconds: 300_000,
		claimCommitsBeforeHandler: true,
		claimLock: "forUpdateSkipLocked",
		defaultMilliseconds: 30_000,
		fence: ["currentAttemptId", "leaseTokenDigest"],
		heartbeatMilliseconds: 10_000,
		minimumMilliseconds: 1_000,
	});
	// Only enforced budgets are pinned into the compatibility contract the
	// Runtime Build digests.
	expect(kernel.budgets).toEqual({
		claimBatch: 64,
		eventsPerRun: 1_024,
		payloadBytes: 262_144,
		resultBytes: 262_144,
		retryHorizonMilliseconds: 86_400_000,
	});
	expect(kernel).not.toHaveProperty("retention");
	expect(kernel.claimRefusalCodes).toEqual(["EXECUTABLE_RETIRED"]);
	expect(kernel.failureCodes).not.toContain("EXECUTABLE_RETIRED");
	expect(kernel.maintenanceCommands).toEqual([
		"acknowledgeAmbiguity",
		"cancelRun",
		"retryRun",
	]);
	expect(kernel.maintenanceFencedOn).toBe("runVersion");
	expect(kernel.maintenanceRejectionCodes).toEqual([
		"ALREADY_REQUESTED",
		"ATTEMPTS_EXHAUSTED",
		"NOT_AMBIGUOUS",
		"RUN_IS_TERMINAL",
		"RUN_NOT_FAILED",
		"VERSION_MISMATCH",
	]);
	for (const code of kernel.permanentFailureCodes)
		expect(kernel.failureCodes).toContain(code);

	const executables = JSON.parse(
		files["runtime-executables.json"]!,
	) as Readonly<{
		slots: readonly Readonly<{
			identity: string;
			kind: string;
			slot: string;
			contractDigest: string;
		}>[];
	}>;
	const handler = executables.slots.find(
		(slot) => slot.identity === "reaction:messagePublished",
	);
	expect(handler).toMatchObject({ kind: "reaction", slot: "handler" });
	expect(handler?.contractDigest).toBe(reaction.contractDigest);

	const build = JSON.parse(files["runtime-build.json"]!) as Readonly<{
		internalProtocol: string;
		later: Readonly<{
			durableCompatibilityDigest: string | null;
			reactionDigest: string | null;
		}>;
	}>;
	expect(build.internalProtocol).toBe("questpie.internal.v4");
	expect(build.later.durableCompatibilityDigest).toBe(kernel.digest);
	expect(build.later.reactionDigest).toMatch(/^[0-9a-f]{64}$/);

	// The generated Reaction carries the executed contract; the generated
	// browser client carries no durable control plane.
	const app = files["app.ts"]!;
	expect(app).toContain("export type ReactionFactory");
	expect(app).toContain("readonly runAs: DurableRunAsDefinition;");
	expect(app).toContain("readonly retry: DurableRetryDefinition;");
	expect(app).toContain('"messagePublished": "deliver-message";');
	expect(app).toContain("readonly durable: GeneratedDurable;");
	expect(app).toContain("acknowledgeAmbiguity(input:");
	const client = files["client.ts"]!;
	for (const forbidden of [
		"GeneratedDurable",
		"acknowledgeAmbiguity",
		"cancelRun",
		"retryRun",
		"leaseToken",
	])
		expect(client).not.toContain(forbidden);
});
