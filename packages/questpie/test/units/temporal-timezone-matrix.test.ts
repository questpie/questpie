import { describe, expect, test } from "bun:test";

describe("temporal timezone matrix", () => {
	test("normalizes instants and date-only values identically in three timezones", async () => {
		const script = `
			import {
				currentUtcDateString,
				parseCalendarDate,
				parseRfc3339Instant,
			} from "./src/shared/temporal.ts";
			const instants = [
				"2026-03-29T01:30:00.000+01:00",
				"2026-10-25T02:30:00.000+02:00",
			].map((value) => parseRfc3339Instant(value)?.toISOString());
			const ambiguous = parseRfc3339Instant(
				"2026-03-29T01:30:00.000",
			);
			console.log(JSON.stringify({
				instants,
				ambiguous,
				dateOnly: [
					"2026-01-01",
					"2026-03-29",
					"2026-10-25",
					"2028-02-29",
				].map(parseCalendarDate),
				midnight: currentUtcDateString(
					new Date("2026-01-01T00:00:00.000Z"),
				),
			}));
		`;
		const outputs: unknown[] = [];
		const packageRoot = new URL("../..", import.meta.url).pathname;
		for (const timezone of ["UTC", "Europe/Bratislava", "America/New_York"]) {
			const child = Bun.spawn([process.execPath, "-e", script], {
				cwd: packageRoot,
				env: { ...Bun.env, TZ: timezone },
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(exitCode, stderr).toBe(0);
			outputs.push(JSON.parse(stdout));

			const integration = Bun.spawn(
				[
					process.execPath,
					"test",
					"test/integration/temporal-transport.test.ts",
				],
				{
					cwd: packageRoot,
					env: { ...Bun.env, TZ: timezone },
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [integrationExitCode, integrationStdout, integrationStderr] =
				await Promise.all([
					integration.exited,
					new Response(integration.stdout).text(),
					new Response(integration.stderr).text(),
				]);
			expect(
				integrationExitCode,
				`${integrationStdout}\n${integrationStderr}`,
			).toBe(0);
		}

		expect(new Set(outputs.map((output) => JSON.stringify(output))).size).toBe(
			1,
		);
		expect(outputs[0]).toEqual({
			instants: ["2026-03-29T00:30:00.000Z", "2026-10-25T00:30:00.000Z"],
			ambiguous: null,
			dateOnly: ["2026-01-01", "2026-03-29", "2026-10-25", "2028-02-29"],
			midnight: "2026-01-01",
		});
	}, 30_000);
});
