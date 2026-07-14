export type RealtimeAddTopicFrame = {
	type: "add_topic";
	topicId: string;
	topic: Record<string, unknown>;
	sinceSeq?: number;
};

export type RealtimeRemoveTopicFrame = {
	type: "remove_topic";
	topicId: string;
};

export type RealtimeSubscribeChannelFrame = {
	type: "subscribe_channel";
	subscriptionId: string;
	channel: string;
	params: Record<string, string>;
	lastEventId?: string;
};

export type RealtimeUnsubscribeChannelFrame = {
	type: "unsubscribe_channel";
	subscriptionId: string;
};

export type RealtimeControlFrame =
	| RealtimeAddTopicFrame
	| RealtimeRemoveTopicFrame
	| RealtimeSubscribeChannelFrame
	| RealtimeUnsubscribeChannelFrame;

type ControlSession<TContext> = {
	token: string;
	apply(frames: RealtimeControlFrame[], context: TContext): Promise<void>;
	operation: Promise<void>;
};

export class RealtimeSseControlRegistry<TContext = unknown> {
	private readonly sessions = new Map<string, ControlSession<TContext>>();

	register(
		sessionId: string,
		token: string,
		apply: ControlSession<TContext>["apply"],
	): () => void {
		this.sessions.set(sessionId, {
			token,
			apply,
			operation: Promise.resolve(),
		});
		return () => this.sessions.delete(sessionId);
	}

	async dispatch(
		sessionId: string,
		token: string,
		frames: RealtimeControlFrame[],
		context: TContext,
	): Promise<boolean> {
		const session = this.sessions.get(sessionId);
		if (!session || session.token !== token) return false;
		session.operation = session.operation
			.catch(() => {})
			.then(() => session.apply(frames, context));
		await session.operation;
		return true;
	}
}

const registries = new WeakMap<object, RealtimeSseControlRegistry<any>>();

export function getRealtimeSseControlRegistry<TContext>(
	owner: object,
): RealtimeSseControlRegistry<TContext> {
	let registry = registries.get(owner);
	if (!registry) {
		registry = new RealtimeSseControlRegistry();
		registries.set(owner, registry);
	}
	return registry;
}
