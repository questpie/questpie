/**
 * Barbershop Environment
 *
 * Schema-declared, boot-validated env — the single touchpoint for
 * `process.env`. The generated app imports this file before the runtime
 * config, so a misconfigured environment fails boot before adapters,
 * auth, and the database initialize.
 */

import { env } from "questpie/env";
import { z } from "zod";

import client from "./env.client";

export default env({
	client,
	server: {
		DATABASE_URL: z.string().default("postgres://localhost/barbershop"),
		BETTER_AUTH_SECRET: z.string().default("demo-secret-change-in-production"),
		MAIL_ADAPTER: z.enum(["console", "smtp"]).optional(),
		SMTP_HOST: z.string().default("localhost"),
		SMTP_PORT: z.coerce.number().default(1025),
	},
});
