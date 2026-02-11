import { adminRpc } from "@questpie/admin/server";
import { ConsoleAdapter, pgBossAdapter, SmtpAdapter } from "questpie";
import { blocks } from "./blocks";
import { cmsBase } from "./cms-base";

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/cityportal";

/**
 * Full CMS instance with blocks registered.
 */
export const cms = cmsBase.blocks(blocks).build({
	app: {
		url: process.env.APP_URL || "http://localhost:3001",
	},
	db: {
		url: DATABASE_URL,
	},
	storage: {
		basePath: "/api/cms",
	},
	secret: process.env.SECRET,
	email: {
		adapter:
			process.env.MAIL_ADAPTER === "console"
				? new ConsoleAdapter({ logHtml: false })
				: new SmtpAdapter({
						transport: {
							host: process.env.SMTP_HOST || "localhost",
							port: Number.parseInt(process.env.SMTP_PORT || "1025", 10),
							secure: false,
						},
					}),
	},
	queue: {
		adapter: pgBossAdapter({
			connectionString: DATABASE_URL,
		}),
	},
});

export const appRpc = {
	...adminRpc,
};

export type AppCMS = typeof cms;
export type AppRpc = typeof appRpc;
