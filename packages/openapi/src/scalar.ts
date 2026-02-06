/**
 * Scalar UI HTML response handler.
 */

import type { OpenApiSpec, ScalarConfig } from "./types.js";

/**
 * Generate an HTML page that renders Scalar API reference UI.
 * The spec is inlined as JSON and Scalar is loaded from CDN.
 */
export function serveScalarUI(
  spec: OpenApiSpec,
  config?: ScalarConfig,
): Response {
  const title = config?.title ?? spec.info.title ?? "API Reference";
  const scalarConfig = JSON.stringify({
    theme: config?.theme ?? "purple",
    hideDownloadButton: config?.hideDownloadButton,
    defaultHttpClient: config?.defaultHttpClient,
    customCss: config?.customCss,
    // Embed the spec directly in the configuration for newer Scalar versions
    content: spec,
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(title)}</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script id="api-reference" data-configuration='${escapeAttr(scalarConfig)}'></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
