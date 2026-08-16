export type BoundedReviewProcessResult = {
	exitCode: number;
	timedOut: boolean;
	stdout: string;
	stderr: string;
};

function deadline(milliseconds: number): {
	promise: Promise<"deadline">;
	cancel: () => void;
} {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		promise: new Promise((resolve) => {
			timer = setTimeout(() => resolve("deadline"), milliseconds);
		}),
		cancel: () => clearTimeout(timer),
	};
}

async function boundedText(
	stream: ReadableStream<Uint8Array>,
	milliseconds: number,
): Promise<string> {
	const bound = deadline(milliseconds);
	try {
		const result = await Promise.race([
			new Response(stream).text(),
			bound.promise,
		]);
		return result === "deadline" ? "" : result;
	} finally {
		bound.cancel();
	}
}

export async function runBoundedReviewProcess(input: {
	command: string[];
	cwd: string;
	stdin: string;
	timeoutMs: number;
	terminationGraceMs?: number;
}): Promise<BoundedReviewProcessResult> {
	const child = Bun.spawn(input.command, {
		cwd: input.cwd,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = boundedText(child.stdout, input.timeoutMs + 10_000);
	const stderr = boundedText(child.stderr, input.timeoutMs + 10_000);
	child.stdin.write(input.stdin);
	child.stdin.end();

	const timeout = deadline(input.timeoutMs);
	const first = await Promise.race([
		child.exited.then((exitCode) => ({ exitCode, timedOut: false as const })),
		timeout.promise.then(() => ({ exitCode: -1, timedOut: true as const })),
	]);
	timeout.cancel();
	if (!first.timedOut)
		return {
			...first,
			stdout: await stdout,
			stderr: await stderr,
		};

	const graceMs = input.terminationGraceMs ?? 1_000;
	child.kill("SIGTERM");
	let grace = deadline(graceMs);
	let stopped = await Promise.race([
		child.exited.then(() => true),
		grace.promise.then(() => false),
	]);
	grace.cancel();
	if (!stopped) {
		child.kill("SIGKILL");
		grace = deadline(graceMs);
		stopped = await Promise.race([
			child.exited.then(() => true),
			grace.promise.then(() => false),
		]);
		grace.cancel();
	}

	return {
		exitCode: -1,
		timedOut: true,
		stdout: stopped ? await stdout : "",
		stderr: stopped ? await stderr : "",
	};
}
