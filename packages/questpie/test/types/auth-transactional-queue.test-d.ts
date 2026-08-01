import type { DBTransactionAdapter } from "better-auth";
import { z } from "zod";

import type { AuthTransactionalQueueTransaction } from "../../src/exports/auth.js";
import { job } from "../../src/exports/index.js";

const verificationJob = job({
	name: "send-auth-verification",
	schema: z.object({ verificationId: z.string(), token: z.string() }),
	handler: async () => {},
});

declare const transaction: AuthTransactionalQueueTransaction;

const authAdapter: DBTransactionAdapter = transaction.auth;
void authAdapter;

transaction.publish(
	verificationJob,
	{ verificationId: "verification-1", token: "secret" },
	{ idempotencyKey: "auth-verification:verification-1" },
);

transaction.publish(
	verificationJob,
	{
		// @ts-expect-error payloads stay coupled to the concrete registered job type
		verificationId: 42,
		token: "secret",
	},
	{
		idempotencyKey: "auth-verification:verification-1",
	},
);

// @ts-expect-error Auth dispatch always requires an idempotency identity
transaction.publish(verificationJob, {
	verificationId: "verification-1",
	token: "secret",
});

transaction.publish(
	verificationJob,
	{ verificationId: "verification-1", token: "secret" },
	{
		idempotencyKey: "auth-verification:verification-1",
		// @ts-expect-error the bridge does not expose general Queue scheduling options
		startAfter: 60,
	},
);
