import * as Y from "yjs";

type TextAffinity = "preceding" | "following";

export function createYjsRelativePosition(
	document: Y.Doc,
	text: Y.Text,
	input: Readonly<{ offset: number; affinity: TextAffinity }>,
): string {
	assertDocumentText(document, text);
	assertOffset(text.toString(), input.offset);
	if (input.affinity !== "preceding" && input.affinity !== "following") {
		throw new Error("invalid Yjs relative position affinity");
	}
	return encodeBase64Url(
		Y.encodeRelativePosition(
			Y.createRelativePositionFromTypeIndex(
				text,
				input.offset,
				input.affinity === "preceding" ? -1 : 0,
			),
		),
	);
}

export function resolveYjsRelativePosition(
	document: Y.Doc,
	text: Y.Text,
	position: string,
): Readonly<{ offset: number; affinity: TextAffinity }> | undefined {
	assertDocumentText(document, text);
	let relative: Y.RelativePosition;
	try {
		relative = Y.decodeRelativePosition(decodeBase64Url(position));
	} catch {
		throw new Error("invalid Yjs relative position");
	}
	if (relative.assoc !== -1 && relative.assoc !== 0) {
		throw new Error("invalid Yjs relative position affinity");
	}
	const absolute = Y.createAbsolutePositionFromRelativePosition(
		relative,
		document,
	);
	if (!absolute || absolute.type !== text) return undefined;
	assertOffset(text.toString(), absolute.index);
	return Object.freeze({
		offset: absolute.index,
		affinity: relative.assoc < 0 ? "preceding" : "following",
	});
}

function assertDocumentText(document: Y.Doc, text: Y.Text): void {
	if (document.getText("text") !== text) {
		throw new Error("invalid Yjs text replica");
	}
}

function assertOffset(value: string, offset: number): void {
	if (
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		offset > value.length ||
		(offset > 0 &&
			offset < value.length &&
			isHighSurrogate(value.charCodeAt(offset - 1)) &&
			isLowSurrogate(value.charCodeAt(offset)))
	) {
		throw new Error("invalid UTF-16 text offset");
	}
}

function decodeBase64Url(value: string): Uint8Array {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 344 ||
		value.length % 4 === 1 ||
		!/^[A-Za-z0-9_-]+$/.test(value)
	) {
		throw new Error("invalid base64url");
	}
	const binary = atob(
		value.replace(/-/g, "+").replace(/_/g, "/") +
			"=".repeat((4 - (value.length % 4)) % 4),
	);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	if (encodeBase64Url(bytes) !== value) {
		throw new Error("noncanonical base64url");
	}
	return bytes;
}

function encodeBase64Url(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function isHighSurrogate(value: number): boolean {
	return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
	return value >= 0xdc00 && value <= 0xdfff;
}
