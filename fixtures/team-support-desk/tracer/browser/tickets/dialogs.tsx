import type { FormEvent, RefObject } from "react";

import type { SupportSession } from "../auth/client";
import type { TeamPage, TicketDetail } from "../questpie";

type CreateDialogProps = Readonly<{
	busy: boolean;
	dialogRef: RefObject<HTMLDialogElement | null>;
	error: string;
	onSubmit: (data: FormData) => void;
	teams: TeamPage["nodes"];
}>;

export function CreateTicketDialog({
	busy,
	dialogRef,
	error,
	onSubmit,
	teams,
}: CreateDialogProps) {
	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		onSubmit(new FormData(event.currentTarget));
	}
	return (
		<dialog ref={dialogRef}>
			<form onSubmit={submit}>
				<header>
					<div>
						<p className="eyebrow">New request</p>
						<h2>Create ticket</h2>
					</div>
					<button
						className="icon-button"
						type="button"
						aria-label="Close create ticket dialog"
						onClick={() => dialogRef.current?.close()}
					>
						×
					</button>
				</header>
				<label>
					Reference
					<input
						name="reference"
						required
						maxLength={40}
						placeholder="SUP-1042"
					/>
				</label>
				<label>
					Summary
					<input name="summary" required maxLength={160} />
				</label>
				<label>
					Description
					<textarea name="description" required rows={5} maxLength={4_000} />
				</label>
				<div className="form-grid">
					<label>
						Priority
						<select name="priority">
							<option value="normal">Normal</option>
							<option value="high">High</option>
							<option value="urgent">Urgent</option>
						</select>
					</label>
					<label>
						Team
						<select name="teamId" required>
							{teams.map((team) => (
								<option key={team.id} value={team.id}>
									{team.name}
								</option>
							))}
						</select>
					</label>
				</div>
				<p className="form-error" role="alert">
					{error}
				</p>
				<footer>
					<button type="button" onClick={() => dialogRef.current?.close()}>
						Cancel
					</button>
					<button className="primary" type="submit" disabled={busy}>
						Create ticket
					</button>
				</footer>
			</form>
		</dialog>
	);
}

type EditDialogProps = Readonly<{
	busy: boolean;
	dialogRef: RefObject<HTMLDialogElement | null>;
	error: string;
	onSubmit: (data: FormData) => void;
	role: SupportSession["role"];
	ticket: TicketDetail | null;
}>;

export function EditTicketDialog({
	busy,
	dialogRef,
	error,
	onSubmit,
	role,
	ticket,
}: EditDialogProps) {
	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		onSubmit(new FormData(event.currentTarget));
	}
	return (
		<dialog ref={dialogRef}>
			<form key={ticket?.id} onSubmit={submit}>
				<header>
					<div>
						<p className="eyebrow">Ticket details</p>
						<h2>Edit ticket</h2>
					</div>
					<button
						className="icon-button"
						type="button"
						aria-label="Close edit ticket dialog"
						onClick={() => dialogRef.current?.close()}
					>
						×
					</button>
				</header>
				<label>
					Summary
					<input
						name="summary"
						required
						maxLength={160}
						defaultValue={ticket?.summary}
					/>
				</label>
				<label>
					Description
					<textarea
						name="description"
						required
						rows={5}
						maxLength={4_000}
						defaultValue={ticket?.description}
					/>
				</label>
				{role === "customer" ? null : (
					<label>
						Priority
						<select name="priority" defaultValue={ticket?.priority}>
							<option value="normal">Normal</option>
							<option value="high">High</option>
							<option value="urgent">Urgent</option>
						</select>
					</label>
				)}
				<p className="form-error" role="alert">
					{error}
				</p>
				<footer>
					<button type="button" onClick={() => dialogRef.current?.close()}>
						Cancel
					</button>
					<button className="primary" type="submit" disabled={busy}>
						Save changes
					</button>
				</footer>
			</form>
		</dialog>
	);
}
