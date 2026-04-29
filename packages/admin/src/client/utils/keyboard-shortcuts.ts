type KeyboardLikeEvent = Pick<
	KeyboardEvent,
	"ctrlKey" | "defaultPrevented" | "key" | "metaKey" | "target"
>;

export function isModifierShortcut(event: KeyboardLikeEvent): boolean {
	return event.metaKey || event.ctrlKey;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;

	return Boolean(
		target.closest(
			[
				"input",
				"textarea",
				"select",
				"[contenteditable='true']",
				"[role='textbox']",
				".ProseMirror",
				"[data-admin-rich-text-editor]",
			].join(","),
		),
	);
}

export function shouldHandleAdminShortcut(
	event: KeyboardLikeEvent,
	options: {
		allowEditableTarget?: boolean;
		key: string;
	},
): boolean {
	if (event.defaultPrevented) return false;
	if (!isModifierShortcut(event)) return false;
	if (event.key.toLowerCase() !== options.key.toLowerCase()) return false;
	if (!options.allowEditableTarget && isEditableShortcutTarget(event.target)) {
		return false;
	}
	return true;
}
