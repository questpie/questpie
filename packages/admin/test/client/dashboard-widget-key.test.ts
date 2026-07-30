/**
 * Which registry key a dashboard widget config resolves to.
 *
 * `ServerCustomWidget` (server/augmentation/dashboard.ts:182-199) is
 * `{ type: "custom", widgetType, props }` and documents widgetType as
 * "resolved by client registry". The renderer ignored it: `type === "custom"`
 * short-circuited to an inline-component branch reading `config.component` and
 * `config.config`, neither of which exists on that interface. Every
 * contract-conformant custom widget therefore rendered
 * `error.componentNotFound` — including `@questpie/workflows`' workflow-stats,
 * whose client component was registered and shipped the whole time.
 *
 * Server-side tests could not see this; the bug lived entirely in the render
 * path. Hence a pure exported resolver with its own test.
 */
import { describe, expect, it } from "bun:test";

import { resolveWidgetKey } from "../../src/client/views/dashboard/dashboard-widget.js";

describe("resolveWidgetKey", () => {
	it("resolves a custom widget to its widgetType, not the discriminant", () => {
		expect(
			resolveWidgetKey({ type: "custom", widgetType: "workflow-stats" }),
		).toBe("workflow-stats");
	});

	it("leaves a built-in widget type alone", () => {
		expect(resolveWidgetKey({ type: "timeline" })).toBe("timeline");
		expect(resolveWidgetKey({ type: "value" })).toBe("value");
	});

	it("falls back to the discriminant when a custom widget has no widgetType", () => {
		// The legacy inline-component shape, kept working by the renderer.
		expect(resolveWidgetKey({ type: "custom" })).toBe("custom");
	});

	it("does not treat widgetType on a non-custom widget as an override", () => {
		expect(
			resolveWidgetKey({ type: "timeline", widgetType: "something-else" }),
		).toBe("timeline");
	});
});
