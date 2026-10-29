import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const fixture = join(import.meta.dir, "fixtures/process-crash.ts");

function run(scenario: string, runtimeArgs: string[] = []) {
	const started = Date.now();
	const result = Bun.spawnSync(
		[process.execPath, ...runtimeArgs, fixture, scenario],
		{ stdout: "pipe", stderr: "pipe" },
	);
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
		ms: Date.now() - started,
	};
}

describe("installProcessErrorHandlers", () => {
	it("reports an uncaught exception, waits for delivery, then crashes as before", () => {
		const { exitCode, stdout, stderr } = run("throw");
		expect(stdout).toContain("REPORTED process boom");
		expect(stdout.indexOf("FLUSHED")).toBeGreaterThan(
			stdout.indexOf("REPORTED"),
		);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("boom");
	});

	it("reports an unhandled rejection and still crashes", () => {
		const { exitCode, stdout, stderr } = run("reject");
		expect(stdout).toContain("REPORTED process boom");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("boom");
	});

	it("crashes at the deadline when delivery hangs", () => {
		const { exitCode, stdout, ms } = run("hanging-flush");
		expect(stdout).toContain("REPORTED process boom");
		expect(exitCode).toBe(1);
		expect(ms).toBeLessThan(5_000);
	});

	it("only reports when the app has its own listener, which keeps control", () => {
		const { exitCode, stdout } = run("own-listener");
		expect(stdout).toContain("REPORTED process boom");
		expect(stdout).toContain("APP HANDLED");
		expect(stdout).toContain("STILL ALIVE");
		expect(stdout).not.toContain("FLUSHED");
		expect(exitCode).toBe(0);
	});

	it("leaves control to an app listener added with once", () => {
		const { exitCode, stdout } = run("own-once-listener");
		expect(stdout).toContain("REPORTED process boom");
		expect(stdout).toContain("APP HANDLED");
		expect(stdout).toContain("STILL ALIVE");
		expect(exitCode).toBe(0);
	});

	it("leaves control to an app once listener that runs before it", () => {
		const { exitCode, stdout } = run("app-first-once-listener");
		expect(stdout).toContain("REPORTED process boom");
		expect(stdout).toContain("APP HANDLED");
		expect(stdout).toContain("STILL ALIVE");
		expect(exitCode).toBe(0);
	});

	it("leaves control to an app once rejection listener that runs before it", () => {
		const { exitCode, stdout } = run("app-first-once-rejection-listener");
		expect(stdout).toContain("APP HANDLED");
		expect(stdout).toContain("STILL ALIVE");
		expect(exitCode).toBe(0);
	});

	it("keeps an uncaughtExceptionMonitor for errors after the rethrow", () => {
		const { exitCode, stdout } = run("monitor-survives");
		expect(stdout.match(/MONITOR boom/g)).toHaveLength(1);
		expect(stdout).toContain("MONITOR second");
		expect(stdout).toContain("STILL ALIVE");
		expect(exitCode).toBe(0);
	});

	it("shows the error to an uncaughtExceptionMonitor once", () => {
		const { exitCode, stdout } = run("monitor");
		expect(stdout.match(/MONITOR/g)).toHaveLength(1);
		expect(exitCode).toBe(1);
	});

	for (const flags of [
		["--unhandled-rejections=warn"],
		["--unhandled-rejections", "warn"],
		["--unhandled-rejections", "none"],
	]) {
		it(`keeps running and reports nothing with ${flags.join(" ")}`, () => {
			const { exitCode, stdout } = run("reject", flags);
			expect(stdout).not.toContain("REPORTED");
			expect(stdout).toContain("STILL ALIVE");
			expect(exitCode).toBe(0);
		});
	}

	it("reports a rejection once with --unhandled-rejections=strict", () => {
		const { exitCode, stdout, stderr } = run("reject", [
			"--unhandled-rejections=strict",
		]);
		expect(stdout.match(/REPORTED/g)).toHaveLength(1);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("boom");
	});

	it("does nothing once uninstalled", () => {
		const { exitCode, stdout, stderr } = run("uninstalled");
		expect(stdout).not.toContain("REPORTED");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("boom");
	});
});
