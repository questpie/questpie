/**
 * PreviewBanner — sticky banner shown on draft pages.
 *
 * Tests the public preview banner component:
 *
 *   - Returns null outside preview mode (no DOM at all).
 *   - Renders a sticky banner with an exit link in preview mode.
 *   - Default exit URL is `/api/preview?disable=true`; the
 *     `exitPreviewUrl` prop overrides it.
 *   - The optional `className` prop is forwarded to the banner root.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { PreviewBanner } from "#questpie/admin/client/preview/preview-banner";

afterEach(() => {
	cleanup();
});

describe("PreviewBanner — visibility", () => {
	it("renders nothing when isPreviewMode is false", () => {
		const { container } = render(<PreviewBanner isPreviewMode={false} />);
		// Guard against the banner leaking onto non-preview pages.
		expect(container.firstChild).toBeNull();
	});

	it("renders the banner with the Exit Preview link in preview mode", () => {
		render(<PreviewBanner isPreviewMode={true} />);
		expect(screen.getByText("Preview Mode")).toBeDefined();
		const link = screen.getByText("Exit Preview");
		expect(link).toBeDefined();
		expect(link.tagName).toBe("A");
	});
});

describe("PreviewBanner — exit URL", () => {
	it("uses the default `/api/preview?disable=true` when no override is passed", () => {
		render(<PreviewBanner isPreviewMode={true} />);
		const link = screen.getByText("Exit Preview") as HTMLAnchorElement;
		// Compare to pathname + search to avoid origin-prefixing
		// happy-dom adds when reading `.href`.
		expect(link.getAttribute("href")).toBe("/api/preview?disable=true");
	});

	it("honours a custom exitPreviewUrl prop", () => {
		render(
			<PreviewBanner
				isPreviewMode={true}
				exitPreviewUrl="/custom/exit?token=abc"
			/>,
		);
		const link = screen.getByText("Exit Preview") as HTMLAnchorElement;
		expect(link.getAttribute("href")).toBe("/custom/exit?token=abc");
	});
});

describe("PreviewBanner — class forwarding", () => {
	it("forwards the optional className to the banner root", () => {
		const { container } = render(
			<PreviewBanner isPreviewMode={true} className="my-banner" />,
		);
		const root = container.firstChild as HTMLElement | null;
		expect(root).not.toBeNull();
		expect(root!.className).toContain("my-banner");
	});
});
