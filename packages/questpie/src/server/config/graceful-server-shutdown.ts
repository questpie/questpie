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
 * @internal Used by self-hosted framework adapters. The server remains the
 * owner of request draining; QUESTPIE only tears down its resources afterward.
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
