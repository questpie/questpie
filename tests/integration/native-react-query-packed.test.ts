import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { verifyPackedNativeQuery } from "../../scripts/release-native-query";

const mode =
	process.env.QUESTPIE_NATIVE_PACKED_BROWSER === "1" ? "browser" : "runtime";

test("packed command scratch is confined to the caller-owned consumer", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-native-scratch-control-"),
	);
	try {
		const bin = join(temporary, "bin");
		await mkdir(bin);
		await writeFile(
			join(bin, "bun"),
			'#!/bin/sh\nprintf "%s" "$TMPDIR" > child-tmpdir\nexit 87\n',
			{ mode: 0o700 },
		);
		const entrypoint = join(temporary, "control.ts");
		await writeFile(
			entrypoint,
			`import { verifyPackedNativeQuery } from ${JSON.stringify(resolve(import.meta.dir, "../../scripts/release-native-query.ts"))}; await verifyPackedNativeQuery("unused.tgz", ${JSON.stringify(join(temporary, "proof"))}, "runtime");`,
		);
		const child = Bun.spawn([process.execPath, entrypoint], {
			env: { ...process.env, PATH: bin, TMPDIR: join(temporary, "ambient") },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exit, , stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(exit).not.toBe(0);
		expect(stderr).toContain("Packed native consumer failed");
		expect(
			await readFile(join(temporary, "proof/original/child-tmpdir"), "utf8"),
		).toBe(join(temporary, "proof/original"));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test(`the packed native adapter ${mode} consumer runs with real peers after relocation, without leaking them into core`, async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-native-packed-"));
	try {
		const packed = Bun.spawnSync(
			[
				"bun",
				"pm",
				"pack",
				"--destination",
				temporary,
				"--ignore-scripts",
				"--quiet",
			],
			{
				cwd: resolve(import.meta.dir, "../../packages/questpie"),
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
		const tarball = (await readdir(temporary)).find((name) =>
			name.endsWith(".tgz"),
		);
		if (!tarball) throw new Error("Missing packed questpie");
		await verifyPackedNativeQuery(
			join(temporary, tarball),
			join(temporary, "proof"),
			mode,
		);
		const relocated = join(temporary, "proof/relocated");
		const missingBrowser = Bun.spawn([process.execPath, "browser-host.ts"], {
			cwd: relocated,
			env: {
				...process.env,
				TMPDIR: relocated,
				FIREFOX_BIN: join(temporary, "missing-firefox"),
			},
			stdout: "pipe",
			stderr: "pipe",
			timeout: 5_000,
		});
		const [exit, , stderr] = await Promise.all([
			missingBrowser.exited,
			new Response(missingBrowser.stdout).text(),
			new Response(missingBrowser.stderr).text(),
		]);
		expect(exit).not.toBe(0);
		expect(stderr).toContain("missing-firefox");
		expect(
			(await readdir(relocated)).filter((name) =>
				name.startsWith("firefox-profile-"),
			),
		).toEqual([]);
		const browserHost = await readFile(
			join(relocated, "browser-host.ts"),
			"utf8",
		);
		const deadline =
			'done.reject(new Error("Packed native Firefox timed out")), 30_000)';
		expect(browserHost).toContain(deadline);
		// Test-host deadline acceleration only; no package/generated code changes.
		await writeFile(
			join(relocated, "browser-timeout-control.ts"),
			browserHost.replace(
				deadline,
				'done.reject(new Error("Packed native Firefox timed out")), 500)',
			),
		);
		const stubbornBrowser = join(relocated, "stubborn-browser");
		await writeFile(
			stubbornBrowser,
			`#!${process.execPath}\nprocess.on("SIGTERM", () => {});\nconst descendant = Bun.spawn([process.execPath, "-e", 'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);'], { stdout: "ignore", stderr: "ignore" });\nvoid descendant.exited;\nawait Bun.write("stubborn-browser.pid", String(process.pid));\nawait Bun.write("stubborn-descendant.pid", String(descendant.pid));\nsetInterval(() => {}, 1000);\n`,
			{ mode: 0o700 },
		);
		const timedBrowser = Bun.spawn(
			[process.execPath, "browser-timeout-control.ts"],
			{
				cwd: relocated,
				env: {
					...process.env,
					TMPDIR: relocated,
					FIREFOX_BIN: stubbornBrowser,
				},
				stdout: "pipe",
				stderr: "pipe",
				timeout: 5_000,
			},
		);
		let stubbornPid: number | undefined;
		try {
			const [timedExit, , timedError] = await Promise.all([
				timedBrowser.exited,
				new Response(timedBrowser.stdout).text(),
				new Response(timedBrowser.stderr).text(),
			]);
			stubbornPid = Number(
				await readFile(join(relocated, "stubborn-browser.pid"), "utf8"),
			);
			const descendantPid = Number(
				await readFile(join(relocated, "stubborn-descendant.pid"), "utf8"),
			);
			expect(timedExit).not.toBe(0);
			expect(timedError).toContain("Packed native Firefox timed out");
			expect(() => process.kill(stubbornPid!, 0)).toThrow();
			expect(() => process.kill(descendantPid, 0)).toThrow();
			expect(
				(await readdir(relocated)).filter((name) =>
					name.startsWith("firefox-profile-"),
				),
			).toEqual([]);
		} finally {
			if (stubbornPid) {
				try {
					process.kill(-stubbornPid, "SIGKILL");
				} catch (error) {
					expect((error as NodeJS.ErrnoException).code).toBe("ESRCH");
				}
			}
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 180_000);
