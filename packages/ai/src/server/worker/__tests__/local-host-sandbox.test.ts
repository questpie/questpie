import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalHostSandbox } from "../local-host-sandbox.js";

const roots: string[] = [];

async function makeSession() {
	const root = await mkdtemp(join(tmpdir(), "questpie-local-sandbox-"));
	roots.push(root);
	const provider = createLocalHostSandbox({ workRoot: join(root, "work") });
	const session = await provider.createSession({ sessionId: `s_${randomUUID()}` });
	return { root, session };
}

async function exists(path: string) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		) {
			return false;
		}
		throw error;
	}
}

async function readStream(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("createLocalHostSandbox", () => {
	it("returns null when reading a missing text file", async () => {
		const { session } = await makeSession();

		await expect(
			session.readTextFile({ path: join(session.defaultWorkingDirectory, "missing.txt") }),
		).resolves.toBeNull();
	});

	it("writeTextFile creates parent directories", async () => {
		const { session } = await makeSession();
		const path = join(session.defaultWorkingDirectory, "nested", "dir", "note.txt");

		await session.writeTextFile({ path, content: "hello" });

		expect(await readFile(path, "utf8")).toBe("hello");
		expect(await session.readTextFile({ path })).toBe("hello");
	});

	it("roundtrips binary and text content", async () => {
		const { session } = await makeSession();
		const textPath = join(session.defaultWorkingDirectory, "text.txt");
		const binaryPath = join(session.defaultWorkingDirectory, "bytes.bin");
		const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);

		await session.writeTextFile({ path: textPath, content: "hello sandbox" });
		await session.writeBinaryFile({ path: binaryPath, content: bytes });

		expect(await session.readTextFile({ path: textPath })).toBe("hello sandbox");
		expect(await session.readBinaryFile({ path: binaryPath })).toEqual(bytes);
	});

	it("run returns exitCode, stdout, and stderr", async () => {
		const { session } = await makeSession();

		const result = await session.run({
			command: "printf out; printf err >&2; exit 7",
		});

		expect(result).toEqual({ exitCode: 7, stdout: "out", stderr: "err" });
	});

	it("spawn streams stdout and stderr and supports wait and kill", async () => {
		const { session } = await makeSession();
		const proc = await session.spawn({ command: "printf out; printf err >&2" });

		const stdout = readStream(proc.stdout);
		const stderr = readStream(proc.stderr);
		const result = await proc.wait();
		await proc.kill();

		expect(await stdout).toBe("out");
		expect(await stderr).toBe("err");
		expect(result.exitCode).toBe(0);
	});

	it("destroy is idempotent and kills tracked children", async () => {
		const { session } = await makeSession();
		const proc = await session.spawn({ command: "sleep 30" });

		await session.destroy?.();
		await session.destroy?.();
		const result = await proc.wait();

		expect(typeof result.exitCode).toBe("number");
	});

	it("resolves websocket loopback URLs", async () => {
		const { session } = await makeSession();
		const port = session.ports[0]!;

		await expect(session.getPortUrl({ port, protocol: "ws" })).resolves.toBe(
			`ws://127.0.0.1:${port}`,
		);
	});

	it("uses an isolated session HOME for claude config and skills", async () => {
		const { root, session } = await makeSession();
		const marker = `skill-${randomUUID()}`;
		const realHome = process.env.HOME;
		const realMarkerPath = realHome
			? join(realHome, ".claude", "skills", marker, "SKILL.md")
			: null;

		const result = await session.run({
			command: `mkdir -p "$HOME/.claude/skills/${marker}" && printf isolated > "$HOME/.claude/skills/${marker}/SKILL.md" && printf '%s\n%s\n%s' "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"`,
		});
		const [home, configHome, cacheHome] = result.stdout.split("\n");

		expect(result.exitCode).toBe(0);
		expect(home).toStartWith(join(root, "work", ".questpie", "local-host-home"));
		expect(configHome).toBe(join(home!, ".config"));
		expect(cacheHome).toBe(join(home!, ".cache"));
		expect(await readFile(join(home!, ".claude", "skills", marker, "SKILL.md"), "utf8")).toBe("isolated");
		if (realMarkerPath) expect(await exists(realMarkerPath)).toBe(false);
	});
});
