import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().url(),
		APP_URL: z.string().url().default("http://localhost:3000"),
		PORT: z
			.string()
			.transform(Number)
			.pipe(z.number().int().positive())
			.default("3000"),
		BETTER_AUTH_SECRET: z.string().min(1).default("change-me-in-production"),
		MAIL_ADAPTER: z.enum(["console", "smtp"]).default("console"),
		SMTP_HOST: z.string().optional(),
		SMTP_PORT: z
			.string()
			.transform(Number)
			.pipe(z.number().int().positive())
			.optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
