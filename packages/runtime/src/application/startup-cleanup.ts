type PartialRuntime = Readonly<{
	close(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}>;

export async function failRuntimeApplicationStartup(
	input: Readonly<{
		error: unknown;
		abort(): void;
		runtime: PartialRuntime | undefined;
		closeSql(deadlineAt: number): Promise<void>;
	}>,
): Promise<never> {
	const deadlineAt = Date.now() + 30_000;
	try {
		input.abort();
	} catch {
		// The startup failure remains primary.
	}
	if (input.runtime)
		try {
			await input.runtime.close({ deadlineAt });
		} catch {
			// The startup failure remains primary.
		}
	try {
		await input.closeSql(deadlineAt);
	} catch {
		// The startup failure remains primary.
	}
	throw input.error;
}
