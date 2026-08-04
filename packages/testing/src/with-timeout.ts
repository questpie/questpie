/**
 * Internal. Not exported from the package entry.
 *
 * Every production lifecycle operation this package drives has to be bounded:
 * a database that never answers, a child process that never exits and a port
 * that never frees all hang a test run instead of failing it. `disposable-postgres`
 * and `production-server` both need that bound, so it lives here rather than
 * once in each, where the two copies could drift apart.
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	operation: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
