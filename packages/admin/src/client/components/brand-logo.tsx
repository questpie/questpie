import * as React from "react";

import { cn } from "../lib/utils.js";
import type { BrandLogoConfig } from "../types/admin-config.js";
import { ComponentRenderer } from "./component-renderer.js";

export interface BrandLogoMarkProps {
	logo: BrandLogoConfig | null | undefined;
	className?: string;
	fallback?: React.ReactNode;
	alt?: string;
}

/**
 * Default renderer for `branding.logo`. Accepts:
 *   - a URL string (same image both modes)
 *   - `{ src, srcDark }` (separate light/dark images, switched by .dark class)
 *   - a `ComponentReference` (server-registered component, e.g. an SVG)
 *
 * When `logo` is null/undefined the `fallback` prop is rendered (typically
 * the framework's built-in mark, e.g. `<QuestpieSymbol />`).
 *
 * Light/dark switching uses Tailwind's `dark:` variant against the
 * `.dark` class the admin theme manager toggles on `<html>`.
 */
export const BrandLogoMark = React.memo(function BrandLogoMark({
	logo,
	className,
	fallback = null,
	alt = "",
}: BrandLogoMarkProps) {
	if (logo == null) return <>{fallback}</>;

	if (typeof logo === "string") {
		return (
			<img
				src={logo}
				alt={alt}
				className={cn("size-6 shrink-0 object-contain", className)}
			/>
		);
	}

	if ("src" in logo) {
		const { src, srcDark, alt: imgAlt = alt, width, height } = logo;
		if (!srcDark) {
			return (
				<img
					src={src}
					alt={imgAlt}
					width={width}
					height={height}
					className={cn("size-6 shrink-0 object-contain", className)}
				/>
			);
		}
		return (
			<>
				<img
					src={src}
					alt={imgAlt}
					width={width}
					height={height}
					className={cn(
						"size-6 shrink-0 object-contain dark:hidden",
						className,
					)}
				/>
				<img
					src={srcDark}
					alt={imgAlt}
					width={width}
					height={height}
					className={cn(
						"hidden size-6 shrink-0 object-contain dark:block",
						className,
					)}
				/>
			</>
		);
	}

	return (
		<ComponentRenderer
			reference={{ type: logo.type, props: logo.props ?? {} }}
			fallback={fallback}
			additionalProps={className ? { className } : undefined}
		/>
	);
});
