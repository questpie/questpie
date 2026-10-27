import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const node = Bun.which("node");
const nodeTest = node ? it : it.skip;

nodeTest(
	"SDK Express keeps serving after trailing bytes on a compressed JSON body",
	async () => {
		const child = Bun.spawn(
			[
				node!,
				fileURLToPath(
					new URL(
						"./fixtures/sdk-express-compressed-body.mjs",
						import.meta.url,
					),
				),
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
		try {
			const [exit, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
			expect(stdout.trim()).toBe(
				"compressed body and subsequent request passed",
			);
		} finally {
			clearTimeout(timer);
			if (child.exitCode === null) child.kill();
		}
	},
	10_000,
);
