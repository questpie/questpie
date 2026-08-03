import { describe, expect, it } from "bun:test";

import { MailerService } from "../../src/server/modules/core/integrated/mailer/service.js";
import emailService from "../../src/server/modules/core/services/email.js";

/**
 * This factory used to throw when `email.adapter` was missing. It is resolved
 * eagerly at boot, so an app that never sends mail still could not start.
 *
 * Every other optional slot degrades instead. Storage falls back to local disk,
 * and the queue service hands back an empty client when there are no jobs.
 *
 * MailerService already handled the missing adapter, and in a better place,
 * because it knows a send is being attempted. It uses ConsoleAdapter in
 * development and throws in production. That branch was dead while this factory
 * threw first.
 */
const build = (email?: unknown) =>
	(emailService.state.create as (ctx: any) => unknown)({
		app: { config: email === undefined ? {} : { email } },
	});

describe("email service boots without an adapter", () => {
	it("builds a mailer when nothing is configured", () => {
		expect(build()).toBeInstanceOf(MailerService);
	});

	it("builds a mailer when email is configured without an adapter", () => {
		expect(build({ defaults: { from: "hi@example.com" } })).toBeInstanceOf(
			MailerService,
		);
	});

	it("still builds a mailer when an adapter is given", () => {
		const adapter = { send: async () => ({ id: "1" }) };
		expect(build({ adapter })).toBeInstanceOf(MailerService);
	});

	it("keeps the config it was handed", () => {
		const mailer = build({ defaults: { from: "hi@example.com" } }) as any;
		expect(mailer.defaultFrom).toBe("hi@example.com");
	});
});
