import type { SupportDesk } from "../../../web/questpie";

type Operation =
	| `mutation/${keyof SupportDesk["mutations"]}`
	| `action/${keyof SupportDesk["actions"]}`;
type Transport = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;
type Observed = Readonly<{ response: Response; effectKey: string | null }>;

/** Tracer-only response observation. Never changes or consumes the UI response. */
export function createOperationObserver(transport: Transport, origin: string) {
	let disposed = false;
	let active:
		| {
				operation: Operation;
				claimed: boolean;
				resolve(value: Observed): void;
				reject(error: unknown): void;
		  }
		| undefined;
	return {
		async fetch(input: RequestInfo | URL, init?: RequestInit) {
			const request = input instanceof Request ? input : undefined;
			const url = new URL(request?.url ?? String(input), origin);
			const armed = active;
			const selected =
				armed &&
				!armed.claimed &&
				url.origin === origin &&
				url.pathname === `/_questpie/${armed.operation}` &&
				(init?.method ?? request?.method ?? "GET") === "POST"
					? armed
					: undefined;
			if (selected) selected.claimed = true;
			try {
				const response = await transport(input, init);
				if (selected && active === selected) {
					try {
						const effectKey = selected.operation.startsWith("action/")
							? new Headers(init?.headers ?? request?.headers).get("Effect-Key")
							: null;
						selected.resolve({
							response: response.clone(),
							effectKey:
								effectKey === null ? null : decodeURIComponent(effectKey),
						});
					} catch (error) {
						selected.reject(error);
					}
				}
				return response;
			} catch (error) {
				if (selected && active === selected) selected.reject(error);
				throw error;
			}
		},
		async capture(
			operation: Operation,
			action: () => unknown | Promise<unknown>,
			timeout = 30_000,
		): Promise<Observed> {
			if (disposed) throw new Error("Observer disposed");
			if (active) throw new Error("A UI operation is already armed");
			const pending = Promise.withResolvers<Observed>();
			const armed = {
				operation,
				claimed: false,
				resolve: pending.resolve,
				reject: pending.reject,
			};
			active = armed;
			const deadline = setTimeout(
				() => pending.reject(new Error("UI operation was not observed")),
				timeout,
			);
			try {
				const [observed] = await Promise.all([
					pending.promise,
					Promise.resolve().then(action),
				]);
				return observed;
			} finally {
				clearTimeout(deadline);
				if (active === armed) active = undefined;
			}
		},
		dispose() {
			disposed = true;
			active?.reject(new Error("Observer disposed"));
			active = undefined;
		},
	};
}
