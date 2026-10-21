import { createHash } from "node:crypto";

/** Stable storage scope without credentials, pool settings or URL spelling. */
export function queueExecutionIdentity(
	adapter: string,
	options: {
		connectionString?: string;
		host?: string;
		port?: number;
		database?: string;
		user?: string;
	},
	schema: string,
): string {
	const url = options.connectionString
		? new URL(options.connectionString)
		: undefined;
	const user =
		url?.username || options.user || process.env.PGUSER || process.env.USER;
	const target = [
		adapter,
		schema,
		url?.searchParams.get("host") ||
			url?.hostname ||
			options.host ||
			process.env.PGHOST ||
			"localhost",
		url?.searchParams.get("port") ||
			url?.port ||
			String(options.port || process.env.PGPORT || 5432),
		url?.searchParams.get("dbname") ||
			(url?.pathname ? decodeURIComponent(url.pathname.slice(1)) : "") ||
			options.database ||
			process.env.PGDATABASE ||
			user,
	];
	return createHash("sha256").update(JSON.stringify(target)).digest("hex");
}
