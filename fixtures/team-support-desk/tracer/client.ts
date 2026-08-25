import { createClient } from "#questpie/client";

type Session = Readonly<{
	label: string;
	membershipId: string;
	organizationId: string;
	principalId: string;
	role: "customer" | "agent" | "admin";
}>;

function element<ElementType extends Element>(selector: string): ElementType {
	const found = document.querySelector<ElementType>(selector);
	if (!found)
		throw new TypeError(`Team Support Desk markup is missing ${selector}`);
	return found;
}

function message(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0)
		return error.message.replaceAll("_", " ").toLowerCase();
	return "the request could not be completed";
}

function dateTime(value: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(value);
}

async function loadSession(): Promise<Session> {
	const response = await fetch("/__team_support/session", {
		headers: { accept: "application/json" },
	});
	if (!response.ok) throw new Error("signed session unavailable");
	return (await response.json()) as Session;
}

async function report(value: Readonly<Record<string, unknown>>): Promise<void> {
	await fetch("/__team_support/report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(value),
	});
}

async function until(
	condition: () => boolean,
	description: string,
): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`${description} timed out`);
}

async function start(): Promise<void> {
	const session = await loadSession();
	element<HTMLElement>("[data-persona]").textContent =
		`${session.label} · ${session.role}`;
	const desk = createClient({ baseUrl: location.origin }).withContext({
		organizationId: session.organizationId,
		membershipId: session.membershipId,
	});
	type TicketPage = Awaited<ReturnType<(typeof desk.queries)["tickets.list"]>>;
	type TicketListNode = TicketPage["nodes"][number];
	type TicketDetail = Awaited<
		ReturnType<(typeof desk.queries)["tickets.detail"]>
	>;
	type CommentPage = Awaited<
		ReturnType<(typeof desk.queries)["comments.page"]>
	>;
	type LabelPage = Awaited<ReturnType<(typeof desk.queries)["labels.page"]>>;
	type TeamPage = Awaited<ReturnType<(typeof desk.queries)["teams.list"]>>;

	const ticketList = element<HTMLUListElement>("[data-ticket-list]");
	const queueState = element<HTMLElement>("[data-queue-state]");
	const statusFilter = element<HTMLSelectElement>("[data-status-filter]");
	const teamFilter = element<HTMLSelectElement>("[data-team-filter]");
	const previousButton = element<HTMLButtonElement>("[data-page-previous]");
	const nextButton = element<HTMLButtonElement>("[data-page-next]");
	const pageNumber = element<HTMLElement>("[data-page-number]");
	const detailEmpty = element<HTMLElement>("[data-detail-empty]");
	const detailContent = element<HTMLElement>("[data-detail-content]");
	const commentsState = element<HTMLElement>("[data-comments-state]");
	const commentsList = element<HTMLOListElement>("[data-comments]");
	const commentCount = element<HTMLElement>("[data-comment-count]");
	const actionStatus = element<HTMLElement>("[data-action-status]");
	const transitionButton = element<HTMLButtonElement>(
		"[data-action-transition]",
	);
	const assignButton = element<HTMLButtonElement>("[data-action-assign]");
	const summaryButton = element<HTMLButtonElement>("[data-action-summary]");
	const editButton = element<HTMLButtonElement>("[data-action-edit]");
	const createDialog = element<HTMLDialogElement>("[data-create-dialog]");
	const editDialog = element<HTMLDialogElement>("[data-edit-dialog]");
	const createForm = element<HTMLFormElement>("[data-create-form]");
	const editForm = element<HTMLFormElement>("[data-edit-form]");
	const createTeam = element<HTMLSelectElement>("[data-create-team]");
	for (const close of document.querySelectorAll<HTMLButtonElement>(
		"[data-dialog-close]",
	))
		close.addEventListener("click", () => close.closest("dialog")?.close());

	let currentPage: TicketPage | null = null;
	let selected: TicketDetail | null = null;
	let teams: TeamPage["nodes"] = [];
	let cursors: Array<string | null> = [null];
	let pageIndex = 0;
	let queueRequest = 0;
	let detailRequest = 0;
	let busy = false;

	function setBusy(next: boolean): void {
		busy = next;
		const unavailable = next || selected === null;
		transitionButton.disabled = unavailable || session.role === "customer";
		assignButton.disabled =
			unavailable ||
			session.role === "customer" ||
			selected?.assignee?.id === session.membershipId;
		summaryButton.disabled = unavailable || session.role === "customer";
		editButton.disabled =
			unavailable ||
			(session.role === "customer" && selected?.status === "closed");
		createForm.querySelector<HTMLButtonElement>(
			'button[type="submit"]',
		)!.disabled = next;
		editForm.querySelector<HTMLButtonElement>(
			'button[type="submit"]',
		)!.disabled = next;
		element<HTMLButtonElement>(
			'[data-comment-form] button[type="submit"]',
		)!.disabled = next || selected === null;
	}

	function setActionStatus(text: string, kind: "ok" | "error" = "ok"): void {
		actionStatus.textContent = text;
		actionStatus.dataset.kind = kind;
	}

	function queueInput(): Readonly<{ after: string | null; first: number }> {
		return { after: cursors[pageIndex] ?? null, first: 8 };
	}

	async function queryQueue(): Promise<TicketPage> {
		const status = statusFilter.value;
		const teamId = teamFilter.value;
		const input = queueInput();
		if (status && teamId)
			return desk.queries["tickets.listByStatusAndTeam"]({
				...input,
				status,
				teamId,
			});
		if (status)
			return desk.queries["tickets.listByStatus"]({ ...input, status });
		if (teamId) return desk.queries["tickets.listByTeam"]({ ...input, teamId });
		return desk.queries["tickets.list"](input);
	}

	function renderQueue(page: TicketPage): void {
		currentPage = page;
		queueState.dataset.kind = "ready";
		queueState.textContent =
			page.nodes.length === 0
				? "No tickets match these filters."
				: `${page.nodes.length} ticket${page.nodes.length === 1 ? "" : "s"} on this page`;
		ticketList.replaceChildren(
			...page.nodes.map((ticket: TicketListNode) => {
				const item = document.createElement("li");
				const button = document.createElement("button");
				button.type = "button";
				button.className = "ticket-card";
				button.dataset.ticketId = ticket.id;
				button.setAttribute("aria-current", String(selected?.id === ticket.id));
				const copy = document.createElement("span");
				const summary = document.createElement("strong");
				summary.textContent = ticket.summary;
				const metadata = document.createElement("small");
				metadata.textContent = `${ticket.reference} · ${ticket.team?.name ?? "Unrouted"}`;
				copy.append(summary, metadata);
				const status = document.createElement("span");
				status.className = "queue-status";
				status.dataset.status = ticket.status;
				status.textContent = ticket.status;
				button.append(copy, status);
				button.addEventListener("click", () => void selectTicket(ticket.id));
				item.append(button);
				return item;
			}),
		);
		ticketList.ariaBusy = "false";
		previousButton.disabled = busy || pageIndex === 0;
		nextButton.disabled = busy || !page.pageInfo.hasNextPage;
		pageNumber.textContent = `Page ${pageIndex + 1}`;
	}

	async function loadQueue(reset = false): Promise<void> {
		if (reset) {
			cursors = [null];
			pageIndex = 0;
		}
		const request = ++queueRequest;
		queueState.dataset.kind = "loading";
		queueState.textContent = "Loading queue…";
		ticketList.ariaBusy = "true";
		previousButton.disabled = true;
		nextButton.disabled = true;
		try {
			const page = await queryQueue();
			if (request === queueRequest) renderQueue(page);
		} catch (error) {
			if (request !== queueRequest) return;
			queueState.dataset.kind = "error";
			queueState.textContent = `Queue error: ${message(error)}.`;
			ticketList.replaceChildren();
			ticketList.ariaBusy = "false";
		}
	}

	function renderComments(page: CommentPage): void {
		commentsState.textContent =
			page.nodes.length === 0 ? "No activity yet." : "";
		commentCount.textContent = `${page.nodes.length} comment${page.nodes.length === 1 ? "" : "s"}`;
		commentsList.replaceChildren(
			...page.nodes.map((comment) => {
				const item = document.createElement("li");
				item.className = "comment";
				const avatar = document.createElement("span");
				avatar.className = "avatar";
				avatar.ariaHidden = "true";
				avatar.textContent = (comment.author?.role ?? "?").slice(0, 2);
				const content = document.createElement("div");
				const header = document.createElement("header");
				const author = document.createElement("strong");
				author.textContent = comment.author
					? `${comment.author.role} · ${comment.author.principalId.slice(0, 8)}`
					: "Former member";
				const time = document.createElement("time");
				time.dateTime = comment.createdAt.toISOString();
				time.textContent = dateTime(comment.createdAt);
				const body = document.createElement("p");
				body.textContent = comment.body;
				header.append(author, time);
				content.append(header, body);
				item.append(avatar, content);
				return item;
			}),
		);
	}

	function renderLabels(page: LabelPage): void {
		element<HTMLElement>("[data-labels]").replaceChildren(
			...page.nodes.map((label) => {
				const chip = document.createElement("span");
				chip.className = "label-chip";
				chip.textContent = label.name;
				chip.style.setProperty("--label-color", label.color);
				return chip;
			}),
		);
	}

	function renderDetail(ticket: TicketDetail): void {
		selected = ticket;
		detailEmpty.hidden = true;
		detailContent.hidden = false;
		element<HTMLElement>("[data-detail-reference]").textContent =
			ticket.reference;
		element<HTMLElement>("[data-detail-summary]").textContent = ticket.summary;
		const status = element<HTMLElement>("[data-detail-status]");
		status.textContent = ticket.status;
		status.dataset.status = ticket.status;
		element<HTMLElement>("[data-detail-description]").textContent =
			ticket.description;
		const meta = element<HTMLElement>("[data-detail-meta]");
		meta.replaceChildren();
		for (const [label, value] of [
			["Priority", ticket.priority],
			["Team", ticket.team?.name ?? "Unrouted"],
			[
				"Requester",
				ticket.requester
					? `${ticket.requester.role} · ${ticket.requester.principalId.slice(0, 8)}`
					: "Unknown",
			],
			[
				"Assignee",
				ticket.assignee
					? `${ticket.assignee.role} · ${ticket.assignee.principalId.slice(0, 8)}`
					: "Unassigned",
			],
			["Updated", dateTime(ticket.updatedAt)],
		] as const) {
			const fact = document.createElement("span");
			const strong = document.createElement("strong");
			strong.textContent = `${label}: `;
			fact.append(strong, value);
			meta.append(fact);
		}
		transitionButton.textContent =
			ticket.status === "closed" ? "Reopen" : "Close ticket";
		transitionButton.dataset.transition =
			ticket.status === "closed" ? "reopen" : "close";
		assignButton.textContent =
			ticket.assignee?.id === session.membershipId
				? "Assigned to me"
				: "Assign to me";
		assignButton.disabled = ticket.assignee?.id === session.membershipId;
		for (const button of ticketList.querySelectorAll<HTMLButtonElement>(
			"[data-ticket-id]",
		))
			button.setAttribute(
				"aria-current",
				String(button.dataset.ticketId === ticket.id),
			);
	}

	async function selectTicket(ticketId: string): Promise<void> {
		const request = ++detailRequest;
		detailEmpty.hidden = false;
		detailContent.hidden = true;
		detailEmpty.querySelector("h2")!.textContent = "Loading ticket…";
		detailEmpty.querySelector("p")!.textContent =
			"Fetching details and activity.";
		try {
			const [ticket, comments, labels] = await Promise.all([
				desk.queries["tickets.detail"]({ id: ticketId }),
				desk.queries["comments.page"]({ after: null, first: 50, ticketId }),
				desk.queries["labels.page"]({ after: null, first: 50, ticketId }),
			]);
			if (request !== detailRequest) return;
			renderDetail(ticket);
			renderComments(comments);
			renderLabels(labels);
			setActionStatus("");
			setBusy(false);
			await report({
				phase: "ticket-selected",
				ticketId,
				reference: ticket.reference,
			});
		} catch (error) {
			if (request !== detailRequest) return;
			selected = null;
			detailEmpty.hidden = false;
			detailContent.hidden = true;
			detailEmpty.querySelector("h2")!.textContent = "Ticket unavailable";
			detailEmpty.querySelector("p")!.textContent = message(error);
		}
	}

	async function mutate(
		label: string,
		operation: () => Promise<unknown>,
	): Promise<void> {
		if (!selected || busy) return;
		setBusy(true);
		setActionStatus(`${label}…`);
		try {
			await operation();
			await Promise.all([selectTicket(selected.id), loadQueue()]);
			setActionStatus(`${label} complete.`);
		} catch (error) {
			setActionStatus(`${label} failed: ${message(error)}.`, "error");
		} finally {
			setBusy(false);
		}
	}

	statusFilter.addEventListener("change", () => void loadQueue(true));
	teamFilter.addEventListener("change", () => void loadQueue(true));
	previousButton.addEventListener("click", () => {
		if (pageIndex === 0) return;
		pageIndex -= 1;
		void loadQueue();
	});
	nextButton.addEventListener("click", () => {
		const cursor = currentPage?.pageInfo.endCursor;
		if (!currentPage?.pageInfo.hasNextPage || cursor === null) return;
		pageIndex += 1;
		cursors[pageIndex] = cursor;
		void loadQueue();
	});

	element<HTMLFormElement>("[data-search-form]").addEventListener(
		"submit",
		(event) => {
			event.preventDefault();
			const data = new FormData(event.currentTarget);
			const reference = String(data.get("reference") ?? "").trim();
			if (!reference) return;
			queueState.textContent = `Finding ${reference}…`;
			void desk.queries["tickets.searchByReference"]({ reference }).then(
				(ticket) => {
					if (ticket === null) {
						queueState.textContent = `No ticket has reference ${reference}.`;
						return;
					}
					queueState.textContent = `Found ${ticket.reference}.`;
					void selectTicket(ticket.id);
				},
				(error: unknown) => {
					queueState.dataset.kind = "error";
					queueState.textContent = `Search failed: ${message(error)}.`;
				},
			);
		},
	);

	element<HTMLButtonElement>("[data-create-open]").addEventListener(
		"click",
		() => {
			createForm.reset();
			element<HTMLElement>("[data-create-error]").textContent = "";
			createDialog.showModal();
		},
	);
	createForm.addEventListener("submit", (event) => {
		event.preventDefault();
		if (busy) return;
		const data = new FormData(createForm);
		setBusy(true);
		void desk.mutations["ticket.create"](
			{
				description: String(data.get("description")),
				priority: String(data.get("priority")),
				reference: String(data.get("reference")),
				summary: String(data.get("summary")),
				teamId: String(data.get("teamId")),
			},
			{ callId: `browser:create:${crypto.randomUUID()}` },
		)
			.then(
				async (ticket) => {
					createDialog.close();
					await loadQueue(true);
					await selectTicket(ticket.id);
				},
				(error: unknown) => {
					element<HTMLElement>("[data-create-error]").textContent =
						message(error);
				},
			)
			.finally(() => setBusy(false));
	});

	editButton.addEventListener("click", () => {
		if (!selected) return;
		const fields = editForm.elements as typeof editForm.elements & {
			description: HTMLTextAreaElement;
			priority: HTMLSelectElement;
			summary: HTMLInputElement;
		};
		fields.summary.value = selected.summary;
		fields.description.value = selected.description;
		fields.priority.value = selected.priority;
		element<HTMLElement>("[data-edit-error]").textContent = "";
		editDialog.showModal();
	});
	editForm.addEventListener("submit", (event) => {
		event.preventDefault();
		if (!selected || busy) return;
		const ticketId = selected.id;
		const data = new FormData(editForm);
		setBusy(true);
		void desk.mutations["ticket.edit"](
			{
				description: String(data.get("description")),
				priority: String(data.get("priority")),
				summary: String(data.get("summary")),
				ticketId,
			},
			{ callId: `browser:edit:${crypto.randomUUID()}` },
		)
			.then(
				async () => {
					editDialog.close();
					await Promise.all([selectTicket(ticketId), loadQueue()]);
				},
				(error: unknown) => {
					element<HTMLElement>("[data-edit-error]").textContent =
						message(error);
				},
			)
			.finally(() => setBusy(false));
	});

	element<HTMLFormElement>("[data-comment-form]").addEventListener(
		"submit",
		(event) => {
			event.preventDefault();
			if (!selected || busy) return;
			const form = event.currentTarget;
			const body = String(new FormData(form).get("body") ?? "").trim();
			if (!body) return;
			void mutate("Adding comment", () =>
				desk.mutations["ticket.addComment"](
					{ body, ticketId: selected!.id },
					{ callId: `browser:comment:${crypto.randomUUID()}` },
				),
			).then(() => form.reset());
		},
	);
	assignButton.addEventListener(
		"click",
		() =>
			void mutate("Assigning ticket", () =>
				desk.mutations["ticket.assign"](
					{
						assigneeMembershipId: session.membershipId,
						ticketId: selected!.id,
					},
					{ callId: `browser:assign:${crypto.randomUUID()}` },
				),
			),
	);
	transitionButton.addEventListener("click", () => {
		if (!selected) return;
		const close = selected.status !== "closed";
		void mutate(close ? "Closing ticket" : "Reopening ticket", () =>
			desk.mutations[close ? "ticket.close" : "ticket.reopen"](
				{ ticketId: selected!.id },
				{
					callId: `browser:${close ? "close" : "reopen"}:${crypto.randomUUID()}`,
				},
			),
		);
	});
	summaryButton.addEventListener("click", () => {
		if (!selected || busy) return;
		const effectKey = `browser:summary:${selected.reference}:${crypto.randomUUID()}`;
		void mutate("Sending summary", async () => {
			const result = await desk.actions["notification.sendTicketSummary"](
				{ ticketId: selected!.id },
				{ effectKey, timeoutMilliseconds: 3_000 },
			);
			setActionStatus(`Summary sent · ${result.providerReceipt}`);
			await report({
				effectId: result.effectId,
				effectKey,
				phase: "summary-sent",
				receipt: result.providerReceipt,
				ticketReference: result.ticketReference,
			});
		});
	});

	teams = (
		await desk.queries["teams.list"]({
			after: null,
			first: 100,
			organizationId: session.organizationId,
		})
	).nodes;
	for (const target of [teamFilter, createTeam]) {
		for (const team of teams) {
			const option = document.createElement("option");
			option.value = team.id;
			option.textContent = team.name;
			target.append(option);
		}
	}
	await loadQueue();
	await report({ phase: "desk-ready", role: session.role });

	const tracerReference = new URL(location.href).searchParams.get(
		"tracerReference",
	);
	if (tracerReference !== null) {
		const searchForm = element<HTMLFormElement>("[data-search-form]");
		searchForm.querySelector<HTMLInputElement>("input")!.value =
			tracerReference;
		searchForm.requestSubmit();
		await until(
			() => selected?.reference === tracerReference,
			"Firefox exact-reference search",
		);
		const commentBody =
			new URL(location.href).searchParams.get("tracerComment") ??
			`Firefox update ${crypto.randomUUID()}`;
		const commentForm = element<HTMLFormElement>("[data-comment-form]");
		commentForm.querySelector<HTMLTextAreaElement>("textarea")!.value =
			commentBody;
		commentForm.requestSubmit();
		await until(
			() => actionStatus.textContent?.includes("complete") === true && !busy,
			"Firefox comment Mutation",
		);
		summaryButton.click();
		await until(
			() => actionStatus.textContent?.includes("complete") === true && !busy,
			"Firefox summary Action",
		);
		if (selected?.status === "closed") {
			transitionButton.click();
			await until(
				() => selected?.status !== "closed" && !busy,
				"Firefox reopen Mutation",
			);
		}
		transitionButton.click();
		await until(
			() => selected?.status === "closed" && !busy,
			"Firefox close Mutation",
		);
		transitionButton.click();
		await until(
			() => selected?.status !== "closed" && !busy,
			"Firefox second reopen Mutation",
		);
		statusFilter.value = "open";
		statusFilter.dispatchEvent(new Event("change"));
		teamFilter.value = selected!.teamId;
		teamFilter.dispatchEvent(new Event("change"));
		await until(
			() => ticketList.ariaBusy === "false",
			"Firefox combined queue filter",
		);
		await report({
			commentBody,
			phase: "firefox-complete",
			reference: tracerReference,
			role: session.role,
		});
	}
}

void start().catch((error: unknown) => {
	const state = element<HTMLElement>("[data-queue-state]");
	state.dataset.kind = "error";
	state.textContent = `Desk unavailable: ${message(error)}.`;
	void report({ error: message(error), phase: "desk-error" });
});
