import { execFile } from "node:child_process";

import { z } from "zod";

import { DOCUMENT_EXTRACTOR_PROGRAM } from "./document-extractor-program.js";

export const EXTRACTION_PROFILE = "office-xml-pypdf-6.19.0-v1";
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const resultSchema = z.object({
	status: z.enum(["ready", "no_text", "unavailable"]),
	blocks: z
		.array(
			z.object({
				text: z.string().max(1_000_000),
				locator: z.record(z.string(), z.union([z.string(), z.number()])),
			}),
		)
		.max(4096),
	missingPages: z.array(z.number().int()).max(300),
});
export type ExtractedDocument = z.infer<typeof resultSchema>;
const unavailable: ExtractedDocument = {
	status: "unavailable",
	blocks: [],
	missingPages: [],
};

export async function extractDocument(
	bytes: Uint8Array,
	extension: string,
	python = "python3",
): Promise<ExtractedDocument> {
	if (
		bytes.byteLength > MAX_DOCUMENT_BYTES ||
		!["pdf", "docx", "pptx", "xlsx", "txt", "md", "markdown"].includes(
			extension,
		)
	)
		return unavailable;
	return new Promise((resolve) => {
		const child = execFile(
			python,
			["-I", "-c", DOCUMENT_EXTRACTOR_PROGRAM, extension],
			{
				// The converter inherits no provider, storage or database credentials.
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
				timeout: 20_000,
				maxBuffer: 8_000_000,
				killSignal: "SIGKILL",
				encoding: "utf8",
			},
			(error, stdout) => {
				if (error) return resolve(unavailable);
				try {
					resolve(resultSchema.parse(JSON.parse(stdout)));
				} catch {
					resolve(unavailable);
				}
			},
		);
		child.stdin?.on("error", () => {
			child.kill("SIGKILL");
			resolve(unavailable);
		});
		child.stdin?.end(bytes);
	});
}
