import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AdminRouter } from "@questpie/admin/client";

function AdminCatchAll() {
	const navigate = useNavigate();
	const params = Route.useParams();
	const splat = params._splat as string;
	const segments = splat ? splat.split("/").filter(Boolean) : [];

	return (
		<AdminRouter
			segments={segments}
			navigate={(path) => navigate({ to: path })}
			basePath="/admin"
		/>
	);
}

export const Route = createFileRoute("/admin/$")({
	component: AdminCatchAll,
});
