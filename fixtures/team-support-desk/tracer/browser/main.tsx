import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { DeskApplication } from "./app";
import {
	loadFixtureSession,
	reportFixturePhase,
	type FixtureSession,
} from "./fixture-control";
import { createSupportDesk } from "./questpie";
import { errorMessage } from "./shared/format";

function BrowserApplication() {
	const [session, setSession] = useState<FixtureSession | null>(null);
	const [failure, setFailure] = useState("");

	useEffect(() => {
		void loadFixtureSession().then(setSession, async (error: unknown) => {
			const message = errorMessage(error);
			setFailure(message);
			await reportFixturePhase({ error: message, phase: "desk-error" });
		});
	}, []);

	if (failure)
		return (
			<main className="bootstrap-error">
				<h1>Desk unavailable</h1>
				<p role="alert">{failure}.</p>
			</main>
		);
	if (session === null)
		return (
			<p className="bootstrap-state" role="status">
				Loading support desk…
			</p>
		);

	return (
		<DeskApplication
			desk={createSupportDesk({
				membershipId: session.membershipId,
				organizationId: session.organizationId,
			})}
			session={session}
		/>
	);
}

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement))
	throw new TypeError("Team Support Desk root is missing");
createRoot(root).render(<BrowserApplication />);
