import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.argv[2] === "detached-browser") {
	process.on("SIGTERM", () => {});
	console.log("browser-ready");
	await Bun.sleep(5_000);
} else if (process.argv[2] === "cleanup-worker") {
	const witness = process.argv[3]!;
	const browser = Bun.spawn(
		[process.execPath, import.meta.path, "detached-browser"],
		{ detached: true, stdout: "pipe", stderr: "ignore" },
	);
	const ready = await browser.stdout.getReader().read();
	if (new TextDecoder().decode(ready.value).trim() !== "browser-ready")
		throw new Error("Detached browser did not install its TERM handler");
	let finish!: () => void;
	const stopped = new Promise<void>((resolve) => {
		finish = resolve;
	});
	process.once("SIGTERM", async () => {
		process.kill(-browser.pid, "SIGTERM");
		await Bun.sleep(1_000);
		process.kill(-browser.pid, "SIGKILL");
		await browser.exited;
		await writeFile(join(witness, "cleanup-completed"), "completed");
		finish();
	});
	console.log(
		JSON.stringify({
			phase: "cleanup-ready",
			pid: process.pid,
			browserPid: browser.pid,
		}),
	);
	const finite = setTimeout(finish, 6_000);
	try {
		await stopped;
	} finally {
		clearTimeout(finite);
	}
} else if (process.argv[2] === "root-exits-first") {
	const worker = Bun.spawn(
		[process.execPath, import.meta.path, "cleanup-worker", process.argv[3]!],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const reader = worker.stdout.getReader();
	const ready = await reader.read();
	if (!ready.value) throw new Error("Cleanup worker did not become ready");
	console.log(new TextDecoder().decode(ready.value).trim());
	// The root exits on TERM, closing its pipes while the independently piped
	// worker still needs one second to kill its detached browser group.
	process.once("SIGTERM", () => process.exit(143));
	await worker.exited;
} else if (process.argv[2] === "descendant") {
	const ignoreTermination = process.argv[3] === "ignore-term";
	if (ignoreTermination) process.on("SIGTERM", () => {});
	const scratch = join(tmpdir(), "nested", "vite-scratch");
	await mkdir(scratch, { recursive: true });
	await writeFile(join(scratch, "owned.txt"), "Synthetic timeout control");
	console.log(JSON.stringify({ phase: "descendant-ready", pid: process.pid }));
	// Finite even under the broken supervisor: never leave an intentional leak.
	await Bun.sleep(ignoreTermination ? 2_500 : 1_500);
	console.log("DESCENDANT_OUTLIVED_TIMEOUT");
} else {
	const descendant = Bun.spawn(
		[
			process.execPath,
			import.meta.path,
			"descendant",
			...process.argv.slice(2),
		],
		{ env: { ...process.env }, stdout: "inherit", stderr: "inherit" },
	);
	await descendant.exited;
}
