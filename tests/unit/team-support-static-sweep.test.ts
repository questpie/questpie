import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

test("Team Support Desk compiles a bounded ordinary static sweep and due-time field", async () => {
	const compiled = await compileApplication({
		applicationRoot: resolve(
			import.meta.dir,
			"../../fixtures/team-support-desk",
		),
	});
	const artifacts = compiled.generatedFiles;
	const schedules = JSON.parse(artifacts["job-schedules.json"]!);
	expect(schedules.schedules).toHaveLength(1);
	expect(schedules.schedules[0]).toMatchObject({
		jobIdentity: "job:ticket.sweepSla",
		principal: { kind: "service" },
		inputJson: "{}\n",
	});
}, 60000);
