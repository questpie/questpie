import { useQueryClient } from "@tanstack/react-query";

import {
	selectClient,
	useAdminStore,
	type AdminShellRailProps,
} from "@questpie/admin/client";

import { AutopilotWorkRailCore } from "./autopilot-work-rail-core";

export default function AutopilotWorkRail({
	activeRoute,
}: AdminShellRailProps) {
	const client = useAdminStore(selectClient);
	const queryClient = useQueryClient();

	return (
		<AutopilotWorkRailCore
			activeRoute={activeRoute}
			client={client}
			queryClient={queryClient}
		/>
	);
}
