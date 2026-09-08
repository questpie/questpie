import { expect, test } from "bun:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { createLiveQueryOptions } from "../../packages/questpie/src/react-query/live-options";

type Task = Readonly<{ id: string; title: string; staffNote?: string }>;

test("a cancelled generation cannot detach cancellation from its immediate replacement", async () => {
	const client = new QueryClient();
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["replaced-pending", "tasks.detail", "task-1"],
		watch() {
			return () => {};
		},
	});
	const observer = new QueryObserver(client, query.options);
	const unsubscribeFirst = observer.subscribe(() => {});
	const first = client.fetchQuery(query.options).catch(() => {});
	unsubscribeFirst();
	const unsubscribeSecond = observer.subscribe(() => {});
	const second = client.fetchQuery(query.options).catch(() => {});
	try {
		await first;
		observer.setOptions({ ...query.options, enabled: false });
		await second;
		expect(client.getQueryState(query.options.queryKey)?.fetchStatus).toBe(
			"idle",
		);
	} finally {
		unsubscribeSecond();
		await query.dispose();
		await second;
		client.clear();
	}
});

test("native cache removal closes the active Task watch", async () => {
	const client = new QueryClient();
	let stopped = false;
	let deliver: ((task: Task) => void) | undefined;
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["removed-query", "tasks.detail", "task-1"],
		watch(callback) {
			deliver = callback;
			return () => {
				stopped = true;
			};
		},
	});
	const observer = new QueryObserver(client, query.options);
	const unsubscribe = observer.subscribe(() => {});
	try {
		const fetched = client.fetchQuery(query.options);
		deliver!({ id: "task-1", title: "Visible" });
		await fetched;
		client.removeQueries({ queryKey: query.options.queryKey, exact: true });
		expect(stopped).toBe(true);
		deliver!({ id: "task-1", title: "Late" });
		expect(client.getQueryData(query.options.queryKey)).toBeUndefined();
	} finally {
		unsubscribe();
		await query.dispose();
		client.clear();
	}
});

test("a complete Task update removes an omitted field and does not lose a delivery during first-fetch settlement", async () => {
	const client = new QueryClient();
	let deliver: ((task: Task) => void) | undefined;
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["replacement-scope", "tasks.detail", "task-1"],
		watch(callback) {
			deliver = callback;
			return () => {};
		},
	});
	const observer = new QueryObserver(client, query.options);
	const unsubscribe = observer.subscribe(() => {});
	try {
		const fetched = client.fetchQuery(query.options);
		deliver!({
			id: "task-1",
			title: "Original",
			staffNote: "Synthetic protected note",
		});
		deliver!({ id: "task-1", title: "Restricted view" });
		await fetched;
		expect(observer.getCurrentResult().data).toEqual({
			id: "task-1",
			title: "Restricted view",
		});
		const cached = client.getQueryData(query.options.queryKey);
		expect(cached).toEqual({
			id: "task-1",
			title: "Restricted view",
		});
	} finally {
		unsubscribe();
		await query.dispose();
		client.clear();
	}
});

test("last unsubscribe before first Task snapshot cancels the finite fetch instead of leaving it pending", async () => {
	const client = new QueryClient();
	let stopped = false;
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["early-unsubscribe", "tasks.detail", "task-1"],
		watch() {
			return () => {
				stopped = true;
			};
		},
	});
	const observer = new QueryObserver(client, query.options);
	const unsubscribe = observer.subscribe(() => {});
	let settlement = "pending";
	const pending = client.fetchQuery(query.options).then(
		() => {
			settlement = "resolved";
		},
		() => {
			settlement = "cancelled";
		},
	);
	try {
		unsubscribe();
		await Promise.resolve();
		await Promise.resolve();
		expect(stopped).toBe(true);
		expect(client.getQueryState(query.options.queryKey)?.fetchStatus).toBe(
			"idle",
		);
		await pending;
		expect(settlement).toBe("cancelled");
	} finally {
		unsubscribe();
		await query.dispose();
		await pending;
		client.clear();
	}
});

test("synchronous denial during watch opening still releases the returned stop handle", async () => {
	const client = new QueryClient();
	let stopped = false;
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["synchronous-denial", "tasks.detail", "task-1"],
		watch(_callback, onError) {
			onError({ code: "AUTHORIZATION_FAILED" });
			return () => {
				stopped = true;
			};
		},
	});
	try {
		await expect(client.fetchQuery(query.options)).rejects.toThrow();
		expect(stopped).toBe(true);
		expect(client.getQueryData(query.options.queryKey)).toBeUndefined();
	} finally {
		await query.dispose();
		client.clear();
	}
});

test("denied Task watch clears a retained result without waiting for another fetch", async () => {
	const client = new QueryClient();
	let deliver: ((task: Task) => void) | undefined;
	let deny: (() => void) | undefined;
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["denied-scope", "tasks.detail", "task-1"],
		watch(callback, onError) {
			deliver = callback;
			deny = () => onError({ code: "AUTHORIZATION_FAILED" });
			return () => {};
		},
	});
	const observer = new QueryObserver(client, query.options);
	const unsubscribe = observer.subscribe(() => {});
	try {
		const fetched = client.fetchQuery(query.options);
		deliver!({ id: "task-1", title: "Previously visible" });
		await fetched;
		deny!();
		expect(observer.getCurrentResult().data).toBeUndefined();
		expect(observer.getCurrentResult().error?.message).toBe(
			"AUTHORIZATION_FAILED",
		);
		deliver!({ id: "task-1", title: "Late denied value" });
		expect(client.getQueryData(query.options.queryKey)).toBeUndefined();
	} finally {
		unsubscribe();
		await query.dispose();
		client.clear();
	}
});

test("disabling the last active Task observer releases work even while its handle is retained", async () => {
	const client = new QueryClient();
	let stopped = 0;
	let deliver: ((task: Task) => void) | undefined;
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["disabled-scope", "tasks.detail", "task-1"],
		watch(callback) {
			deliver = callback;
			return () => {
				stopped++;
			};
		},
	});
	const observer = new QueryObserver(client, query.options);
	const unsubscribe = observer.subscribe(() => {});
	try {
		const fetched = client.fetchQuery(query.options);
		deliver!({ id: "task-1", title: "Visible" });
		await fetched;
		observer.setOptions({ ...query.options, enabled: false });
		expect(stopped).toBe(1);
		deliver!({ id: "task-1", title: "Late delivery" });
		expect(observer.getCurrentResult().data?.title).toBe("Visible");
		const oldDelivery = deliver;
		observer.setOptions({ ...query.options, enabled: true });
		expect(deliver).not.toBe(oldDelivery);
		const refreshed = client.fetchQuery({ ...query.options, staleTime: 0 });
		deliver!({ id: "task-1", title: "Fresh after re-enable" });
		await refreshed;
		expect(observer.getCurrentResult().data?.title).toBe(
			"Fresh after re-enable",
		);
	} finally {
		unsubscribe();
		await query.dispose();
		client.clear();
	}
});

test("retired Task scope clears retained observers and cannot be refetched through old options", async () => {
	const client = new QueryClient();
	let deliver: ((task: Task) => void) | undefined;
	let opened = 0;
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["retiring-scope", "tasks.detail", "task-1"],
		watch(callback) {
			opened++;
			deliver = callback;
			return () => {};
		},
	});
	const observer = new QueryObserver(client, query.options);
	const unsubscribe = observer.subscribe(() => {});
	try {
		const fetched = client.fetchQuery(query.options);
		deliver!({ id: "task-1", title: "Previously visible" });
		await fetched;
		await query.dispose();
		deliver!({ id: "task-1", title: "Late protected value" });
		expect(observer.getCurrentResult().data).toBeUndefined();
		expect(client.getQueryData(query.options.queryKey)).toBeUndefined();
		await expect(client.fetchQuery(query.options)).rejects.toThrow(
			"SCOPE_RETIRED",
		);
		expect(opened).toBe(1);
	} finally {
		unsubscribe();
		await query.dispose();
		client.clear();
	}
});

test("Task detail fetch resolves at its first snapshot and releases an unobserved watch", async () => {
	const client = new QueryClient();
	let deliver: ((task: Task) => void) | undefined;
	let stopped = false;
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["proof-scope", "tasks.detail", "task-1"],
		watch(callback) {
			deliver = callback;
			return () => {
				stopped = true;
			};
		},
	});
	try {
		const fetched = client.fetchQuery(query.options);
		expect(deliver).toBeDefined();
		deliver!({ id: "task-1", title: "Investigate retry" });
		expect(await fetched).toEqual({ id: "task-1", title: "Investigate retry" });
		expect(client.getQueryState(query.options.queryKey)?.fetchStatus).toBe(
			"idle",
		);
		expect(stopped).toBe(true);
	} finally {
		await query.dispose();
		client.clear();
	}
});

test("Task detail observers share a watch and receive later complete snapshots", async () => {
	const client = new QueryClient();
	let deliver: ((task: Task) => void) | undefined;
	let opened = 0;
	let stopped = 0;
	const query = createLiveQueryOptions<Task>({
		client,
		key: ["proof-scope", "tasks.detail", "task-1"],
		watch(callback) {
			opened++;
			deliver = callback;
			return () => {
				stopped++;
			};
		},
	});
	const first = new QueryObserver(client, query.options);
	const second = new QueryObserver(client, query.options);
	const unsubscribeFirst = first.subscribe(() => {});
	const unsubscribeSecond = second.subscribe(() => {});
	try {
		const fetched = client.fetchQuery(query.options);
		deliver!({ id: "task-1", title: "Investigate retry" });
		await fetched;
		expect(stopped).toBe(0);
		deliver!({ id: "task-1", title: "Retry fixed" });
		expect(first.getCurrentResult().data?.title).toBe("Retry fixed");
		expect(second.getCurrentResult().data?.title).toBe("Retry fixed");
		expect(opened).toBe(1);
		unsubscribeFirst();
		expect(stopped).toBe(0);
		unsubscribeSecond();
		expect(stopped).toBe(1);
	} finally {
		unsubscribeFirst();
		unsubscribeSecond();
		await query.dispose();
		client.clear();
	}
});
