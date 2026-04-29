/**
 * Auth Layout - minimal shell for authentication pages
 *
 * Supports a file-first override via `questpie/admin/components/admin-auth-layout.tsx`.
 * When that component is registered in the admin-client registry under the reserved
 * key `adminAuthLayout`, it replaces the entire layout — all existing auth pages
 * using `AuthLayout` are automatically affected.
 *
 * Works without `AdminProvider`. When an AdminProvider is present, a registered
 * `adminAuthLayout` override can replace the built-in layout.
 */

import * as React from "react";

import type { MaybeLazyComponent } from "../../builder/types/common.js";
import { BrandLogoMark } from "../../components/brand-logo.js";
import { Card, CardContent } from "../../components/ui/card";
import { useBrand } from "../../hooks/use-brand.js";
import { cn } from "../../lib/utils";
import { useAdminStoreRaw } from "../../runtime/provider.js";
import { useLazyComponent } from "../../utils/use-lazy-component.js";
import {
	useHasManagedAdminTheme,
	useManagedAdminTheme,
} from "../layout/admin-theme";

/**
 * Props for the auth layout — and for any custom `adminAuthLayout` override.
 *
 * Export path: `@questpie/admin/client`
 */
export type AuthLayoutProps = {
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

function AuthBrandMark({ className }: { className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			className={cn("text-foreground size-16 shrink-0", className)}
			aria-hidden
		>
			<path
				d="M2 2H22V10"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="square"
			/>
			<path
				d="M2 2V22H10"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="square"
			/>
			<path d="M23 13H13V23H23V13Z" fill="currentColor" opacity="0.72" />
		</svg>
	);
}

export function AuthDefaultLogo({ brandName }: { brandName: string }) {
	return (
		<div className="qa-auth-layout__default-logo flex max-w-full min-w-0 items-center gap-3 text-left">
			<AuthBrandMark className="size-9" />
			<div className="min-w-0">
				<div className="text-foreground truncate text-sm font-semibold tracking-tight">
					{brandName}
				</div>
			</div>
		</div>
	);
}

function AuthLogo({
	logo,
	className,
}: {
	logo?: React.ReactNode;
	className?: string;
}) {
	const brand = useBrand();
	const resolved =
		logo ??
		(brand.logo ? (
			<div className="qa-auth-layout__default-logo flex max-w-full min-w-0 items-center gap-3 text-left">
				<BrandLogoMark
					logo={brand.logo}
					alt={brand.name}
					className="size-9"
				/>
				<div className="min-w-0">
					<div className="text-foreground truncate text-sm font-semibold tracking-tight">
						{brand.name}
					</div>
				</div>
			</div>
		) : (
			<AuthDefaultLogo brandName={brand.name} />
		));

	return (
		<div
			className={cn(
				"qa-auth-layout__logo flex min-w-0 items-center justify-start text-left",
				className,
			)}
		>
			{resolved}
		</div>
	);
}

/** Built-in minimal split layout (fallback when no override is registered). */
function AuthLayoutBuiltIn({
	logo,
	footer,
	children,
	className,
}: AuthLayoutProps) {
	const { tagline } = useBrand();
	return (
		<div className="qa-auth-layout bg-background text-foreground relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-8 sm:px-8">
			<div className="qa-auth-layout__shell grid w-full max-w-4xl items-center gap-10 lg:grid-cols-[minmax(220px,280px)_minmax(360px,384px)] lg:gap-16">
				<aside className="qa-auth-layout__brand flex flex-col items-center justify-center gap-8">
					<AuthLogo logo={logo} className="max-w-[calc(100vw-2.5rem)]" />
					{tagline && (
						<p className="qa-auth-layout__tagline text-muted-foreground hidden text-xs tracking-[0.14em] uppercase lg:block">
							{tagline}
						</p>
					)}
				</aside>

				<main className="qa-auth-layout__form-panel flex items-center justify-center">
					<div className="qa-auth-layout__content w-full max-w-sm space-y-5">
						<Card
							className={cn(
								"qa-auth-layout__card border-border-subtle w-full shadow-none",
								className,
							)}
						>
							<CardContent className="qa-auth-layout__card-content">
								{children}
							</CardContent>
						</Card>

						{footer && (
							<div className="qa-auth-layout__footer text-muted-foreground text-center text-xs">
								{footer}
							</div>
						)}
						{tagline && (
							<div className="qa-auth-layout__tagline qa-auth-layout__tagline--mobile text-muted-foreground text-center text-[11px] tracking-[0.14em] uppercase lg:hidden">
								{tagline}
							</div>
						)}
					</div>
				</main>
			</div>
		</div>
	);
}

/**
 * Minimal split layout for authentication pages (login, register, forgot password, etc.)
 *
 * Checks `adminAuthLayout` in the component registry (registered via
 * `questpie/admin/components/admin-auth-layout.tsx`) and renders it when present,
 * falling back to the built-in minimal split layout.
 *
 * Works without `<AdminProvider>` and falls back to the built-in layout.
 * When used inside `<AdminProvider>`, a registered `adminAuthLayout` override
 * can replace the built-in layout.
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
export function AuthLayout(props: AuthLayoutProps) {
	const hasManagedAdminTheme = useHasManagedAdminTheme();
	useManagedAdminTheme(undefined, undefined, {
		enabled: !hasManagedAdminTheme,
	});

	const adminStore = useAdminStoreRaw();
	const overrideLoader = adminStore
		?.getState()
		.admin.getComponent("adminAuthLayout") as MaybeLazyComponent | undefined;
	const { Component: Override } = useLazyComponent(overrideLoader, {
		allowDynamicImportLoaders: false,
	});

	if (Override) {
		return (
			<React.Suspense fallback={<AuthLayoutBuiltIn {...props} />}>
				<Override {...props} />
			</React.Suspense>
		);
	}

	return <AuthLayoutBuiltIn {...props} />;
}
