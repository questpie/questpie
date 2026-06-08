import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeroRenderer } from "./hero";
import { ImageRenderer } from "./image";
import { ImageTextRenderer } from "./image-text";

const rawUploadId = "107895c7-069e-4c48-92b5-b2e7b0d4a50e";
const resolvedAssetUrl =
	"http://localhost:3001/api/assets/files/storage-key-avatar.png";

function renderRawIdScenario() {
	return [
		renderToStaticMarkup(
			createElement(HeroRenderer, {
				values: {
					title: "Hero",
					backgroundImage: rawUploadId,
					height: "medium",
					alignment: "center",
				},
				data: {},
			}),
		),
		renderToStaticMarkup(
			createElement(ImageRenderer, {
				values: {
					image: rawUploadId,
					aspectRatio: "original",
					width: "full",
				},
				data: {},
			}),
		),
		renderToStaticMarkup(
			createElement(ImageTextRenderer, {
				values: {
					image: rawUploadId,
					imagePosition: "left",
					title: "Image text",
				},
				data: {},
			}),
		),
	].join("\n");
}

describe("city portal upload block renderers", () => {
	test("do not render raw upload ids when prefetch data is missing", () => {
		const html = renderRawIdScenario();

		expect(html).not.toContain(rawUploadId);
		expect(html).not.toContain(`src="${rawUploadId}"`);
		expect(html).not.toContain(`url(${rawUploadId})`);
	});

	test("render prefetched asset URLs", () => {
		const html = [
			renderToStaticMarkup(
				createElement(HeroRenderer, {
					values: {
						title: "Hero",
						backgroundImage: rawUploadId,
						height: "medium",
						alignment: "center",
					},
					data: { backgroundImage: { url: resolvedAssetUrl } },
				}),
			),
			renderToStaticMarkup(
				createElement(ImageRenderer, {
					values: {
						image: rawUploadId,
						aspectRatio: "original",
						width: "full",
					},
					data: { image: { url: resolvedAssetUrl } },
				}),
			),
			renderToStaticMarkup(
				createElement(ImageTextRenderer, {
					values: {
						image: rawUploadId,
						imagePosition: "left",
						title: "Image text",
					},
					data: { image: { url: resolvedAssetUrl } },
				}),
			),
		].join("\n");

		expect(html).toContain(resolvedAssetUrl);
		expect(html).not.toContain(rawUploadId);
	});
});
