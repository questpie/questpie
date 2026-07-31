import type { Principal } from "#questpie/server/config/context.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

async function authParameters(request: Request): Promise<{
	socketId: string;
	channel?: string;
}> {
	const contentType = request.headers.get("content-type") ?? "";
	let socketId: unknown;
	let channel: unknown;
	if (contentType.includes("application/json")) {
		const body = (await request.json()) as Record<string, unknown>;
		socketId = body.socket_id ?? body.socketId;
		channel = body.channel_name ?? body.channel;
	} else {
		const body = await request.formData();
		socketId = body.get("socket_id");
		channel = body.get("channel_name");
	}
	if (
		typeof socketId !== "string" ||
		(channel !== null && channel !== undefined && typeof channel !== "string")
	) {
		throw new Error("socket_id is required");
	}
	return {
		socketId,
		...(typeof channel === "string" ? { channel } : {}),
	};
}

/** Socket/channel-bound Pusher authorization for active realtime sessions. */
export default route()
	.post()
	.access(true)
	.raw()
	.handler(async (ctx) => {
		try {
			const realtime = routeApp(ctx).realtime;
			if (!realtime) {
				return Response.json(
					{ error: "Realtime provider auth is not configured" },
					{ status: 404, headers: { "Cache-Control": "no-store" } },
				);
			}
			const input = await authParameters(ctx.request);
			const principal = (ctx as { principal?: Principal }).principal ?? null;
			const auth = input.channel
				? await realtime.generateClientAuth({
						socketId: input.socketId,
						channel: input.channel,
						principal,
					})
				: await realtime.generateClientUserAuth({
						socketId: input.socketId,
						principal,
					});
			return Response.json(auth, {
				headers: { "Cache-Control": "no-store" },
			});
		} catch {
			return Response.json(
				{ error: "Realtime session is not authorized" },
				{ status: 403, headers: { "Cache-Control": "no-store" } },
			);
		}
	});
