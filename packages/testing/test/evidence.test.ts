import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createEvidence,
	DEFAULT_MAX_EVIDENCE_LINE_CHARS,
	DEFAULT_MAX_EVIDENCE_LINES,
} from "../src/scenario.js";

/*
 * UC-TEST-017..019. Evidence is what a failing run hands back, so it has to be
 * bounded before it is useful: a process that prints forever must cost a fixed
 * amount of memory, and nothing that was registered as a secret may reach disk.
 */

const created: string[] = [];

afterEach(async () => {
	await Promise.allSettled(
		created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

async function scratch(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "qp-evidence-"));
	created.push(dir);
	return dir;
}

describe("UC-TEST-017 bounded-evidence-ring", () => {
	it("keeps only the last lines once the ring is full", () => {
		const evidence = createEvidence({ maxLines: 3 });
		for (let index = 0; index < 10; index += 1) {
			evidence.push("stdout", `line ${index}`);
		}

		const tail = evidence.tail();
		expect(tail).toHaveLength(3);
		expect(tail[0]).toContain("line 7");
		expect(tail[2]).toContain("line 9");
	});

	it("truncates a single enormous line instead of letting it swallow the tail", () => {
		const evidence = createEvidence({ maxLineChars: 20 });
		evidence.push("stderr", "x".repeat(5_000));

		const [line] = evidence.tail();
		expect(line.length).toBeLessThan(60);
	});

	it("tags each line with the stream it came from", () => {
		const evidence = createEvidence({});
		evidence.push("stdout", "out");
		evidence.push("stderr", "err");

		expect(evidence.tail()).toEqual(["[stdout] out", "[stderr] err"]);
	});

	it("returns the requested number of trailing lines", () => {
		const evidence = createEvidence({});
		for (const line of ["a", "b", "c"]) evidence.push("stdout", line);

		expect(evidence.tail(2)).toEqual(["[stdout] b", "[stdout] c"]);
	});

	it("ships the same limits every harness uses", () => {
		expect(DEFAULT_MAX_EVIDENCE_LINES).toBe(500);
		expect(DEFAULT_MAX_EVIDENCE_LINE_CHARS).toBe(4_096);
	});

	it("rejects a limit that is not a positive number", () => {
		expect(() => createEvidence({ maxLines: 0 })).toThrow(TypeError);
		expect(() => createEvidence({ maxLineChars: -1 })).toThrow(TypeError);
	});
});

describe("UC-TEST-018 value-level-redaction", () => {
	it("replaces a registered value wherever it appears", () => {
		const evidence = createEvidence({ secrets: ["hunter2"] });
		evidence.push("stdout", "connecting with hunter2 then hunter2 again");

		const [line] = evidence.tail();
		expect(line).not.toContain("hunter2");
		expect(line).toContain("[REDACTED]");
	});

	it("redacts the longer secret first so a shorter one cannot split it", () => {
		const evidence = createEvidence({ secrets: ["tok", "tok-full-value"] });
		evidence.push("stdout", "auth tok-full-value");

		const [line] = evidence.tail();
		expect(line).not.toContain("full-value");
	});

	it("redacts a secret registered after the first line was written", () => {
		const evidence = createEvidence({});
		evidence.push("stdout", "before");
		evidence.addSecret("later");
		evidence.push("stdout", "value later");

		expect(evidence.tail().join("\n")).not.toContain("later");
	});

	it("redacts before truncating, so a secret straddling the cut leaves no readable half", () => {
		const secret = "SUPER-SECRET-VALUE";
		const evidence = createEvidence({ secrets: [secret], maxLineChars: 24 });
		evidence.push("stdout", `padding-here ${secret} trailing`);

		const [line] = evidence.tail();
		expect(line).not.toContain("SUPER");
		expect(line).not.toContain("SECRET");
	});

	it("treats an empty secret as no secret at all", () => {
		const evidence = createEvidence({ secrets: [""] });
		evidence.push("stdout", "plain");

		expect(evidence.tail()[0]).toBe("[stdout] plain");
	});
});

describe("UC-TEST-019 artifact-policy", () => {
	it("keeps artifacts when the run fails", async () => {
		const dir = await scratch();
		const evidence = createEvidence({
			artifactDir: join(dir, "run"),
			command: ["bun", "server.ts"],
		});
		evidence.push("stdout", "booted");

		const written = await evidence.persist("fail");

		expect(written).toBe(join(dir, "run"));
		const manifest = JSON.parse(
			await readFile(join(dir, "run", "manifest.json"), "utf-8"),
		) as Record<string, unknown>;
		expect(manifest.outcome).toBe("fail");
		expect(manifest.command).toEqual(["bun", "server.ts"]);
		expect(manifest.runtime).toContain("bun");
		expect(typeof manifest.finishedAt).toBe("string");

		const log = await readFile(join(dir, "run", "output.log"), "utf-8");
		expect(log).toContain("booted");
	});

	it("removes the directory when the run passes", async () => {
		const dir = await scratch();
		const evidence = createEvidence({ artifactDir: join(dir, "run") });
		evidence.push("stdout", "fine");

		const written = await evidence.persist("pass");

		expect(written).toBeUndefined();
		await expect(stat(join(dir, "run"))).rejects.toThrow();
	});

	it("redacts artifacts before they reach disk", async () => {
		const dir = await scratch();
		const evidence = createEvidence({
			artifactDir: join(dir, "run"),
			secrets: ["db-password"],
		});
		evidence.push("stderr", "connect failed for db-password");

		await evidence.persist("fail");

		const log = await readFile(join(dir, "run", "output.log"), "utf-8");
		expect(log).not.toContain("db-password");
		expect(log).toContain("[REDACTED]");
	});

	it("writes nothing when no artifact directory was asked for", async () => {
		const evidence = createEvidence({});
		evidence.push("stdout", "nowhere to go");

		expect(await evidence.persist("fail")).toBeUndefined();
	});

	it("is safe to persist twice", async () => {
		const dir = await scratch();
		const evidence = createEvidence({ artifactDir: join(dir, "run") });

		await evidence.persist("fail");
		await evidence.persist("fail");

		expect(
			JSON.parse(await readFile(join(dir, "run", "manifest.json"), "utf-8")),
		).toHaveProperty("outcome", "fail");
	});
});
