import assert from "node:assert/strict";

import { runExecutionProof } from "./execution-proof.mjs";
import { runMeasurements } from "./measurements.mjs";
import { FIXED_DIGESTS, runP2Goldens } from "./p2-goldens.mjs";
import { runPostgresProof } from "./postgres-proof.mjs";

const p1ProofRoot = new URL(
	"../executable-definition-compiler/",
	import.meta.url,
);
const { FOUNDATIONAL_DIGESTS, runP1Goldens } = await import(
	new URL("p1-goldens.mjs", p1ProofRoot)
);

const p1 = runP1Goldens();
assert.deepEqual(
	{
		schema: FOUNDATIONAL_DIGESTS.schema,
		data: FOUNDATIONAL_DIGESTS.data,
		structuralQuery: FOUNDATIONAL_DIGESTS.structuralQuery,
		p1Executable: p1.publicGoldens.manifestDigest,
		p1AppContract: p1.publicGoldens.appContractDigest,
		p1RuntimeBuild: p1.publicGoldens.runtimeBuildDigest,
	},
	FIXED_DIGESTS,
	"P2 must consume exact fixed foundational and P1 artifact digests",
);

const goldens = runP2Goldens();
const execution = await runExecutionProof();
const measurements = await runMeasurements();
const postgres = await runPostgresProof();

console.log(
	JSON.stringify(
		{
			fixed: FIXED_DIGESTS,
			digests: goldens.digests,
			decisions: goldens.decisions,
			execution,
			measurements,
			postgres,
		},
		null,
		2,
	),
);
console.log("P2 trusted Context and relational Policy proof: pass");
