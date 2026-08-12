import { runMeasurements } from "./measurements.mjs";
import { runP1Goldens } from "./p1-goldens.mjs";

const goldens = runP1Goldens();
const measurements = await runMeasurements();

console.log(
	JSON.stringify(
		{
			goldens: goldens.publicGoldens,
			measurements,
		},
		null,
		2,
	),
);
console.log("P1 executable Definition compiler proof: pass");
