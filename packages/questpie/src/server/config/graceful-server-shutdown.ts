export type GracefulServer = Readonly<{
	close(closeActiveConnections?: boolean): void | Promise<void>;
}>;

export type GracefulServerShutdown = Readonly<{
	attach(server: GracefulServer): void;
	shutdown(): Promise<void>;
}>;

/**
 * Orders application teardown after the owning Fetch server has drained.
 *
 * Exported from `questpie/app`, and every starter template calls it. It was
 * marked `@internal`, which was wrong: this is the seam an app uses to tear
 * QUESTPIE down, and there is no other.
 *
 * It orders teardown and nothing else. It installs no signal handler, because
 * only the caller knows which signals its platform sends. Attach your server if
 * you hold one, so requests drain before resources close. Skip `attach` and it
 * still releases resources, it just cannot drain.
 *
 * The server stays the owner of request draining. QUESTPIE tears down its own
 * resources afterwards.
 */
export function createGracefulServerShutdown(
	destroy: () => void | Promise<void>,
): GracefulServerShutdown {
	let server: GracefulServer | undefined;
	let shutdownPromise: Promise<void> | undefined;

	return Object.freeze({
		attach(nextServer) {
			if (server && server !== nextServer) {
				throw new Error("Graceful shutdown server is already attached");
			}
			server = nextServer;
		},
		shutdown() {
			return (shutdownPromise ??= (async () => {
				try {
					await server?.close();
				} finally {
					await destroy();
				}
			})());
		},
	});
}
