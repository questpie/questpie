export type AcceptanceDiffLine = {
	text: string;
	path?: string;
	kind: "added" | "removed" | "context" | "metadata";
	oldLine?: number;
	newLine?: number;
};

function repositoryPath(path: string): boolean {
	return (
		/^[A-Za-z0-9_.@/-]+$/.test(path) &&
		path
			.split("/")
			.every((part) => part !== "" && part !== "." && part !== "..")
	);
}

/** Keeps exact text; only complete, ordinary pinned unified-diff sections gain coordinates. */
export function parseAcceptanceDiffLines(
	diff: string,
): readonly AcceptanceDiffLine[] {
	const lines: AcceptanceDiffLine[] = diff
		.split("\n")
		.map((text) => ({ text, kind: "metadata" }));
	for (let section = 0; section < lines.length; ) {
		let end = section + 1;
		while (end < lines.length && !lines[end]!.text.startsWith("diff --git "))
			end += 1;
		const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[section]!.text);
		if (!header || header[1] !== header[2] || !repositoryPath(header[1]!)) {
			section = end;
			continue;
		}
		const path = header[1]!;
		const mapped: Array<{ index: number; line: AcceptanceDiffLine }> = [];
		let oldHeader = false;
		let newHeader = false;
		let oldLine = 0;
		let newLine = 0;
		let oldLeft = 0;
		let newLeft = 0;
		let valid = true;
		let hasHunk = false;
		for (let index = section + 1; index < end; index += 1) {
			const text = lines[index]!.text;
			if (oldLeft > 0 || newLeft > 0) {
				const kind =
					text[0] === "+"
						? "added"
						: text[0] === "-"
							? "removed"
							: text[0] === " "
								? "context"
								: null;
				if (text === "\\ No newline at end of file") continue;
				if (
					!kind ||
					(kind !== "added" && oldLeft === 0) ||
					(kind !== "removed" && newLeft === 0)
				) {
					valid = false;
					break;
				}
				const line: AcceptanceDiffLine = { text, path, kind };
				if (kind !== "added") {
					line.oldLine = oldLine++;
					oldLeft -= 1;
				}
				if (kind !== "removed") {
					line.newLine = newLine++;
					newLeft -= 1;
				}
				mapped.push({ index, line });
				continue;
			}
			const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(
				text,
			);
			if (hunk && oldHeader && newHeader) {
				const nextOld = Number(hunk[1]);
				const nextNew = Number(hunk[3]);
				oldLeft = Number(hunk[2] ?? 1);
				newLeft = Number(hunk[4] ?? 1);
				if (
					![nextOld, nextNew, oldLeft, newLeft].every(Number.isSafeInteger) ||
					(oldLeft > 0 && nextOld === 0) ||
					(newLeft > 0 && nextNew === 0) ||
					(oldLeft === 0 && newLeft === 0) ||
					(hasHunk && (nextOld < oldLine || nextNew < newLine))
				) {
					valid = false;
					break;
				}
				oldLine = nextOld;
				newLine = nextNew;
				hasHunk = true;
				continue;
			}
			if (
				!hasHunk &&
				!oldHeader &&
				(text === `--- a/${path}` || text === "--- /dev/null")
			) {
				oldHeader = true;
				continue;
			}
			if (
				!hasHunk &&
				oldHeader &&
				!newHeader &&
				(text === `+++ b/${path}` || text === "+++ /dev/null")
			) {
				newHeader = true;
				continue;
			}
			if (
				!oldHeader &&
				/^(?:index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?|(?:new file|deleted file|old|new) mode [0-7]{6})$/.test(
					text,
				)
			)
				continue;
			if (hasHunk && text === "\\ No newline at end of file") continue;
			if (index === lines.length - 1 && text === "") continue;
			valid = false;
			break;
		}
		if (valid && oldLeft === 0 && newLeft === 0)
			for (const entry of mapped) lines[entry.index] = entry.line;
		section = end;
	}
	return lines;
}
