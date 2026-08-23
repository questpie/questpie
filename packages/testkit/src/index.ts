export type Cleanup = () => void | Promise<void>;

/** Private today; intentionally shaped so it can become a userland test helper. */
export class CleanupStack {
	readonly #cleanups: Cleanup[] = [];
	#disposed = false;

	defer(cleanup: Cleanup): void {
		if (this.#disposed)
			throw new TypeError("cleanup stack is already disposed");
		this.#cleanups.push(cleanup);
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		const failures: unknown[] = [];
		for (const cleanup of this.#cleanups.toReversed()) {
			try {
				await cleanup();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length > 0)
			throw new AggregateError(failures, "test cleanup failed");
	}
}

export async function eventually<Value>(
	probe: () => Value | Promise<Value>,
	input: Readonly<{
		accept: (value: Value) => boolean;
		timeoutMilliseconds?: number;
		intervalMilliseconds?: number;
		description?: string;
	}>,
): Promise<Value> {
	const timeoutMilliseconds = input.timeoutMilliseconds ?? 5_000;
	const intervalMilliseconds = input.intervalMilliseconds ?? 25;
	const deadline = Date.now() + timeoutMilliseconds;
	let last: Value;
	do {
		last = await probe();
		if (input.accept(last)) return last;
		await Bun.sleep(intervalMilliseconds);
	} while (Date.now() < deadline);
	throw new Error(
		`${input.description ?? "eventually condition"} was not met within ${timeoutMilliseconds}ms`,
	);
}

export async function waitForOutputLine(
	stream: ReadableStream<Uint8Array>,
	input: Readonly<{
		accept: (line: string) => boolean;
		timeoutMilliseconds?: number;
		description?: string;
	}>,
): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	const timeout = setTimeout(
		() => void reader.cancel(input.description ?? "output wait timed out"),
		input.timeoutMilliseconds ?? 10_000,
	);
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done)
				throw new Error(
					`${input.description ?? "expected output"} was not observed before the stream closed`,
				);
			buffered += decoder.decode(part.value, { stream: true });
			for (;;) {
				const newline = buffered.indexOf("\n");
				if (newline < 0) break;
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				if (input.accept(line)) return line;
			}
		}
	} finally {
		clearTimeout(timeout);
		reader.releaseLock();
	}
}
