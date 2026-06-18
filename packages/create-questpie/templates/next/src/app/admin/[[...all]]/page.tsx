"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";

import { AdminRouter, LoginPage } from "@questpie/admin/client";

export default function AdminCatchAll() {
	const router = useRouter();
	const params = useParams<{ all?: string[] }>();
	const segments = params.all ?? [];

	const navigate = useCallback(
		(path: string) => {
			router.push(path);
		},
		[router],
	);

	if (segments[0] === "login") {
		return (
			<LoginPage
				title="Welcome back"
				description="Sign in to access admin panel"
				showForgotPassword={false}
				showSignUp={false}
			/>
		);
	}

	return (
		<AdminRouter segments={segments} navigate={navigate} basePath="/admin" />
	);
}
