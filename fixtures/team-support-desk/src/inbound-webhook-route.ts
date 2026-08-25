import { policy } from "questpie";

import { defineRoute } from "#questpie/app";
import type { RouteContext } from "#questpie/app";

const signatureHeader = "x-team-support-signature";
const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type InboundTicketEvent = Readonly<{
	eventId: string;
	organizationId: string;
	membershipId: string;
	teamId: string;
	reference: string;
	priority: string;
	summary: string;
	description: string;
}>;

// Current v4 Route Definitions have no public application-config injection
// seam. The local tracer signs with this committed non-production secret.
export const localWebhookSecret = "team-support-local-webhook-signing-key-v1";

function signatureBytes(value: string | null): Uint8Array<ArrayBuffer> | null {
	const match = value === null ? null : /^sha256=([0-9a-f]{64})$/.exec(value);
	if (match === null) return null;
	const bytes = new Uint8Array(32);
	for (let index = 0; index < bytes.length; index += 1)
		bytes[index] = Number.parseInt(
			match[1]!.slice(index * 2, index * 2 + 2),
			16,
		);
	return bytes;
}

async function validSignature(
	body: Uint8Array<ArrayBuffer>,
	header: string | null,
): Promise<boolean> {
	const candidate = signatureBytes(header);
	if (candidate === null) return false;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(localWebhookSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify("HMAC", key, candidate, body);
}

function inboundEvent(value: unknown): InboundTicketEvent | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const event = value as Record<string, unknown>;
	const expected = [
		"description",
		"eventId",
		"membershipId",
		"organizationId",
		"priority",
		"reference",
		"summary",
		"teamId",
	];
	const actual = Object.keys(event).sort();
	if (
		actual.length !== expected.length ||
		actual.some((key, index) => key !== expected[index])
	)
		return null;
	for (const key of expected) if (typeof event[key] !== "string") return null;
	if (
		(event.eventId as string).length === 0 ||
		(event.eventId as string).length > 128 ||
		!uuidPattern.test(event.organizationId as string) ||
		!uuidPattern.test(event.membershipId as string) ||
		!uuidPattern.test(event.teamId as string)
	)
		return null;
	if (
		(event.reference as string).length === 0 ||
		(event.reference as string).length > 64 ||
		(event.priority as string).length === 0 ||
		(event.priority as string).length > 16 ||
		(event.summary as string).length === 0 ||
		(event.summary as string).length > 256 ||
		(event.description as string).length > 8_192
	)
		return null;
	return event as InboundTicketEvent;
}

export const inboundTicketWebhook = defineRoute({
	name: "support.inboundTicket",
	method: "POST",
	path: "/webhooks/support/inbound",
	policy: policy.authenticated(),
	credentials: "application",
	limits: { bodyBytes: 12_288, durationMs: 3_000 },
	handler: async ({ request, ctx }) => {
		const body = new Uint8Array(await request.arrayBuffer());
		if (!(await validSignature(body, request.headers.get(signatureHeader))))
			return Response.json(
				{ error: "invalid webhook signature" },
				{ status: 401 },
			);

		let decoded: unknown;
		try {
			decoded = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(body),
			);
		} catch {
			return Response.json({ error: "invalid webhook event" }, { status: 400 });
		}
		const event = inboundEvent(decoded);
		if (event === null)
			return Response.json({ error: "invalid webhook event" }, { status: 400 });

		const ticket = await ctx.execution(
			{
				principal: ctx.principal,
				context: {
					organizationId: event.organizationId,
					membershipId: event.membershipId,
				},
				signal: ctx.signal,
				deadline: ctx.deadline,
			},
			({ mutations }) =>
				mutations.ticket.create(
					{
						teamId: event.teamId,
						reference: event.reference,
						priority: event.priority,
						summary: event.summary,
						description: event.description,
					},
					{
						callId: event.eventId,
						signal: ctx.signal,
						deadline: ctx.deadline,
					},
				),
		);
		return Response.json({ eventId: event.eventId, ticket }, { status: 202 });
	},
});

function routeCapabilityContract(ctx: RouteContext): void {
	// @ts-expect-error Route ingress cannot mutate before explicit execution.
	void ctx.mutations;
	// @ts-expect-error Route ingress cannot access relational data directly.
	void ctx.data;
}

void routeCapabilityContract;
