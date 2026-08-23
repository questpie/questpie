import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const postgres = process.env.PGHOST ? test : test.skip;

postgres(
	"proves Authority nondisclosure, retry fencing, audit, and compatible-v5 maintenance on PostgreSQL",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-pb05-maintenance-"),
		);
		const outputPath = join(temporary, "result.json");
		const helper = new URL("./helpers/beta08-durable.ts", import.meta.url).href;
		const runtimeHelper = new URL(
			"./helpers/beta05-runtime.ts",
			import.meta.url,
		).href;
		const script = `
import { SQL } from "bun";
import { beta08Harness, disposeBeta08Harness } from ${JSON.stringify(helper)};
import { beta05Ids, beta05PostgresUrl } from ${JSON.stringify(runtimeHelper)};
const database = new SQL({ url: beta05PostgresUrl(), max: 8 });
const runIdFor = async (callId) => {
  const [row] = await database.unsafe(
    \`SELECT runs.run_id::text AS "runId"
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.pending_reaction_intents AS intents
  ON intents.application_name = runs.application_name
 AND intents.record_id = runs.dispatch_id
WHERE runs.application_name = 'application:collaboration' AND intents.call_id = $1\`,
    [callId],
  );
  if (!row?.runId) throw new Error("maintenance run is unavailable");
  return row.runId;
};
const publish = (prepared, callId, body) => prepared.app.execution(
  { principal: prepared.principal, context: { companyId: beta05Ids.company } },
  async ({ mutations }) => mutations["message.publish"](
    { channelId: beta05Ids.channel, body }, { callId },
  ),
);
try {
  const prepared = await beta08Harness(database);
  const deniedCall = "pb05-maintenance-denied-" + crypto.randomUUID();
  await publish(prepared, deniedCall, "authority denial");
  const deniedRunId = await runIdFor(deniedCall);
  const denied = await prepared.app.durable.cancelRun({
    runId: deniedRunId,
    reason: "unauthorized maintenance",
    actor: prepared.readerPrincipal,
  });
  const missing = await prepared.app.durable.cancelRun({
    runId: crypto.randomUUID(),
    reason: "unknown target",
    actor: prepared.readerPrincipal,
  });
  const denialAudit = await prepared.app.durable.audit(deniedRunId);

  const retryCall = "pb05-maintenance-retry-" + crypto.randomUUID();
  await publish(prepared, retryCall, "retry fence");
  const retryRunId = await runIdFor(retryCall);
  await database.unsafe(
    \`UPDATE collaboration.memberships SET status = 'revoked' WHERE id = $1\`,
    [beta05Ids.membership],
  );
  await prepared.app.durable.poll();
  const beforeRetry = await prepared.app.durable.inspect(retryRunId);
  const retried = await prepared.app.durable.retryRun({
    runId: retryRunId,
    reason: "operator retry",
    actor: prepared.principal,
    expectedVersion: beforeRetry.version,
  });
  const afterRetry = await prepared.app.durable.inspect(retryRunId);
  const retryEvents = await prepared.app.durable.events(retryRunId);
  await database.unsafe(
    \`UPDATE collaboration.memberships SET status = 'active' WHERE id = $1\`,
    [beta05Ids.membership],
  );

  const v5Call = "pb05-maintenance-v5-" + crypto.randomUUID();
  await publish(prepared, v5Call, "compatible v5");
  const v5RunId = await runIdFor(v5Call);
  const compatibleV5 = await prepared.createCompatibleV5Application();
  const v5Outcome = await compatibleV5.durable.cancelRun({
    runId: v5RunId,
    reason: "compatible v5 operator",
    actor: prepared.principal,
  });
  await Bun.write(${JSON.stringify(outputPath)}, JSON.stringify({
    denied,
    missing,
    denialAudit: denialAudit.map(({ rejectionCode }) => rejectionCode),
    beforeVersion: beforeRetry.version,
    retried,
    afterVersion: afterRetry.version,
    retryKinds: retryEvents.map(({ kind }) => kind),
    v5Outcome,
  }));
} finally {
  await disposeBeta08Harness();
  await database.close({ timeout: 2 });
}`;
		try {
			const child = Bun.spawn([process.execPath, "-e", script], {
				env: process.env,
				stdout: "inherit",
				stderr: "inherit",
			});
			expect(await child.exited).toBe(0);
			const result = JSON.parse(await readFile(outputPath, "utf8"));
			expect(result.denied).toMatchObject({
				outcome: "rejected",
				rejectionCode: "AUTHORITY_DENIED",
				stateBefore: null,
				stateAfter: null,
				version: null,
			});
			expect({ ...result.missing, commandId: null }).toEqual({
				...result.denied,
				commandId: null,
			});
			expect(result.denialAudit).toEqual(["AUTHORITY_DENIED"]);
			expect(result.retried).toMatchObject({
				outcome: "applied",
				stateBefore: "failed",
				stateAfter: "ready",
			});
			expect(result.retried.version).toBe(result.beforeVersion + 1);
			expect(result.afterVersion).toBe(result.beforeVersion + 1);
			expect(result.retryKinds.at(-1)).toBe("retryRequested");
			expect(
				result.retryKinds.filter((kind: string) => kind === "retryRequested"),
			).toHaveLength(1);
			expect(result.v5Outcome).toMatchObject({
				outcome: "applied",
				rejectionCode: null,
			});
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	},
	120_000,
);
