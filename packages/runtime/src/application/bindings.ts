import type { ContextDefinition, ServiceDefinition } from "questpie";

import type { RuntimeExecutableBinding } from "../operation";
import type { RuntimeArtifactsV1 } from "./artifacts";

export type RuntimeExecutableInventoryBinding<View> =
	| RuntimeExecutableBinding<View>
	| Readonly<{
			identity: string;
			kind: "context";
			slot: "resolve";
			runtimeGraphDigest: string;
			bundleExport: string;
			definition: ContextDefinition;
	  }>
	| Readonly<{
			identity: string;
			kind: "service";
			slot: "create" | "dispose";
			runtimeGraphDigest: string;
			bundleExport: string;
			definition: ServiceDefinition;
	  }>;

export type RuntimeExecutableBindings<View> = Readonly<{
	runtimeBuildDigest: string;
	slots: readonly RuntimeExecutableInventoryBinding<View>[];
}>;

export function validateRuntimeExecutableBindings<View>(
	artifacts: RuntimeArtifactsV1,
	bindings: RuntimeExecutableBindings<View>,
	serverExports: Readonly<Record<string, unknown>>,
	program: Readonly<{
		context: ContextDefinition;
		services: readonly ServiceDefinition[];
	}>,
): readonly RuntimeExecutableBinding<View>[] {
	if (bindings.runtimeBuildDigest !== artifacts.runtimeBuild.digest)
		throw new TypeError("Runtime executable binding is from another build");
	const candidates = bindings.slots.map((binding) =>
		Object.freeze({ ...binding }),
	);
	const keys = candidates.map(
		(binding) => `${binding.identity}#${binding.slot}`,
	);
	if (new Set(keys).size !== keys.length)
		throw new TypeError("Runtime executable binding is duplicate");
	const byKey = new Map(
		candidates.map((binding) => [
			`${binding.identity}#${binding.slot}`,
			binding,
		]),
	);
	for (const expected of artifacts.runtimeExecutables.slots) {
		const binding = byKey.get(`${expected.identity}#${expected.slot}`);
		if (
			!binding ||
			binding.kind !== expected.kind ||
			binding.runtimeGraphDigest !== expected.runtimeGraphDigest ||
			binding.bundleExport !== expected.bundleExport
		)
			throw new TypeError("Runtime executable binding does not match");
	}
	if (byKey.size !== artifacts.runtimeExecutables.slots.length)
		throw new TypeError("Runtime executable binding does not match");
	const exportNames = Object.keys(serverExports).sort();
	const expectedExportNames = artifacts.runtimeExecutables.slots
		.map((slot) => slot.bundleExport)
		.sort();
	if (
		exportNames.length !== expectedExportNames.length ||
		expectedExportNames.some((name, index) => name !== exportNames[index])
	)
		throw new TypeError("Runtime server export inventory does not match");
	const expectedProgramSlots = new Map<string, object>();
	expectedProgramSlots.set(
		`context:${program.context.name}#resolve`,
		program.context,
	);
	for (const service of program.services) {
		expectedProgramSlots.set(`service:${service.name}#create`, service);
		if (service.dispose)
			expectedProgramSlots.set(`service:${service.name}#dispose`, service);
	}
	const structuralBindings = candidates.filter(
		(binding) => binding.kind === "context" || binding.kind === "service",
	);
	if (
		structuralBindings.length !== expectedProgramSlots.size ||
		structuralBindings.some(
			(binding) =>
				expectedProgramSlots.get(`${binding.identity}#${binding.slot}`) !==
				binding.definition,
		)
	)
		throw new TypeError("Runtime program executable binding does not match");
	if (
		candidates.some(
			(binding) =>
				binding.kind === "query" &&
				(binding.definition.name !== binding.identity.slice("query:".length) ||
					binding.definition.handler !== binding.execute),
		)
	)
		throw new TypeError("Runtime Query executable binding does not match");
	if (
		candidates.some((binding) => {
			const implementation =
				binding.kind === "query"
					? binding.execute
					: binding.kind === "context"
						? binding.definition.resolve
						: binding.slot === "create"
							? binding.definition.create
							: binding.definition.dispose;
			return serverExports[binding.bundleExport] !== implementation;
		})
	)
		throw new TypeError("Runtime server export pointer does not match");
	return Object.freeze(
		candidates.filter(
			(binding): binding is RuntimeExecutableBinding<View> =>
				binding.kind === "query",
		),
	);
}
