import { afterEach, describe, expect, it } from "bun:test";

import { cleanup, render, screen } from "@testing-library/react";

import { useBrand, type BrandSnapshot } from "@questpie/admin/client";

afterEach(() => {
	cleanup();
});

describe("useBrand — fallback snapshot", () => {
	it("is safe outside AdminProvider and keeps the snapshot identity stable", () => {
		const snapshots: BrandSnapshot[] = [];

		function Probe() {
			const brand = useBrand();
			snapshots.push(brand);
			return <div>{brand.name}</div>;
		}

		const { rerender } = render(<Probe />);
		rerender(<Probe />);

		expect(screen.getByText("Admin")).toBeDefined();
		expect(snapshots).toHaveLength(2);
		expect(snapshots[0]).toBe(snapshots[1]);
	});
});
