export function getCookie(name: string): string | null {
	if (typeof document === "undefined") return null;
	const match = document.cookie.match(new RegExp(`${name}=([^;]+)`));
	return match ? match[1] : null;
}
