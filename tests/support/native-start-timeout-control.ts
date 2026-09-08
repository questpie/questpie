import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.argv[2] === "descendant") {
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
