import assert from "node:assert/strict";

import { decideMessageRead } from "./p2-goldens.mjs";

const SURFACES = Object.freeze([
	"direct",
	"network",
	"recompute",
	"routeTransition",
	"studio",
	"worker",
]);

function immutable(value) {
	if (Array.isArray(value)) {
		for (const item of value) immutable(item);
		return Object.freeze(value);
	}
	if (value && typeof value === "object") {
		for (const item of Object.values(value)) immutable(item);
		return Object.freeze(value);
	}
	return value;
}

function exactKeys(value, expected, name) {
	assert.deepEqual(
		Object.keys(value).sort(),
		[...expected].sort(),
		`${name} keys`,
	);
}

function pick(row, selection) {
	return Object.fromEntries(
		Object.keys(selection)
			.filter((key) => selection[key] === true)
			.map((key) => [key, row[key]]),
	);
}

function createClient() {
	const calls = [];
	const base = Object.freeze({
		withContext(input) {
			exactKeys(input, ["companyId"], "client Context input");
			assert.equal(typeof input.companyId, "string");
			const context = immutable({ ...input });
			return Object.freeze({
				context,
				query(name, operationInput) {
					calls.push({ context, name, operationInput });
					return { context, name, operationInput };
				},
			});
		},
	});
	return { base, calls };
}

function createFixture() {
	const counters = {
		bootstrapReads: 0,
		handlers: 0,
		policies: 0,
		resolutions: 0,
		serviceCreates: 0,
		serviceDisposals: [],
	};
	const memberships = [
		{
			companyId: "company-northwind",
			principalId: "principal-alice",
			scopeKey: "company",
			status: "active",
			role: "member",
			canPost: true,
		},
		{
			companyId: "company-northwind",
			principalId: "principal-alice",
			scopeKey: "channel-private",
			status: "active",
			role: "member",
			canPost: true,
		},
	];
	const store = {
		"collection:companies": [{ id: "company-northwind", name: "Northwind" }],
		"collection:spaces": [
			{ id: "space-northwind", companyId: "company-northwind" },
		],
		"collection:channels": [
			{
				id: "channel-private",
				spaceId: "space-northwind",
				visibility: "private",
			},
		],
		"collection:memberships": memberships,
	};
	const message = {
		id: "message-1",
		companyId: "company-northwind",
		channelId: "channel-private",
		authorId: "principal-alice",
		body: "hello",
		moderationNote: "author-only",
	};
	return { counters, memberships, message, store };
}

function createExecutionEngine(fixture) {
	const trustedSystemCapability = Symbol("trusted System Authority");

	function makeBootstrap(signal, deadline) {
		let reads = 0;
		const bootstrap = Object.create(null);
		Object.defineProperty(bootstrap, "get", {
			enumerable: true,
			value: async (collection, args) => {
				signal.throwIfAborted();
				assert.ok(
					Date.now() <= deadline.getTime(),
					"Context deadline exceeded",
				);
				assert.equal(collection, "collection:memberships");
				exactKeys(
					args.key,
					["companyId", "principalId", "scopeKey"],
					"bootstrap key",
				);
				assert.ok(Object.keys(args.select).length <= 16);
				reads += 1;
				fixture.counters.bootstrapReads += 1;
				assert.ok(reads <= 4, "Context bootstrap read limit exceeded");
				const row = fixture.memberships.find(
					(item) =>
						item.companyId === args.key.companyId &&
						item.principalId === args.key.principalId &&
						item.scopeKey === args.key.scopeKey,
				);
				await Promise.resolve();
				signal.throwIfAborted();
				return row ? immutable(pick(row, args.select)) : null;
			},
		});
		return Object.freeze(bootstrap);
	}

	async function resolveContext(options, signal, deadline) {
		fixture.counters.resolutions += 1;
		if (options.principal.kind === "anonymous") {
			throw Object.assign(new Error("unauthenticated"), {
				code: "unauthenticated",
			});
		}
		const bootstrap = makeBootstrap(signal, deadline);
		assert.deepEqual(Object.keys(bootstrap), ["get"]);
		assert.equal(bootstrap.database, undefined);
		assert.equal(bootstrap.rawSql, undefined);
		assert.equal(bootstrap.queue, undefined);
		assert.equal(bootstrap.services, undefined);
		assert.equal(bootstrap.systemAuthority, undefined);
		assert.equal(bootstrap.write, undefined);
		const membership = await bootstrap.get("collection:memberships", {
			key: {
				companyId: options.context.companyId,
				principalId: options.principal.id,
				scopeKey: "company",
			},
			select: {
				companyId: true,
				principalId: true,
				scopeKey: true,
				status: true,
				role: true,
			},
		});
		if (membership === null || membership.status !== "active") {
			throw Object.assign(new Error("notFound"), { code: "notFound" });
		}
		return immutable({
			tenant: { id: membership.companyId },
			values: {
				selectedMembershipPrincipalId: membership.principalId,
				selectedMembershipScope: membership.scopeKey,
				selectedRole: membership.role,
			},
		});
	}

	function root(surface, options, internalCapability = null) {
		assert.ok(SURFACES.includes(surface));
		const allowedKeys = ["context", "deadline", "principal", "signal"];
		if (internalCapability === trustedSystemCapability) {
			allowedKeys.push("authority");
		}
		assert.equal(
			Object.keys(options).every((key) => allowedKeys.includes(key)),
			true,
			"ordinary root rejected an authority or transport-specific override",
		);
		exactKeys(options.context, ["companyId"], "Context input");
		assert.equal(typeof options.context.companyId, "string");
		const signal = options.signal ?? new AbortController().signal;
		const deadline = options.deadline ?? new Date(Date.now() + 1_000);
		const authority =
			internalCapability === trustedSystemCapability
				? options.authority
				: { kind: "ordinary" };
		assert.ok(authority.kind === "ordinary" || authority.kind === "system");

		let resolutionPromise;
		let disposed = false;
		const services = new Map();
		const serviceOrder = [];

		function resolved() {
			resolutionPromise ??= resolveContext(options, signal, deadline);
			return resolutionPromise;
		}

		async function service(name) {
			assert.equal(disposed, false);
			if (!services.has(name)) {
				fixture.counters.serviceCreates += 1;
				const instance = Object.freeze({
					name,
					dispose() {
						fixture.counters.serviceDisposals.push(name);
					},
				});
				services.set(name, instance);
				serviceOrder.push(instance);
			}
			return services.get(name);
		}

		async function dispose() {
			if (disposed) return;
			disposed = true;
			for (const instance of serviceOrder.toReversed()) {
				await instance.dispose();
			}
		}

		async function run(callback) {
			try {
				const context = await resolved();
				fixture.counters.handlers += 1;
				const execution = immutable({
					surface,
					principal: options.principal,
					tenant: context.tenant,
					values: context.values,
					authority,
					signal,
					deadline,
					service,
					async readMessage(row, selectedPaths) {
						fixture.counters.policies += 1;
						return decideMessageRead({
							facts: execution,
							row,
							selectedPaths,
							store: fixture.store,
						});
					},
					async nested(nestedCallback) {
						return nestedCallback(execution);
					},
				});
				return await callback(execution);
			} finally {
				await dispose();
			}
		}

		return Object.freeze({ resolved, run });
	}

	return Object.freeze({
		root,
		trustedSystemRoot(surface, options, capability) {
			assert.equal(capability, trustedSystemCapability);
			return root(surface, options, capability);
		},
		trustedSystemCapability,
	});
}

export async function runExecutionProof() {
	const fixture = createFixture();
	const engine = createExecutionEngine(fixture);
	const ordinaryOptions = {
		principal: { kind: "user", id: "principal-alice" },
		context: { companyId: "company-northwind" },
	};

	const coalescedRoot = engine.root("direct", ordinaryOptions);
	const [firstResolved, secondResolved, thirdResolved] = await Promise.all([
		coalescedRoot.resolved(),
		coalescedRoot.resolved(),
		coalescedRoot.resolved(),
	]);
	assert.equal(firstResolved, secondResolved);
	assert.equal(secondResolved, thirdResolved);
	assert.equal(fixture.counters.resolutions, 1);
	assert.equal(fixture.counters.bootstrapReads, 1);

	const nestedResult = await coalescedRoot.run(async (execution) => {
		assert.equal(Object.isFrozen(execution), true);
		assert.equal(Object.isFrozen(execution.tenant), true);
		assert.equal(Object.isFrozen(execution.values), true);
		const alpha = await execution.service("alpha");
		const beta = await execution.service("beta");
		assert.equal(alpha, await execution.service("alpha"));
		return execution.nested(async (nested) => {
			assert.equal(nested, execution);
			assert.equal(await nested.service("beta"), beta);
			return nested.readMessage(fixture.message, [
				["id"],
				["body"],
				["moderationNote"],
			]);
		});
	});
	assert.equal(nestedResult.outcome, "allowed");
	assert.deepEqual(fixture.counters.serviceDisposals, ["beta", "alpha"]);

	const beforeFailure = { ...fixture.counters };
	const failingRoot = engine.root("network", {
		principal: { kind: "user", id: "principal-unknown" },
		context: { companyId: "company-northwind" },
	});
	await assert.rejects(() => failingRoot.run(async () => "unreachable"), {
		code: "notFound",
	});
	assert.equal(fixture.counters.handlers, beforeFailure.handlers);
	assert.equal(fixture.counters.policies, beforeFailure.policies);

	const anonymousRoot = engine.root("network", {
		principal: { kind: "anonymous" },
		context: { companyId: "company-northwind" },
	});
	await assert.rejects(() => anonymousRoot.run(async () => "unreachable"), {
		code: "unauthenticated",
	});
	assert.equal(fixture.counters.handlers, beforeFailure.handlers);
	assert.equal(fixture.counters.policies, beforeFailure.policies);

	assert.throws(
		() =>
			engine.root("direct", {
				...ordinaryOptions,
				authority: { kind: "system" },
			}),
		/ordinary root rejected/,
	);

	const parity = {};
	for (const surface of SURFACES) {
		const result = await engine
			.root(surface, ordinaryOptions)
			.run((execution) =>
				execution.readMessage(fixture.message, [["id"], ["body"]]),
			);
		parity[surface] = result;
	}
	for (const result of Object.values(parity)) {
		assert.deepEqual(result, parity.direct);
	}

	const staleContextRoot = engine.root("recompute", ordinaryOptions);
	await staleContextRoot.resolved();
	for (const membership of fixture.memberships) membership.status = "revoked";
	const revoked = await staleContextRoot.run((execution) =>
		execution.readMessage(fixture.message, [["id"]]),
	);
	assert.deepEqual(revoked, { outcome: "notFound" });
	assert.equal(firstResolved.values.selectedRole, "member");
	for (const membership of fixture.memberships) membership.status = "active";

	const trusted = await engine
		.trustedSystemRoot(
			"worker",
			{
				...ordinaryOptions,
				authority: { kind: "system" },
			},
			engine.trustedSystemCapability,
		)
		.run((execution) => execution.readMessage(fixture.message, [["id"]]));
	assert.deepEqual(trusted, {
		outcome: "allowed",
		result: { id: "message-1" },
	});
	const trustedWithoutBypass = engine.trustedSystemRoot(
		"worker",
		{
			...ordinaryOptions,
			authority: { kind: "system" },
		},
		engine.trustedSystemCapability,
	);
	await trustedWithoutBypass.resolved();
	for (const membership of fixture.memberships) membership.status = "revoked";
	assert.deepEqual(
		await trustedWithoutBypass.run((execution) =>
			execution.readMessage(fixture.message, [["id"]]),
		),
		{ outcome: "notFound" },
	);
	for (const membership of fixture.memberships) membership.status = "active";
	await assert.rejects(async () =>
		engine.trustedSystemRoot(
			"worker",
			{ ...ordinaryOptions, authority: { kind: "system" } },
			Symbol("untrusted"),
		),
	);

	const cleanupRoot = engine.root("direct", ordinaryOptions);
	await assert.rejects(
		() =>
			cleanupRoot.run(async (execution) => {
				await execution.service("failure-service");
				throw new Error("handler failure");
			}),
		/handler failure/,
	);
	assert.equal(fixture.counters.serviceDisposals.at(-1), "failure-service");

	const { base, calls } = createClient();
	const northwind = base.withContext({ companyId: "company-northwind" });
	const contoso = base.withContext({ companyId: "company-contoso" });
	assert.notEqual(northwind, contoso);
	assert.notEqual(northwind.context, contoso.context);
	assert.equal(Object.isFrozen(northwind.context), true);
	northwind.query("messages.page", { first: 2 });
	contoso.query("messages.page", { first: 3 });
	assert.deepEqual(
		calls.map((call) => call.context.companyId),
		["company-northwind", "company-contoso"],
	);

	return {
		resolution: {
			coalescedConsumers: 3,
			resolutionCount: fixture.counters.resolutions,
			bootstrapReadCount: fixture.counters.bootstrapReads,
			failureBeforePolicy: true,
			failureBeforeHandler: true,
		},
		propagation: {
			immutable: true,
			nestedIdentityPreserved: true,
			surfaces: parity,
		},
		services: {
			created: fixture.counters.serviceCreates,
			disposals: fixture.counters.serviceDisposals,
			reverseOrder: true,
			failureCleanup: true,
		},
		authority: {
			ordinaryInputCannotConstructSystem: true,
			trustedCapabilityRequired: true,
			systemDoesNotCreateAnAmbientBypass: true,
		},
		freshEvidence: {
			staleConvenienceRoleDidNotAuthorize: true,
			revokedResult: revoked,
		},
		client: {
			immutableScopes: true,
			independentConcurrentScopes: true,
		},
	};
}

if (import.meta.main) {
	console.log(JSON.stringify(await runExecutionProof(), null, 2));
	console.log("P2 Execution and Context runtime witness: pass");
}
