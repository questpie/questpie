import { codec, defineService, operation, policy } from "questpie";

import { defineAction } from "#questpie/app";
import type { ActionServices, ExecutionServices } from "#questpie/app";

import { postTicketSummary } from "../runtime/notification-provider";

class NotificationProviderRejection extends Error {
	readonly status: number;

	constructor(status: number) {
		super(`notification provider rejected the request with ${status}`);
		this.name = "NotificationProviderRejection";
		this.status = status;
	}
}

class NotificationOutcomeUnknown extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NotificationOutcomeUnknown";
	}
}

// Current v4 Service Definitions have no public application-config injection
// seam. The local tracer therefore owns this disposable receiver address.
export const localNotificationReceiverUrl =
	"http://127.0.0.1:43121/team-support/notifications";

export const notificationProvider = defineService({
	name: "notification.provider",
	lifetime: "execution",
	effect: "external",
	create: ({ signal }) => {
		const receiver = new URL(localNotificationReceiverUrl);
		return Object.freeze({
			sendTicketSummary: async (input: {
				effectId: string;
				ticketId: string;
				reference: string;
				summary: string;
				status: string;
			}) => {
				const result = await postTicketSummary(receiver, input, signal);
				if (result.kind === "rejected")
					throw new NotificationProviderRejection(502);
				if (result.kind === "outcomeUnknown")
					throw new NotificationOutcomeUnknown(
						"notification provider returned no durable receipt",
					);
				return Object.freeze({ receipt: result.receipt });
			},
		});
	},
});

export const sendTicketSummary = defineAction({
	name: "notification.sendTicketSummary",
	network: true,
	input: codec.object({ ticketId: codec.uuid() }),
	output: codec.object({
		effectId: codec.uuid(),
		ticketReference: codec.text(),
		providerReceipt: codec.text(),
	}),
	policy: policy.authenticated(),
	errors: {
		ticketUnavailable: operation.error({
			code: "TICKET_UNAVAILABLE",
			status: 404,
		}),
		providerRejected: operation.error({
			code: "NOTIFICATION_PROVIDER_REJECTED",
			status: 502,
		}),
		outcomeUnknown: operation.error({
			code: "NOTIFICATION_OUTCOME_UNKNOWN",
			status: 503,
		}),
	},
	limits: {
		inputBytes: 1_024,
		resultBytes: 2_048,
		durationMilliseconds: 3_000,
	},
	handler: async ({ input, ctx, effect, errors }) => {
		const ticket = await ctx.queries.tickets.detail({ id: input.ticketId });
		if (ticket === null) throw errors.ticketUnavailable();
		try {
			const delivered = await ctx.services[
				"notification.provider"
			].sendTicketSummary({
				effectId: effect.id,
				ticketId: ticket.id,
				reference: ticket.reference,
				summary: ticket.summary,
				status: ticket.status,
			});
			return {
				effectId: effect.id,
				ticketReference: ticket.reference,
				providerReceipt: delivered.receipt,
			};
		} catch (error) {
			if (ctx.signal.aborted && error === ctx.signal.reason) throw error;
			if (error instanceof NotificationProviderRejection)
				throw errors.providerRejected();
			if (error instanceof NotificationOutcomeUnknown)
				throw errors.outcomeUnknown();
			throw errors.outcomeUnknown();
		}
	},
});

function actionServiceCapabilityContract(
	action: ActionServices,
	execution: ExecutionServices,
): void {
	void action["notification.provider"];
	// @ts-expect-error external-effect execution Service is Action-only.
	void execution["notification.provider"];
}

void actionServiceCapabilityContract;
