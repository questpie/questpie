/**
 * Auth Layout - centered card layout for authentication pages
 */

import type * as React from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../components/ui/card";
import { cn } from "../../lib/utils";

type AuthLayoutProps = {
	/** Page title */
	title: string;
	/** Page description */
	description?: string;
	/** Logo component or element */
	logo?: React.ReactNode;
	/** Footer content (e.g., links to other auth pages) */
	footer?: React.ReactNode;
	/** Form content */
	children: React.ReactNode;
	/** Additional class name for the card */
	className?: string;
};

/**
 * Centered layout for authentication pages (login, register, forgot password, etc.)
 *
 * @example
 * ```tsx
 * <AuthLayout
 *   title="Sign in"
 *   description="Enter your credentials to access the admin panel"
 *   logo={<Logo />}
 *   footer={<Link to="/forgot-password">Forgot password?</Link>}
 * >
 *   <LoginForm />
 * </AuthLayout>
 * ```
 */
export function AuthLayout({
	title,
	description,
	logo,
	footer,
	children,
	className,
}: AuthLayoutProps) {
	return (
		<div className="bg-background flex min-h-screen flex-col items-center justify-center p-4">
			<div className="w-full max-w-sm space-y-6">
				{/* Logo */}
				{logo && <div className="flex justify-center">{logo}</div>}

				{/* Main Card */}
				<Card className={cn("w-full", className)}>
					<CardHeader className="text-center">
						<CardTitle className="text-lg">{title}</CardTitle>
						{description && <CardDescription>{description}</CardDescription>}
					</CardHeader>
					<CardContent>{children}</CardContent>
				</Card>

				{/* Footer */}
				{footer && (
					<div className="text-muted-foreground text-center text-xs">
						{footer}
					</div>
				)}
			</div>
		</div>
	);
}
