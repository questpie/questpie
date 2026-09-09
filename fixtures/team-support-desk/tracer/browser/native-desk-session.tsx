import { expect } from "bun:test";

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DeskSession } from "../../web/auth/desk-session";
import { installNativeDeskDom, settleDeskUi } from "./native-desk-dom";
import {
	createNativeDeskPeer,
	nativeDeskId,
	nativeDeskTicket,
} from "./native-desk-peer";

export async function testNativeDeskSession() {
	const restore = installNativeDeskDom();
	const peer = createNativeDeskPeer();
	const previousFetch = globalThis.fetch;
	globalThis.fetch = peer.transport;
	const container = document.querySelector("#root")!;
	const root = createRoot(container);
	const session = {
		label: "Agent",
		principalId: nativeDeskId,
		membershipId: nativeDeskId,
		organizationId: nativeDeskId,
		role: "agent" as const,
	};
	const onSignOut = async () => {};
	try {
		await act(async () => {
			root.render(
				<StrictMode>
					<DeskSession session={session} onSignOut={onSignOut} />
				</StrictMode>,
			);
		});
		await settleDeskUi(
			() =>
				container.querySelector('[data-queue-state][data-kind="ready"]') !==
				null,
		);
		expect(
			peer.opens.filter((query) => query === "tickets.queue"),
		).toHaveLength(1);
		expect(peer.activeStreams).toBe(1);
		await act(async () => {
			root.render(
				<StrictMode>
					<DeskSession session={{ ...session }} onSignOut={onSignOut} />
				</StrictMode>,
			);
		});
		expect(
			peer.opens.filter((query) => query === "tickets.queue"),
		).toHaveLength(1);
		const create = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "New ticket",
		)!;
		await act(async () => create.click());
		const form = container.querySelector<HTMLFormElement>("dialog[open] form")!;
		for (const [name, value] of Object.entries({
			reference: nativeDeskTicket.reference,
			summary: nativeDeskTicket.summary,
			description: nativeDeskTicket.description,
		})) {
			(form.elements.namedItem(name) as HTMLInputElement).value = value;
		}
		await act(async () =>
			form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
		);
		await settleDeskUi(() => peer.mutations.length === 1);
		expect(
			form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
		).toBe(true);
		expect(peer.mutations[0]?.input).toEqual({
			description: nativeDeskTicket.description,
			priority: "normal",
			reference: nativeDeskTicket.reference,
			summary: nativeDeskTicket.summary,
			teamId: nativeDeskId,
		});
		await act(async () => peer.settleMutation(0, { result: nativeDeskTicket }));
		await settleDeskUi(
			() =>
				container.querySelector("[data-detail-reference]")?.textContent ===
				nativeDeskTicket.reference,
		);
		expect(container.querySelector("dialog[open]")).toBeNull();
		expect(
			container.querySelector('[data-queue-state][data-kind="ready"]'),
		).not.toBeNull();
		expect(peer.mutations).toHaveLength(1);
		await act(async () => root.unmount());
		await settleDeskUi(
			() => peer.bindings.size === 0 && peer.activeStreams === 0,
		);
		expect(container.textContent).toBe("");
	} finally {
		await act(async () => root.unmount());
		peer.close();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		globalThis.fetch = previousFetch;
		restore();
	}
}

export async function testNativeDeskCredentialReplacement() {
	const restore = installNativeDeskDom();
	const peer = createNativeDeskPeer();
	const previousFetch = globalThis.fetch;
	globalThis.fetch = peer.transport;
	const container = document.querySelector("#root")!;
	const root = createRoot(container);
	const session = {
		label: "Agent",
		principalId: nativeDeskId,
		membershipId: nativeDeskId,
		organizationId: nativeDeskId,
		role: "agent" as const,
	};
	const onSignOut = async () => {};
	const renderCredential = async (credentialLifetime: string) => {
		await act(async () => {
			root.render(
				<StrictMode>
					<DeskSession
						key={credentialLifetime}
						session={session}
						onSignOut={onSignOut}
					/>
				</StrictMode>,
			);
		});
		await settleDeskUi(
			() =>
				container.querySelector('[data-queue-state][data-kind="ready"]') !==
				null,
		);
	};
	const submitCreate = async (summary: string) => {
		const create = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "New ticket",
		)!;
		await act(async () => create.click());
		const form = container.querySelector<HTMLFormElement>("dialog[open] form")!;
		for (const [name, value] of Object.entries({
			reference: nativeDeskTicket.reference,
			summary,
			description: nativeDeskTicket.description,
		})) {
			(form.elements.namedItem(name) as HTMLInputElement).value = value;
		}
		await act(async () =>
			form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
		);
		return form;
	};
	try {
		await renderCredential("session-before");
		const oldScopes = new Set(
			[...peer.bindings.values()].map(({ scopeId }) => scopeId),
		);
		expect(oldScopes.size).toBe(1);
		const oldForm = await submitCreate("Old pending credential intent");
		await settleDeskUi(() => peer.mutations.length === 1);
		expect(
			oldForm.querySelector<HTMLButtonElement>('button[type="submit"]')!
				.disabled,
		).toBe(true);
		await renderCredential("session-after");
		expect(oldForm.isConnected).toBe(false);
		expect(container.querySelector("dialog[open]")).toBeNull();
		expect(
			[...peer.bindings.values()].some(({ scopeId }) => oldScopes.has(scopeId)),
		).toBe(false);
		expect(peer.activeStreams).toBe(1);
		const replacementForm = await submitCreate("New credential intent");
		await settleDeskUi(() => peer.mutations.length === 2);
		await act(async () =>
			peer.settleMutation(0, {
				result: { ...nativeDeskTicket, summary: "Late old credential result" },
			}),
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(container.querySelector("[data-detail-reference]")).toBeNull();
		expect(container.textContent).not.toContain("Late old credential result");
		expect(replacementForm.closest("dialog")?.open).toBe(true);
		expect(
			replacementForm.querySelector<HTMLButtonElement>('button[type="submit"]')!
				.disabled,
		).toBe(true);
		await act(async () => peer.settleMutation(1, { result: nativeDeskTicket }));
		await settleDeskUi(
			() =>
				container.querySelector("[data-detail-reference]")?.textContent ===
				nativeDeskTicket.reference,
		);
		expect(container.querySelector("dialog[open]")).toBeNull();
		expect(peer.mutations).toHaveLength(2);
		await act(async () => root.unmount());
		await settleDeskUi(
			() => peer.bindings.size === 0 && peer.activeStreams === 0,
		);
		expect(container.textContent).toBe("");
	} finally {
		await act(async () => root.unmount());
		peer.close();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		globalThis.fetch = previousFetch;
		restore();
	}
}
