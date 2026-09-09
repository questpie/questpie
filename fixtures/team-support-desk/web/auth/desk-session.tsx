import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { DeskApplication } from "../app";
import { createSupportDeskOwner } from "../questpie";
import type { SupportSession } from "./client";

type DeskSessionProps = Readonly<{
	session: SupportSession;
	onSignOut: () => Promise<void>;
}>;

/** The parent keys this subtree by credential lifetime and Context, not Principal alone. */
export function DeskSession({ session, onSignOut }: DeskSessionProps) {
	const [owner, setOwner] =
		useState<ReturnType<typeof createSupportDeskOwner>>();
	const { membershipId, organizationId } = session;
	useEffect(() => {
		// Effect setup gets a fresh owner even during StrictMode's setup/cleanup rehearsal.
		const current = createSupportDeskOwner({ membershipId, organizationId });
		setOwner(current);
		return () => {
			void current.api
				.dispose()
				.finally(() => current.cache.clear())
				.catch(() => {
					console.error("Support Desk scope cleanup failed");
				});
		};
	}, [membershipId, organizationId]);
	if (!owner) return <p role="status">Opening support workspace…</p>;
	return (
		<QueryClientProvider client={owner.cache}>
			<DeskApplication
				desk={owner.desk}
				api={owner.api}
				session={session}
				onSignOut={onSignOut}
			/>
		</QueryClientProvider>
	);
}
