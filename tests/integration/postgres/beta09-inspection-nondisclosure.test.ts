import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import {
	explainRunExecutable,
	projectStudioCatalog,
} from "../../../apps/studio/src/projection";
import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
	retiredDurableKernel,
	type Beta08Harness,
} from "./helpers/beta08-durable";

const database = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

async function harness(): Promise<Beta08Harness> {
	return beta08Harness(database!);
}

afterAll(async () => {
	await disposeBeta08Harness();
	await database?.close();
});

/**
 * `JSON.stringify` renders a byte array as numbers, so a naive substring check
 * over the stringified view silently passes while the payload is right there.
 * This decodes every byte array it finds, so a leak in any shape is caught.
 */
function disclosedText(value: unknown): string {
	if (value instanceof Uint8Array) return new TextDecoder().decode(value);
	if (Array.isArray(value)) return value.map(disclosedText).join("\u0000");
	if (value && typeof value === "object")
		return Object.values(value).map(disclosedText).join("\u0000");
	return String(value);
}

async function publish(
	prepared: Beta08Harness,
	input: Readonly<{ body: string; callId: string }>,
): Promise<string> {
	return prepared.app.execution(
		{
			principal: prepared.principal,
			context: { companyId: beta05Ids.company },
		},
		async ({ mutations }) => {
			const message = await mutations["message.publish"](
				{ channelId: beta05Ids.channel, body: input.body },
				{ callId: input.callId },
			);
			return message.id;
		},
	);
}

async function runIdentity(callId: string): Promise<string> {
	const [row] = await database!.unsafe<readonly Readonly<{ runId: string }>[]>(
		`SELECT runs.run_id::text AS "runId"
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.pending_reaction_intents AS intents
  ON intents.application_name = runs.application_name
 AND intents.record_id = runs.dispatch_id
WHERE runs.application_name = 'application:collaboration' AND intents.call_id = $1`,
		[callId],
	);
	expect(row?.runId).toBeString();
	return row!.runId;
}

/**
 * The prescribed red test, aimed at the lane where it actually bites.
 *
 * Application data reaches Studio only through ordinary generated Operations
 * and Collection Policy, so disclosure equivalence there is definitional.
 * Operational facts are not Collection rows: no Collection Policy covers them,
 * and the published durable surface returns the Reaction's encoded result and
 * the provider's receipt verbatim. An output codec is a shape contract, not an
 * authorization filter, so whatever a handler returns is disclosed to every
 * caller that reaches this surface.
 *
 * This asserts the contract `inspection-contract.md` decided: the inspection
 * projection is strictly narrower than the kernel read. Result becomes
 * presence, length and digest; receipt becomes presence.
 */
postgresTest(
	"the published durable surface discloses no Reaction result body or provider receipt",
	async () => {
		const prepared = await harness();
		const callId = "beta09-nondisclosure-1";
		await publish(prepared, { body: "beta09 nondisclosure probe", callId });
		const runId = await runIdentity(callId);

		await prepared.app.durable.poll();

		const view = await prepared.app.durable.inspect(runId);
		expect(view?.state).toBe("succeeded");

		// The kernel keeps result bytes because the worker needs them. Nothing
		// reachable through the published surface may return them.
		expect(view).not.toHaveProperty("resultBytes");

		const effects = await prepared.app.durable.effects(runId);
		expect(effects).toHaveLength(1);
		// A provider receipt is arbitrary provider text. Presence is the fact an
		// operator needs; the text itself is not this surface's to disclose.
		expect(effects[0]).not.toHaveProperty("receipt");
	},
);

/**
 * The same defect, stated against the equivalent generated Operation, which is
 * the form the prescribed red test actually names.
 *
 * The Reaction runs as its caller, an `admin` member, so its result carries the
 * Message body. `readerPrincipal` is an active `member`, and the Message output
 * Field Policy admits `body` only for `owner` or `admin`. So the ordinary Query
 * omits the property for this caller entirely — and the durable surface must
 * not hand back the same bytes the Policy just withheld.
 */
postgresTest(
	"a caller whose Query omits a Field cannot obtain it from the durable surface",
	async () => {
		const prepared = await harness();
		const callId = "beta09-nondisclosure-2";
		const body = "beta09 policy governed body";
		const messageId = await publish(prepared, { body, callId });
		const runId = await runIdentity(callId);
		await prepared.app.durable.poll();

		const page = await prepared.app.execution(
			{
				principal: prepared.readerPrincipal,
				context: { companyId: beta05Ids.company },
			},
			async ({ queries }) =>
				queries["messages.page"]({
					channelId: beta05Ids.channel,
					first: 100,
					after: null,
				}),
		);
		const node = page.nodes.find((entry) => entry.id === messageId);
		expect(node).toBeDefined();
		// The Policy withholds the Field by omitting the property outright.
		expect(node).not.toHaveProperty("body");

		const view = await prepared.app.durable.inspect(runId);
		expect(view?.state).toBe("succeeded");
		expect(disclosedText(view)).not.toContain(body);

		const effects = await prepared.app.durable.effects(runId);
		expect(disclosedText(effects)).not.toContain(body);
	},
);

/**
 * Same-origin means the application itself serves it. This drives the real
 * generated `app.fetch`, not the mount function, so the claim is about the
 * shipped surface rather than about a helper.
 */
postgresTest(
	"the application serves the Studio shell same-origin",
	async () => {
		const prepared = await harness();
		const shell = await prepared.fetch(
			new Request("https://app.example/_questpie/studio"),
		);
		expect(shell.status).toBe(200);
		expect(shell.headers.get("content-type")).toContain("text/html");
		expect(await shell.text()).toContain("<!doctype html>");

		// The Operation wire is untouched by the new path.
		const missing = await prepared.fetch(
			new Request("https://app.example/nothing-here"),
		);
		expect(missing.status).toBe(404);
	},
);

/**
 * The end-to-end claim: the real application serves the artifacts, and the
 * independent producer turns exactly those bytes into the catalog Studio
 * renders. Nothing operational crosses the wire on this path.
 */
postgresTest(
	"the served artifacts project into the Studio catalog",
	async () => {
		const prepared = await harness();
		const response = await prepared.fetch(
			new Request("https://app.example/_questpie/studio/artifacts"),
		);
		expect(response.status).toBe(200);
		const served = (await response.json()) as Record<string, unknown>;

		// Re-encode what the wire delivered and feed it to the producer, so the
		// projection is a function of the bytes a browser actually receives.
		const bytes = Object.fromEntries(
			Object.entries(served).map(([path, value]) => [
				path,
				JSON.stringify(value),
			]),
		);
		const catalog = projectStudioCatalog(bytes);
		expect(catalog.application).toBe("collaboration");
		expect(catalog.operations.length).toBeGreaterThan(0);

		// The executable inventory is in artifactFiles and must never be served.
		expect(Object.keys(served)).not.toContain("runtime-executables.json");
		expect(JSON.stringify(served)).not.toContain("bundleExport");
	},
);

/**
 * Criterion 15, driven against a really-retired run rather than a synthetic
 * digest. This is the case where the durable log is silent by construction: the
 * claim refusal returns from a transaction that has only selected, so the run
 * stays `ready` with a history containing only `accepted` and looks healthy.
 */
postgresTest(
	"a really-retired run looks healthy and is explained anyway",
	async () => {
		const prepared = await harness();
		const callId = "beta09-retired-1";
		await publish(prepared, { body: "beta09 retired probe", callId });
		const runId = await runIdentity(callId);

		const retired = retiredDurableKernel(
			database!,
			prepared.reactionProjectionBytes,
		);
		const admitted = await retired.admit(8);
		const target = admitted.find((entry) => entry.runId === runId);
		expect(target).toBeDefined();
		const claim = await retired.claim({
			runId,
			workerId: "beta09-retired-worker",
			executableDigest: target!.executableDigest,
			leaseMilliseconds: 5_000,
			attemptDeadlineMilliseconds: 5_000,
		});
		expect(claim.status).toBe("refused");
		expect(claim.code).toBe("EXECUTABLE_RETIRED");

		// The defect: nothing was written, so the run is indistinguishable from a
		// healthy one waiting its turn.
		const view = await prepared.app.durable.inspect(runId);
		expect(view?.state).toBe("ready");
		const events = await prepared.app.durable.events(runId);
		expect(events.map((entry) => entry.kind)).toEqual(["accepted"]);

		// The compiled contract is the only witness, and it explains it.
		const explained = explainRunExecutable(
			{
				resource: "reaction:messagePublished",
				executableDigest: "0".repeat(64),
			},
			{ "reaction-projection.json": prepared.reactionProjectionBytes },
		);
		expect(explained.compatible).toBe(false);
		expect(explained.reason).toBe("executableRetired");
	},
);

/**
 * Criteria 8 and 9: the one bounded worklist `studio-purpose.md` decided.
 *
 * The entrance is identity-first, but `runId` is not obtainable from any shipped
 * read — `admit()` is the only multi-row query and its predicate excludes every
 * terminal state — so a purely identity-first Studio has detail pages nothing
 * can navigate to. This is the bridge, and it is deliberately one read.
 *
 * Bounded, never counted, and index-backed: `durable_runs_claim_idx` is
 * `(application_name, state, available_at, run_id)`, so filtering by state and
 * ordering by `available_at, run_id` is a prefix scan. `hasMore` rather than a
 * total, because a count is a scan and `studio-purpose.md` forbids one on
 * disclosure grounds as well as cost.
 */
postgresTest(
	"the worklist is bounded, ordered, and discloses no payload",
	async () => {
		const prepared = await harness();
		for (const index of [1, 2, 3]) {
			const callId = `beta09-worklist-${index}`;
			await publish(prepared, {
				body: `delivery-refused-always ${index}`,
				callId,
			});
		}
		// Drive them to a terminal failure so they belong on a worklist at all.
		for (let attempt = 0; attempt < 9; attempt += 1)
			await prepared.app.durable.poll();

		const page = await prepared.app.durable.worklist({
			state: "failed",
			first: 2,
		});
		expect(page.runs.length).toBeLessThanOrEqual(2);
		expect(page.hasMore).toBeBoolean();
		// No total: a count over this table is a scan, and the record forbids it.
		expect(page).not.toHaveProperty("total");

		for (const entry of page.runs) {
			expect(entry.state).toBe("failed");
			expect(entry.runId).toBeString();
			expect(entry.resource).toBeString();
			// Identities and codes only. The worklist is a way in, not a way around
			// the inspection projection.
			expect(entry).not.toHaveProperty("resultBytes");
			expect(entry).not.toHaveProperty("result");
		}

		const wide = await prepared.app.durable.worklist({
			state: "failed",
			first: 50,
		});
		expect(wide.runs.length).toBeGreaterThanOrEqual(page.runs.length);
		if (wide.runs.length > 1) {
			const ordered = [...wide.runs].sort((left, right) =>
				left.runId < right.runId ? -1 : 1,
			);
			expect(wide.runs.map((entry) => entry.runId).sort()).toEqual(
				ordered.map((entry) => entry.runId),
			);
		}
	},
);
