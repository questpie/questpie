declare module "#nitro/virtual/tracing" {
	export const tracingSrvxPlugins: Array<
		(server: {
			close(closeActiveConnections?: boolean): void | Promise<void>;
		}) => void
	>;
}
