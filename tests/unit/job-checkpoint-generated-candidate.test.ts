import { expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "../../packages/compiler/src";

setDefaultTimeout(120_000);
const fixture = resolve(import.meta.dir, "../../fixtures/collaboration");
async function candidate(run: (root: string, source: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "questpie-schedule-compiler-"));
	try {
		await cp(fixture, root, { recursive: true });
		const source = await readFile(
			join(root, "src/company-digest-job.ts"),
			"utf8",
		);
		await run(
			root,
			source.replace("codec, durable", "codec, durable, principal"),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("candidate generated checkpoint uses inert named references and exact Mutation codecs/errors", async () => {
	await candidate(async (root) => {
		await writeFile(
			join(root, "src/checkpoint-proof.ts"),
			`import {codec, operation, policy} from "questpie";
import {defineMutation} from "#questpie/app";
import type {JobContext, MutationCheckpointError} from "#questpie/app";
export const checkpoint = defineMutation({
  name: "schedule.checkpoint", input: codec.object({at: codec.timestamp(), nested: codec.object({label: codec.optional(codec.text())})}),
  output: codec.object({count: codec.integer()}), policy: policy.authenticated(),
  errors: { blocked: operation.error({code:"BLOCKED", status:409, payload:codec.object({reason:codec.text()})}) },
  handler: () => ({count:1}),
});
async function typeProof(ctx: JobContext, at: Date) {
  const ref = ctx.mutations.schedule.checkpoint;
  const result = await ctx.run.step.mutation("sweep", ref, {at, nested:{}});
  const count: number = result.count;
  // @ts-expect-error output is inferred from named Mutation
  const wrong: string = result.count;
  // @ts-expect-error reference is inert
  await ref({at, nested:{}});
  // @ts-expect-error reference must have compiler-private provenance
  await ctx.run.step.mutation("forged", {identity:"mutation:schedule.checkpoint"}, {at,nested:{}});
  // @ts-expect-error exact named Mutation input rejects Date text
  await ctx.run.step.mutation("date", ref, {at:"2026-09-06T00:00:00.000Z",nested:{}});
  // @ts-expect-error required nested input cannot be omitted
  await ctx.run.step.mutation("missing", ref, {at});
  // @ts-expect-error Job has no ordinary Mutation caller
  void ctx.run.mutations;
  // @ts-expect-error Job gains no database facade
  void ctx.data;
  const declared: MutationCheckpointError<typeof ref> = Object.assign(new Error("blocked"), {code:"BLOCKED" as const,status:409 as const,payload:{reason:"test"}});
  const reason: string = declared.payload.reason;
  // @ts-expect-error declared error codec remains exact
  const wrongReason: number = declared.payload.reason;
  return {count,wrong,reason,wrongReason};
}
void typeProof;
`,
		);
		const generated = (await compileApplication({ applicationRoot: root }))
			.generatedFiles;
		expect(generated["app.ts"]).toContain(
			'MutationCheckpointReference<"schedule.checkpoint">',
		);
		expect(generated["app.ts"]).toContain('code: "BLOCKED"');
	});
});
