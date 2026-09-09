import { expect } from "bun:test";

import {
	MutationObserver,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { createClient, type GeneratedClientScope } from "#questpie/client";

import { SelectedTicket } from "../../web/tickets/selected";
import { installNativeDeskDom, settleDeskUi } from "./native-desk-dom";
import {
	createNativeDeskPeer,
	nativeDeskDetail,
	nativeDeskId,
	nativeDeskTicket,
} from "./native-desk-peer";

function createDetailScene() {
	const restore = installNativeDeskDom();
	const peer = createNativeDeskPeer();
	const cache = new QueryClient();
	const desk = createClient({
		baseUrl: location.origin,
		fetch: peer.transport,
	}).withContext({ membershipId: nativeDeskId, organizationId: nativeDeskId });
	const api = createQueryAdapter(desk, cache);
	const container = document.querySelector("#root")!;
	const root = createRoot(container);
	const session = {
		label: "Agent",
		principalId: nativeDeskId,
		membershipId: nativeDeskId,
		organizationId: nativeDeskId,
		role: "agent" as const,
	};
	return {
		peer,
		cache,
		api,
		container,
		async mount() {
			await act(async () => {
				root.render(
					<QueryClientProvider client={cache}>
						<SelectedTicket
							api={api}
							desk={desk}
							session={session}
							ticketId={nativeDeskId}
						/>
					</QueryClientProvider>,
				);
			});
		},
		async close() {
			await act(async () => root.unmount());
			await api.dispose();
			cache.clear();
			peer.close();
			// TanStack batches observer notifications into the next task. Drain the
			// retired owner's queued notifications before removing the DOM globals.
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			restore();
		},
	};
}

export async function testNativeDeskPendingIntent(
	outcome: "unknown" | "known-commit" | "rejected" | "success" = "unknown",
) {
	const scene = createDetailScene();
	const { peer, cache, api, container } = scene;
	const visibleComment = {
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132",
		ticketId: nativeDeskId,
		authorMembershipId: nativeDeskId,
		body: "Previously disclosed comment",
		kind: "public",
		createdAt: nativeDeskDetail.updatedAt,
	};
	peer.deliver("tickets.detail", {
		...nativeDeskDetail,
		comments: [visibleComment],
	});
	try {
		await scene.mount();
		await settleDeskUi(
			() => container.textContent?.includes(visibleComment.body) === true,
		);
		const form = container.querySelector<HTMLFormElement>(".comment-form")!;
		form.querySelector<HTMLTextAreaElement>("textarea")!.value =
			"My pending comment";
		await act(async () =>
			form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
		);
		await settleDeskUi(() => peer.mutations.length === 1);
		await settleDeskUi(
			() => container.querySelector("[data-pending-comment]") !== null,
		);
		expect(
			container.querySelector("[data-pending-comment]")?.textContent,
		).toContain("My pending comment");
		expect(peer.mutations[0]?.input).toEqual({
			ticketId: nativeDeskId,
			body: "My pending comment",
		});
		const options = api.queries["tickets.detail"].options({ id: nativeDeskId });
		expect(cache.getQueryData(options.queryKey)?.comments).toHaveLength(1);
		expect(cache.getQueryData(options.queryKey)?.comments[0]?.body).toBe(
			visibleComment.body,
		);

		const { body: _body, ...omittedComment } = visibleComment;
		await act(async () =>
			peer.deliver("tickets.detail", {
				...nativeDeskDetail,
				summary: "New authorized title",
				comments: [omittedComment],
			}),
		);
		await settleDeskUi(
			() => container.textContent?.includes("New authorized title") === true,
		);
		expect(container.textContent).not.toContain(visibleComment.body);
		expect(container.textContent).toContain("Comment body hidden by Policy.");
		expect(
			container.querySelector("[data-pending-comment]")?.textContent,
		).toContain("My pending comment");

		await act(async () => peer.deliver("tickets.detail", null));
		await settleDeskUi(
			() => container.querySelector("[data-detail-reference]") === null,
		);
		expect(container.querySelector("[data-pending-comment]")).toBeNull();
		expect(container.textContent).not.toContain("My pending comment");
		const result = {
			comment: { ...visibleComment, body: "My pending comment" },
			job: { runId: nativeDeskId, resource: "ticket.slaFollowUp" },
		} satisfies Awaited<
			ReturnType<GeneratedClientScope["mutations"]["ticket.addComment"]>
		>;
		await act(async () => {
			if (outcome === "success") peer.settleMutation(0, { result });
			else if (outcome === "known-commit")
				peer.settleMutation(
					0,
					{
						error: {
							code: "COMMITTED_RESULT_UNAVAILABLE",
							retryable: true,
							transactionId: "17",
						},
					},
					500,
				);
			else if (outcome === "rejected")
				peer.settleMutation(
					0,
					{
						error: { code: "TICKET_UNAVAILABLE", payload: null },
					},
					404,
				);
			else peer.settleMutation(0, { unexpected: "Unknown write outcome" }, 500);
		});
		await settleDeskUi(() =>
			cache
				.getMutationCache()
				.getAll()
				.every((mutation) => mutation.state.status !== "pending"),
		);
		expect(cache.getQueryData(options.queryKey)).toBeNull();
		const mutation = cache.getMutationCache().getAll()[0]!;
		expect(mutation.state.status).toBe(
			outcome === "success" ? "success" : "error",
		);
		if (outcome === "known-commit")
			expect(mutation.state.error).toMatchObject({
				code: "COMMITTED_RESULT_UNAVAILABLE",
			});
		if (outcome === "rejected")
			expect(mutation.state.error).toMatchObject({
				code: "TICKET_UNAVAILABLE",
			});
		expect(container.textContent).not.toContain(visibleComment.body);
		expect(peer.mutations).toHaveLength(1);
	} finally {
		await scene.close();
	}
}

export async function testNativeDeskOverlappingIntent() {
	const scene = createDetailScene();
	const { peer, cache, api, container } = scene;
	const edit = new MutationObserver(
		cache,
		api.mutations["ticket.edit"].options(),
	);
	let editing: Promise<unknown> | undefined;
	try {
		await scene.mount();
		await settleDeskUi(() => container.querySelector(".comment-form") !== null);
		const form = container.querySelector<HTMLFormElement>(".comment-form")!;
		form.querySelector<HTMLTextAreaElement>("textarea")!.value =
			"Rejected pending comment";
		await act(async () =>
			form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
		);
		await settleDeskUi(
			() => container.querySelector("[data-pending-comment]") !== null,
		);
		const options = api.queries["tickets.detail"].options({ id: nativeDeskId });
		expect(cache.getQueryData(options.queryKey)?.comments).toHaveLength(0);
		// A second application control can commit while this panel's intent is pending.
		editing = edit
			.mutate({
				ticketId: nativeDeskId,
				summary: "Another control's committed edit",
			})
			.catch((error: unknown) => error);
		await settleDeskUi(() => peer.mutations.length === 2);
		expect(
			cache
				.getMutationCache()
				.getAll()
				.filter((mutation) => mutation.state.status === "pending"),
		).toHaveLength(2);
		await act(async () => {
			peer.settleMutation(1, {
				result: {
					...nativeDeskTicket,
					summary: "Another control's committed edit",
				},
			});
			peer.deliver("tickets.detail", {
				...nativeDeskDetail,
				summary: "Another control's committed edit",
			});
			await editing;
		});
		await settleDeskUi(
			() =>
				container.querySelector("#detail-heading")?.textContent ===
				"Another control's committed edit",
		);
		expect(
			container.querySelector("[data-pending-comment]")?.textContent,
		).toContain("Rejected pending comment");
		await act(async () =>
			peer.settleMutation(
				0,
				{ error: { code: "TICKET_UNAVAILABLE", payload: null } },
				404,
			),
		);
		await settleDeskUi(
			() => container.querySelector("[data-pending-comment]") === null,
		);
		expect(cache.getQueryData(options.queryKey)?.summary).toBe(
			"Another control's committed edit",
		);
		expect(container.querySelector("#detail-heading")?.textContent).toBe(
			"Another control's committed edit",
		);
		expect(cache.getQueryData(options.queryKey)?.comments).toHaveLength(0);
		expect(peer.mutations).toHaveLength(2);
	} finally {
		peer.close();
		await editing;
		edit.reset();
		await scene.close();
	}
}
