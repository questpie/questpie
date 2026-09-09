import type { GeneratedClientScope } from "#questpie/client";

export const nativeDeskId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
export const nativeDeskTicket = {
	id: nativeDeskId,
	organizationId: nativeDeskId,
	teamId: nativeDeskId,
	requesterMembershipId: nativeDeskId,
	assigneeMembershipId: null,
	reference: "SUP-1042",
	priority: "normal",
	status: "open",
	summary: "Created through native Mutation",
	description: "Native consumer test",
	createdAt: new Date("2026-09-08T10:00:00.000Z"),
	updatedAt: new Date("2026-09-08T10:00:00.000Z"),
	closedAt: null,
} satisfies Awaited<
	ReturnType<GeneratedClientScope["mutations"]["ticket.create"]>
>;
export const nativeDeskDetail = {
	...nativeDeskTicket,
	team: null,
	requester: null,
	assignee: null,
	comments: [],
	lastSlaFollowUpAt: null,
} satisfies NonNullable<
	Awaited<ReturnType<GeneratedClientScope["queries"]["tickets.detail"]>>
>;

type QueryName = keyof GeneratedClientScope["queries"];
type Binding = {
	bindingId: string;
	scopeId: string;
	query: `query:${QueryName}`;
};
const pageInfo = { endCursor: null, hasNextPage: false };

/** Controlled external HTTP/SSE peer; application UI still uses its generated transport. */
export function createNativeDeskPeer() {
	const streams = new Map<
		string,
		ReadableStreamDefaultController<Uint8Array>
	>();
	const bindings = new Map<string, Binding>();
	const opens: QueryName[] = [];
	const mutations: {
		request: Request;
		input: unknown;
		response: ReturnType<typeof Promise.withResolvers<Response>>;
	}[] = [];
	const deliveries = new Set<ReturnType<typeof setTimeout>>();
	const clearScope = (scopeId: string) => {
		streams.delete(scopeId);
		for (const [id, binding] of bindings)
			if (binding.scopeId === scopeId) bindings.delete(id);
	};
	let serial = 0;
	const snapshots = new Map<QueryName, unknown>([
		["tickets.queue", { nodes: [], pageInfo }],
		["labels.page", { nodes: [], pageInfo }],
		[
			"teams.list",
			{
				nodes: [
					{
						id: nativeDeskId,
						organizationId: nativeDeskId,
						name: "Support",
						routingStatus: "active",
					},
				],
				pageInfo,
			},
		],
		["tickets.detail", nativeDeskDetail],
	]);
	const send = (scopeId: string, frame: object) => {
		streams
			.get(scopeId)
			?.enqueue(
				new TextEncoder().encode(
					`data: ${JSON.stringify({ protocol: { name: "questpie.realtime", version: 1 }, ...frame })}\n\n`,
				),
			);
	};
	const deliver = (binding: Binding, payload: unknown, delivery: string) =>
		send(binding.scopeId, {
			kind: "delivery",
			bindingId: binding.bindingId,
			query: binding.query,
			delivery,
			payload,
			resetReason: null,
			resumeToken: `native-desk-${++serial}`,
		});
	const reply = (request: Request, envelope: object, status = 200) =>
		Response.json(
			{
				callId: request.headers.get(
					request.method === "GET" ? "Questpie-Call-Id" : "Idempotency-Key",
				),
				...envelope,
			},
			{
				status,
				headers: { "content-type": "application/json; charset=utf-8" },
			},
		);
	const transport = Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const request = new Request(input, init);
			const path = new URL(request.url).pathname;
			if (path.startsWith("/_questpie/mutation/")) {
				const body = await request.json();
				const response = Promise.withResolvers<Response>();
				mutations.push({ request, input: body.input, response });
				return response.promise;
			}
			if (path !== "/_questpie/realtime")
				throw new Error(`Unexpected native Desk request: ${path}`);
			if (request.method === "GET") {
				const scopeId = request.headers.get("x-questpie-realtime-scope")!;
				let closed = false;
				const close = () => {
					if (closed) return;
					closed = true;
					streams.get(scopeId)?.close();
					clearScope(scopeId);
				};
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							streams.set(scopeId, controller);
							send(scopeId, { kind: "ready", scopeId });
							request.signal.addEventListener("abort", close, { once: true });
						},
						cancel() {
							closed = true;
							clearScope(scopeId);
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				);
			}
			const command = await request.json();
			if (command.command === "open") {
				const binding: Binding = command;
				bindings.set(binding.bindingId, binding);
				const query = binding.query.slice("query:".length) as QueryName;
				opens.push(query);
				const delivery = setTimeout(() => {
					deliveries.delete(delivery);
					if (bindings.get(binding.bindingId) === binding)
						deliver(binding, snapshots.get(query), "initial");
				}, 0);
				deliveries.add(delivery);
			} else if (command.command === "close") {
				bindings.delete(command.bindingId);
			}
			return new Response(null, { status: 202 });
		},
		{ preconnect() {} },
	);
	return {
		transport,
		opens,
		bindings,
		mutations,
		get activeStreams() {
			return streams.size;
		},
		deliver(query: QueryName, payload: unknown) {
			snapshots.set(query, payload);
			for (const binding of bindings.values())
				if (binding.query === `query:${query}`)
					deliver(binding, payload, "update");
		},
		settleMutation(index: number, envelope: object, status = 200) {
			const mutation = mutations[index];
			if (!mutation) throw new Error("Native Mutation has not arrived");
			mutation.response.resolve(reply(mutation.request, envelope, status));
		},
		close() {
			for (const delivery of deliveries) clearTimeout(delivery);
			deliveries.clear();
			for (const mutation of mutations)
				mutation.response.resolve(
					reply(
						mutation.request,
						{ error: { code: "INTERNAL", retryable: false } },
						500,
					),
				);
			for (const controller of streams.values()) controller.close();
			streams.clear();
			bindings.clear();
		},
	};
}
