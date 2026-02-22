import { AdminRouter } from "@questpie/admin/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

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
