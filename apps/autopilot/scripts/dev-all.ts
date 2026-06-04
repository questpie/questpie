import { fileURLToPath } from "node:url";

type Child = ReturnType<typeof Bun.spawn>;

type DevProcess = {
	name: string;
	args: string[];
};

const processes: DevProcess[] = [
	{ name: "web", args: ["bun", "--bun", "vite", "dev"] },
	{
		name: "worker",
		args: ["bun", "--bun", "run", "--watch", "./src/worker.ts"],
	},
	{
		name: "ai-worker",
		args: ["bun", "--bun", "run", "--watch", "./src/ai-worker.ts"],
	},
];

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const children: Child[] = [];
let shuttingDown = false;

function writeLine(stream: NodeJS.WriteStream, name: string, line: string) {
	stream.write(`[${name}] ${line}\n`);
}

async function pipeOutput(
	stream: ReadableStream<Uint8Array> | null,
	name: string,
	target: NodeJS.WriteStream,
) {
	if (!stream) return;

	const decoder = new TextDecoder();
	let buffered = "";

	for await (const chunk of stream) {
		buffered += decoder.decode(chunk, { stream: true });
		const lines = buffered.split(/\r?\n/);
		buffered = lines.pop() ?? "";
		for (const line of lines) {
			writeLine(target, name, line);
		}
	}

	buffered += decoder.decode();
	if (buffered) writeLine(target, name, buffered);
}

async function shutdown(exitCode: number) {
	if (shuttingDown) return;
	shuttingDown = true;

	for (const child of children) {
		child.kill("SIGTERM");
	}

	const killTimer = setTimeout(() => {
		for (const child of children) {
			child.kill("SIGKILL");
		}
	}, 3000);

	await Promise.allSettled(children.map((child) => child.exited));
	clearTimeout(killTimer);
	process.exit(exitCode);
}

for (const devProcess of processes) {
	const child = Bun.spawn(devProcess.args, {
		cwd: appRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: Bun.env,
	});

	children.push(child);
	void pipeOutput(child.stdout, devProcess.name, process.stdout);
	void pipeOutput(child.stderr, devProcess.name, process.stderr);

	child.exited.then((code) => {
		if (shuttingDown) return;
		process.stderr.write(
			`[dev] ${devProcess.name} exited with code ${code}; stopping dev stack.\n`,
		);
		void shutdown(code === 0 ? 0 : 1);
	});
}

process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));

process.stdout.write(
	`[dev] started ${processes.map((devProcess) => devProcess.name).join(", ")}\n`,
);
