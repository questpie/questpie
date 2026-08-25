export type NotificationDelivery = Readonly<
	| { kind: "delivered"; receipt: string }
	| { kind: "rejected" }
	| { kind: "outcomeUnknown" }
>;

export async function postTicketSummary(
	receiver: URL,
	input: Readonly<{
		effectId: string;
		ticketId: string;
		reference: string;
		summary: string;
		status: string;
	}>,
	signal: AbortSignal,
): Promise<NotificationDelivery> {
	try {
		const response = await fetch(receiver, {
			method: "POST",
			signal,
			headers: {
				"content-type": "application/json",
				"idempotency-key": input.effectId,
				"x-questpie-effect-id": input.effectId,
			},
			body: JSON.stringify(input),
		});
		if (!response.ok) {
			await response.body?.cancel();
			return { kind: "rejected" };
		}
		const receipt = response.headers.get("x-team-support-receipt");
		await response.body?.cancel();
		return receipt !== null && receipt.length > 0 && receipt.length <= 128
			? { kind: "delivered", receipt }
			: { kind: "outcomeUnknown" };
	} catch {
		if (signal.aborted) throw signal.reason;
		return { kind: "outcomeUnknown" };
	}
}
