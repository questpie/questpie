import { useCallback, useEffect, useRef, useState } from "react";

import type { SupportSession } from "./auth/client";
import { reportFixturePhase } from "./fixture-control";
import type {
	CommentPage,
	LabelPage,
	SupportDesk,
	TeamPage,
	TicketDetail,
	TicketPage,
} from "./questpie";
import { errorMessage } from "./shared/format";
import { TicketDetailPanel } from "./tickets/detail";
import { CreateTicketDialog, EditTicketDialog } from "./tickets/dialogs";
import { ticketEditInput } from "./tickets/edit-input";
import { TicketQueue } from "./tickets/queue";
import { firefoxJourneyFromUrl, runFirefoxJourney } from "./tracer/journey";

type DetailState = Readonly<{
	comments: CommentPage;
	labels: LabelPage;
	ticket: TicketDetail;
}>;

type DeskApplicationProps = Readonly<{
	desk: SupportDesk;
	onSignOut: () => Promise<void>;
	session: SupportSession;
}>;

export function DeskApplication({
	desk,
	onSignOut,
	session,
}: DeskApplicationProps) {
	const [page, setPage] = useState<TicketPage | null>(null);
	const [pageIndex, setPageIndex] = useState(0);
	const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
	const [statusFilter, setStatusFilter] = useState("");
	const [teamFilter, setTeamFilter] = useState("");
	const [teams, setTeams] = useState<TeamPage["nodes"]>([]);
	const [detail, setDetail] = useState<DetailState | null>(null);
	const [detailTitle, setDetailTitle] = useState("Choose a ticket");
	const [detailMessage, setDetailMessage] = useState(
		"Select an item from the queue to see its conversation and available actions.",
	);
	const [queueKind, setQueueKind] = useState<"loading" | "ready" | "error">(
		"loading",
	);
	const [queueMessage, setQueueMessage] = useState("Loading queue…");
	const [busy, setBusy] = useState(false);
	const [actionStatus, setActionStatus] = useState("");
	const [actionKind, setActionKind] = useState<"ok" | "error">("ok");
	const [createError, setCreateError] = useState("");
	const [editError, setEditError] = useState("");
	const [ready, setReady] = useState(false);
	const createDialog = useRef<HTMLDialogElement>(null);
	const editDialog = useRef<HTMLDialogElement>(null);
	const queueRequest = useRef(0);
	const detailRequest = useRef(0);
	const tracerStarted = useRef(false);
	const filterSnapshot = useRef({ status: "", teamId: "" });
	const pageSnapshot = useRef({ after: null as string | null, index: 0 });

	const loadQueue = useCallback(
		async (
			status: string,
			teamId: string,
			after: string | null,
			index: number,
		): Promise<TicketPage> => {
			const request = ++queueRequest.current;
			setQueueKind("loading");
			setQueueMessage("Loading queue…");
			try {
				const input = { after, first: 8 } as const;
				const nextPage =
					status && teamId
						? await desk.queries["tickets.listByStatusAndTeam"]({
								...input,
								status,
								teamId,
							})
						: status
							? await desk.queries["tickets.listByStatus"]({
									...input,
									status,
								})
							: teamId
								? await desk.queries["tickets.listByTeam"]({
										...input,
										teamId,
									})
								: await desk.queries["tickets.list"](input);
				if (request === queueRequest.current) {
					setPage(nextPage);
					setPageIndex(index);
					filterSnapshot.current = { status, teamId };
					pageSnapshot.current = { after, index };
					setQueueKind("ready");
					setQueueMessage(
						nextPage.nodes.length === 0
							? "No tickets match these filters."
							: `${nextPage.nodes.length} ticket${nextPage.nodes.length === 1 ? "" : "s"} on this page`,
					);
				}
				return nextPage;
			} catch (error) {
				if (request === queueRequest.current) {
					setPage(null);
					setQueueKind("error");
					setQueueMessage(`Queue error: ${errorMessage(error)}.`);
				}
				throw error;
			}
		},
		[desk],
	);

	const selectTicket = useCallback(
		async (ticketId: string): Promise<TicketDetail | null> => {
			const request = ++detailRequest.current;
			setDetail(null);
			setDetailTitle("Loading ticket…");
			setDetailMessage("Fetching details and activity.");
			try {
				const [ticket, comments, labels] = await Promise.all([
					desk.queries["tickets.detail"]({ id: ticketId }),
					desk.queries["comments.page"]({ after: null, first: 50, ticketId }),
					desk.queries["labels.page"]({ after: null, first: 50, ticketId }),
				]);
				if (request !== detailRequest.current) return ticket;
				if (ticket === null) {
					setDetailTitle("Ticket unavailable");
					setDetailMessage(
						"The ticket no longer exists or is outside your access.",
					);
					return null;
				}
				setDetail({ comments, labels, ticket });
				setActionStatus("");
				setActionKind("ok");
				await reportFixturePhase({
					phase: "ticket-selected",
					reference: ticket.reference,
					ticketId,
				});
				return ticket;
			} catch (error) {
				if (request === detailRequest.current) {
					setDetail(null);
					setDetailTitle("Ticket unavailable");
					setDetailMessage(errorMessage(error));
				}
				throw error;
			}
		},
		[desk],
	);

	const refreshCurrentQueue = useCallback(async (): Promise<void> => {
		const { status, teamId } = filterSnapshot.current;
		const { after, index } = pageSnapshot.current;
		await loadQueue(status, teamId, after, index);
	}, [loadQueue]);

	const executeTicketOperation = useCallback(
		async (
			label: string,
			ticketId: string,
			operation: () => Promise<unknown>,
		): Promise<TicketDetail> => {
			setBusy(true);
			setActionKind("ok");
			setActionStatus(`${label}…`);
			try {
				await operation();
				const [ticket] = await Promise.all([
					selectTicket(ticketId),
					refreshCurrentQueue(),
				]);
				if (ticket === null)
					throw new Error("ticket unavailable after mutation");
				setActionStatus(`${label} complete.`);
				return ticket;
			} catch (error) {
				setActionKind("error");
				setActionStatus(`${label} failed: ${errorMessage(error)}.`);
				throw error;
			} finally {
				setBusy(false);
			}
		},
		[refreshCurrentQueue, selectTicket],
	);

	const searchTicket = useCallback(
		async (reference: string): Promise<TicketDetail | null> => {
			setQueueKind("loading");
			setQueueMessage(`Finding ${reference}…`);
			try {
				const match = await desk.queries["tickets.searchByReference"]({
					reference,
				});
				if (match === null) {
					setQueueKind("ready");
					setQueueMessage(`No ticket has reference ${reference}.`);
					return null;
				}
				setQueueKind("ready");
				setQueueMessage(`Found ${match.reference}.`);
				return selectTicket(match.id);
			} catch (error) {
				setQueueKind("error");
				setQueueMessage(`Search failed: ${errorMessage(error)}.`);
				throw error;
			}
		},
		[desk, selectTicket],
	);

	useEffect(() => {
		void Promise.all([
			desk.queries["teams.list"]({
				after: null,
				first: 100,
				organizationId: session.organizationId,
			}),
			loadQueue("", "", null, 0),
		])
			.then(async ([teamPage]) => {
				setTeams(teamPage.nodes);
				setReady(true);
				await reportFixturePhase({ phase: "desk-ready", role: session.role });
			})
			.catch(async (error: unknown) => {
				await reportFixturePhase({
					error: errorMessage(error),
					phase: "desk-error",
				});
			});
	}, [desk, loadQueue, session.organizationId, session.role]);

	useEffect(() => {
		const journey = firefoxJourneyFromUrl(location.href);
		if (!ready || journey === null || tracerStarted.current) return;
		tracerStarted.current = true;
		void runFirefoxJourney({
			...journey,
			desk,
			executeTicketOperation,
			loadFilteredQueue: (status, teamId) => loadQueue(status, teamId, null, 0),
			role: session.role,
			searchTicket,
			selectFilters: (status, teamId) => {
				setStatusFilter(status);
				setTeamFilter(teamId);
				setCursors([null]);
			},
		}).catch(async (error: unknown) => {
			await reportFixturePhase({
				error: errorMessage(error),
				phase: "desk-error",
			});
		});
	}, [
		desk,
		executeTicketOperation,
		loadQueue,
		ready,
		searchTicket,
		session.role,
	]);

	function changeFilters(status: string, teamId: string): void {
		setStatusFilter(status);
		setTeamFilter(teamId);
		setCursors([null]);
		void loadQueue(status, teamId, null, 0).catch(() => undefined);
	}

	function nextPage(): void {
		const after = page?.pageInfo.endCursor;
		if (!page?.pageInfo.hasNextPage || !after) return;
		const index = pageIndex + 1;
		setCursors((current) => {
			const next = [...current];
			next[index] = after;
			return next;
		});
		void loadQueue(statusFilter, teamFilter, after, index).catch(
			() => undefined,
		);
	}

	function previousPage(): void {
		if (pageIndex === 0) return;
		const index = pageIndex - 1;
		void loadQueue(
			statusFilter,
			teamFilter,
			cursors[index] ?? null,
			index,
		).catch(() => undefined);
	}

	const ticket = detail?.ticket ?? null;
	return (
		<>
			<header className="topbar">
				<a className="brand" href="/" aria-label="Team Support Desk home">
					<span className="brand-mark" aria-hidden="true">
						Q
					</span>
					<span>
						<strong>Support Desk</strong>
						<small>Team operations</small>
					</span>
				</a>
				<div className="session" aria-label="Signed-in persona">
					<span className="presence" aria-hidden="true" />
					<span>
						<small>Signed in as</small>
						<strong>
							{session.label} · {session.role}
						</strong>
					</span>
					<button
						className="sign-out"
						onClick={() => void onSignOut()}
						type="button"
					>
						Sign out
					</button>
				</div>
			</header>

			<main className="workspace">
				<TicketQueue
					busy={busy}
					onCreate={() => {
						setCreateError("");
						createDialog.current?.showModal();
					}}
					onNext={nextPage}
					onPrevious={previousPage}
					onSearch={(reference) =>
						void searchTicket(reference).catch(() => undefined)
					}
					onSelect={(ticketId) =>
						void selectTicket(ticketId).catch(() => undefined)
					}
					onStatusFilter={(status) => changeFilters(status, teamFilter)}
					onTeamFilter={(teamId) => changeFilters(statusFilter, teamId)}
					page={page}
					pageIndex={pageIndex}
					queueKind={queueKind}
					queueMessage={queueMessage}
					selectedTicketId={ticket?.id ?? null}
					statusFilter={statusFilter}
					teamFilter={teamFilter}
					teams={teams}
				/>
				<TicketDetailPanel
					actionKind={actionKind}
					actionStatus={actionStatus}
					busy={busy}
					comments={detail?.comments ?? null}
					detailMessage={detailMessage}
					detailTitle={detailTitle}
					labels={detail?.labels ?? null}
					onAssign={() => {
						if (!ticket) return;
						void executeTicketOperation("Assigning ticket", ticket.id, () =>
							desk.mutations["ticket.assign"](
								{
									assigneeMembershipId: session.membershipId,
									ticketId: ticket.id,
								},
								{ callId: `browser:assign:${crypto.randomUUID()}` },
							),
						).catch(() => undefined);
					}}
					onComment={(body, form) => {
						if (!ticket) return;
						void executeTicketOperation("Adding comment", ticket.id, () =>
							desk.mutations["ticket.addComment"](
								{ body, ticketId: ticket.id },
								{ callId: `browser:comment:${crypto.randomUUID()}` },
							),
						)
							.then(() => form.reset())
							.catch(() => undefined);
					}}
					onEdit={() => {
						setEditError("");
						editDialog.current?.showModal();
					}}
					onSummary={() => {
						if (!ticket) return;
						const effectKey = `browser:summary:${ticket.reference}:${crypto.randomUUID()}`;
						void executeTicketOperation(
							"Sending summary",
							ticket.id,
							async () => {
								const result = await desk.actions[
									"notification.sendTicketSummary"
								](
									{ ticketId: ticket.id },
									{ effectKey, timeoutMilliseconds: 3_000 },
								);
								await reportFixturePhase({
									effectId: result.effectId,
									effectKey,
									phase: "summary-sent",
									receipt: result.providerReceipt,
									ticketReference: result.ticketReference,
								});
							},
						).catch(() => undefined);
					}}
					onTransition={() => {
						if (!ticket) return;
						const close = ticket.status !== "closed";
						void executeTicketOperation(
							close ? "Closing ticket" : "Reopening ticket",
							ticket.id,
							() =>
								desk.mutations[close ? "ticket.close" : "ticket.reopen"](
									{ ticketId: ticket.id },
									{
										callId: `browser:${close ? "close" : "reopen"}:${crypto.randomUUID()}`,
									},
								),
						).catch(() => undefined);
					}}
					session={session}
					ticket={ticket}
				/>
			</main>

			<CreateTicketDialog
				busy={busy}
				dialogRef={createDialog}
				error={createError}
				onSubmit={(data) => {
					setBusy(true);
					setCreateError("");
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
						.then(async (created) => {
							createDialog.current?.close();
							createDialog.current?.querySelector("form")?.reset();
							setCursors([null]);
							await loadQueue(statusFilter, teamFilter, null, 0);
							await selectTicket(created.id);
						})
						.catch((error: unknown) => setCreateError(errorMessage(error)))
						.finally(() => setBusy(false));
				}}
				teams={teams}
			/>
			<EditTicketDialog
				busy={busy}
				dialogRef={editDialog}
				error={editError}
				onSubmit={(data) => {
					if (!ticket) return;
					setEditError("");
					void executeTicketOperation("Saving changes", ticket.id, () =>
						desk.mutations["ticket.edit"](
							ticketEditInput(session.role, data, ticket.id),
							{ callId: `browser:edit:${crypto.randomUUID()}` },
						),
					)
						.then(() => editDialog.current?.close())
						.catch((error: unknown) => setEditError(errorMessage(error)));
				}}
				role={session.role}
				ticket={ticket}
			/>
		</>
	);
}
