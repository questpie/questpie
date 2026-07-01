/**
 * /admin/chat — full-page Autopilot chat (§4.7 mobile entrypoint).
 *
 * The desktop work rail is `hiddenOnMobile`; this page hosts the SAME
 * self-contained {@link AutopilotWorkRailCore} full-viewport so phones get
 * send + stream + cancel. Reached from the sidebar (which renders as a
 * sheet on mobile).
 */

import { useQueryClient } from "@tanstack/react-query";

import { page, selectClient, useAdminStore } from "@questpie/admin/client";

import { AutopilotWorkRailCore } from "../components/autopilot-work-rail-core";

function AutopilotChatPage() {
	const client = useAdminStore(selectClient);
	const queryClient = useQueryClient();

	return (
		<div className="mx-auto h-[calc(100dvh-6.5rem)] min-h-80 w-full max-w-3xl">
			<AutopilotWorkRailCore client={client} queryClient={queryClient} />
		</div>
	);
}

export default page("autopilot-chat", {
	path: "/chat",
	label: { en: "Chat" },
	component: AutopilotChatPage,
	showInNav: false,
});
