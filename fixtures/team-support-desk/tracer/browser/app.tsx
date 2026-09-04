import { useQueryResource } from "questpie/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SupportSession } from "./auth/client";
import { reportFixturePhase } from "./fixture-control";
import type { SupportDesk } from "./questpie";
import { errorMessage } from "./shared/format";
import { CreateTicketDialog } from "./tickets/dialogs";
import { TicketQueue } from "./tickets/queue";
import { SelectedTicket } from "./tickets/selected";
import { firefoxJourneyFromUrl, runFirefoxJourney } from "./tracer/journey";

type DeskApplicationProps = Readonly<{
	desk: SupportDesk;
	onSignOut: () => Promise<void>;
	session: SupportSession;
}>;

type JourneyTicket = Readonly<{
	id: string;
	reference: string;
	status: string;
	teamId: string;
	updatedAt: Date;
}>;

export function DeskApplication({
	desk,
	onSignOut,
	session,
}: DeskApplicationProps) {
	const [pageIndex, setPageIndex] = useState(0);
	const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
	const [statusFilter, setStatusFilter] = useState("");
	const [teamFilter, setTeamFilter] = useState("");
	const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState("");
	const createDialog = useRef<HTMLDialogElement>(null);
	const readyReported = useRef(false);
	const failureReported = useRef(false);
	const tracerStarted = useRef(false);
	const after = cursors[pageIndex] ?? null;

	const queueResource = desk.queries["tickets.queue"].observe({
		after,
		first: 8,
		statuses: statusFilter ? [statusFilter] : null,
		teamIds: teamFilter ? [teamFilter] : null,
	});
	const queueSnapshot = useQueryResource(queueResource);
	const teamsResource = desk.queries["teams.list"].observe({
		after: null,
		first: 100,
		organizationId: session.organizationId,
	});
	const teamsSnapshot = useQueryResource(teamsResource);
	const page = queueSnapshot.kind === "ready" ? queueSnapshot.value : null;
	const teams = teamsSnapshot.kind === "ready" ? teamsSnapshot.value.nodes : [];
	const queueKind =
		queueSnapshot.kind === "failed"
			? "failed"
			: queueSnapshot.connection.kind === "reconnecting"
				? "reconnecting"
				: queueSnapshot.kind === "pending"
					? "pending"
					: queueSnapshot.delivery.kind === "reset"
						? "reset"
						: "ready";
	const queueMessage =
		queueSnapshot.kind === "failed"
			? `Live queue unavailable (${queueSnapshot.failure.code}).`
			: queueSnapshot.kind === "pending"
				? queueSnapshot.connection.kind === "reconnecting"
					? `Reconnecting to the live queue (attempt ${queueSnapshot.connection.attempt})…`
					: "Loading live queue…"
				: queueSnapshot.connection.kind === "reconnecting"
					? `Reconnecting while retaining ${queueSnapshot.value.nodes.length} authorized ticket${queueSnapshot.value.nodes.length === 1 ? "" : "s"}…`
					: queueSnapshot.delivery.kind === "reset"
						? `Queue replaced after ${queueSnapshot.delivery.reason.replaceAll("-", " ")}.`
						: queueSnapshot.value.nodes.length === 0
							? "No tickets match these filters."
							: `${queueSnapshot.value.nodes.length} ticket${queueSnapshot.value.nodes.length === 1 ? "" : "s"} on this page`;
	const initiallyReady =
		queueSnapshot.kind === "ready" && teamsSnapshot.kind === "ready";

	useEffect(() => {
		if (!initiallyReady || readyReported.current) return;
		readyReported.current = true;
		void reportFixturePhase({ phase: "desk-ready", role: session.role });
	}, [initiallyReady, session.role]);

	useEffect(() => {
		const failed = [queueSnapshot, teamsSnapshot].find(
			(snapshot) => snapshot.kind === "failed",
		);
		if (!failed || failureReported.current) return;
		failureReported.current = true;
		void reportFixturePhase({
			error: failed.failure.code,
			phase: "desk-error",
		});
	}, [queueSnapshot, teamsSnapshot]);

	const searchTicket = useCallback(
		async (reference: string): Promise<JourneyTicket | null> => {
			const match = await desk.queries["tickets.searchByReference"]({
				reference,
			});
			if (match !== null) setSelectedTicketId(match.id);
			return match;
		},
		[desk],
	);

	const executeTicketOperation = useCallback(
		async <Output,>(
			_label: string,
			operation: () => Promise<Output>,
		): Promise<Output> => operation(),
		[],
	);

	useEffect(() => {
		const journey = firefoxJourneyFromUrl(location.href);
		if (!initiallyReady || journey === null || tracerStarted.current) return;
		tracerStarted.current = true;
		void runFirefoxJourney({
			...journey,
			desk,
			executeTicketOperation,
			loadFilteredQueue: (status, teamId) =>
				desk.queries["tickets.queue"]({
					after: null,
					first: 8,
					statuses: status ? [status] : null,
					teamIds: teamId ? [teamId] : null,
				}),
			role: session.role,
			searchTicket,
			selectFilters: (status, teamId) => {
				setStatusFilter(status);
				setTeamFilter(teamId);
				setCursors([null]);
				setPageIndex(0);
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
		initiallyReady,
		searchTicket,
		session.role,
	]);

	function changeFilters(status: string, teamId: string): void {
		setStatusFilter(status);
		setTeamFilter(teamId);
		setCursors([null]);
		setPageIndex(0);
	}

	function nextPage(): void {
		const nextAfter = page?.pageInfo.endCursor;
		if (!page?.pageInfo.hasNextPage || !nextAfter) return;
		const index = pageIndex + 1;
		setCursors((current) => {
			const next = [...current];
			next[index] = nextAfter;
			return next;
		});
		setPageIndex(index);
	}

	function previousPage(): void {
		if (pageIndex === 0) return;
		setPageIndex((current) => current - 1);
	}

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
					busy={creating}
					onCreate={() => {
						setCreateError("");
						createDialog.current?.showModal();
					}}
					onNext={nextPage}
					onPrevious={previousPage}
					onSearch={(reference) =>
						void searchTicket(reference).catch(() => undefined)
					}
					onSelect={setSelectedTicketId}
					onStatusFilter={(status) => changeFilters(status, teamFilter)}
					onTeamFilter={(teamId) => changeFilters(statusFilter, teamId)}
					page={page}
					pageIndex={pageIndex}
					queueKind={queueKind}
					queueMessage={queueMessage}
					selectedTicketId={selectedTicketId}
					statusFilter={statusFilter}
					teamFilter={teamFilter}
					teams={teams}
				/>
				{selectedTicketId === null ? (
					<section className="detail" aria-labelledby="detail-heading">
						<div className="detail-empty">
							<span className="empty-glyph" aria-hidden="true">
								↗
							</span>
							<h2 id="detail-heading">Choose a ticket</h2>
							<p>
								Select an item from the queue to see its conversation and
								available actions.
							</p>
						</div>
					</section>
				) : (
					<SelectedTicket
						desk={desk}
						key={selectedTicketId}
						session={session}
						ticketId={selectedTicketId}
					/>
				)}
			</main>

			<CreateTicketDialog
				busy={creating}
				dialogRef={createDialog}
				error={createError}
				onSubmit={(data) => {
					setCreating(true);
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
						.then((created) => {
							createDialog.current?.close();
							createDialog.current?.querySelector("form")?.reset();
							setCursors([null]);
							setPageIndex(0);
							setSelectedTicketId(created.id);
						})
						.catch((error: unknown) => setCreateError(errorMessage(error)))
						.finally(() => setCreating(false));
				}}
				teams={teams}
			/>
		</>
	);
}
