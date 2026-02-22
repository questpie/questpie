import { LoginPage } from "@questpie/admin/client";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/login")({
	component: AdminLoginPage,
});

function AdminLoginPage() {
	return (
		<LoginPage
			title="Welcome back"
			description="Sign in to access admin panel"
			showForgotPassword={false}
			showSignUp={false}
		/>
	);
}
