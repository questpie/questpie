import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

type Child = ReturnType<typeof Bun.spawn>;

type DevProcess = {
	name: string;
	args: string[];
};

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const children: Child[] = [];
let shuttingDown = false;

function portFromAppUrl(value: string | undefined) {
	if (!value) return null;
	try {
		const url = new URL(value);
		return Number(url.port || (url.protocol === "https:" ? 443 : 80));
	} catch {
		return null;
	}
}

function canListen(port: number) {
	return new Promise<boolean>((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		server.listen(port, "127.0.0.1");
	});
}

async function choosePort(preferredPort: number) {
	if (Bun.env.PORT || Bun.env.VITE_PORT || Bun.env.APP_URL) {
		return preferredPort;
	}
	for (let port = preferredPort; port < preferredPort + 20; port++) {
		if (await canListen(port)) return port;
	}
	return preferredPort;
}

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

const preferredPort =
	Number(Bun.env.PORT ?? Bun.env.VITE_PORT) ||
	portFromAppUrl(Bun.env.APP_URL) ||
	3000;
const port = await choosePort(preferredPort);
const appUrl = Bun.env.APP_URL ?? `http://localhost:${port}`;
const childEnv = { ...Bun.env, APP_URL: appUrl, PORT: String(port) };

const processes: DevProcess[] = [
	{
		name: "web",
		args: [
			"bun",
			"--bun",
			"vite",
			"dev",
			"--port",
			String(port),
			"--strictPort",
		],
	},
	{
		name: "worker",
		args: ["bun", "--bun", "run", "--watch", "./src/worker.ts"],
	},
	{
		name: "ai-worker",
		args: ["bun", "--bun", "run", "--watch", "./src/ai-worker.ts"],
	},
];

for (const devProcess of processes) {
	const child = Bun.spawn(devProcess.args, {
		cwd: appRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: childEnv,
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
process.stdout.write(`[dev] APP_URL=${appUrl}\n`);
