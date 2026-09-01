import {
	actionServiceResources,
	executionServiceResources,
	renderActionDeclarations,
	renderActionFactory,
} from "./action";
import { compareAscii } from "./canonical";
import { renderCoreDataContract } from "./data";
import { renderJobDeclarations } from "./job";
import {
	renderDataQueryParameterType,
	renderDataQuerySelection,
	renderGeneratedMutationData,
	renderGeneratedMutationDataByName,
	renderMutationDeclarations,
	renderMutationFactory,
	type MutationGeneratedContractV1,
} from "./mutation";
import {
	renderDurableDeclarations,
	renderReactionDeclarations,
	renderReactionDispatch,
} from "./reaction";
import type {
	RelationalGeneratedContractV1,
	RelationalGeneratedSelectionV1,
} from "./relational";
import { renderCodecType } from "./runtime";
import { renderServerOperationType } from "./server-operation-map";
import type { NormalizedResource } from "./types";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("expected an object while rendering declarations");
	return value as RecordValue;
}
function fieldType(
	field: RecordValue,
	timestampType: "Date" | "string" = "string",
): string {
	const scalar = field.scalar;
	let type =
		scalar === "boolean"
			? "boolean"
			: scalar === "integer"
				? "number"
				: scalar === "timestamp"
					? timestampType
					: scalar === "object"
						? embeddedFieldType(field)
						: scalar === "array"
							? `ReadonlyArray<${embeddedValueType(record(record(field.options).items))}>`
							: scalar === "json"
								? "TaggedJsonValue"
								: "string";
	if (field.nullable === true) type = `${type} | null`;
	return type;
}
function fieldNodeType(
	field: RecordValue,
	timestampType: "Date" | "string" = "string",
): string {
	if (field.kind !== "inlineShape") return fieldType(field, timestampType);
	return `Readonly<{ ${Object.entries(record(field.fields))
		.sort(([left], [right]) => compareAscii(left, right))
		.map(
			([key, child]) =>
				`readonly ${JSON.stringify(key)}: ${fieldNodeType(record(child), timestampType)};`,
		)
		.join(" ")} }>`;
}
function fieldAtPath(
	fields: readonly [string, RecordValue][],
	reference: unknown,
): RecordValue | undefined {
	const path = Array.isArray(reference) ? reference : [reference];
	let node = fields.find(([name]) => name === path[0])?.[1];
	for (const segment of path.slice(1)) {
		if (!node || node.kind !== "inlineShape") return undefined;
		node = record(node.fields)[String(segment)] as RecordValue | undefined;
	}
	return node?.kind === "inlineShape" ? undefined : node;
}
interface KeyTypeNode {
	field?: RecordValue;
	children: Map<string, KeyTypeNode>;
}
function renderKeyType(
	fields: readonly [string, RecordValue][],
	references: readonly unknown[],
): string {
	const root: KeyTypeNode = { children: new Map() };
	for (const reference of references) {
		const path = (Array.isArray(reference) ? reference : [reference]).map(
			String,
		);
		let node = root;
		for (const segment of path) {
			let child = node.children.get(segment);
			if (!child) {
				child = { children: new Map() };
				node.children.set(segment, child);
			}
			node = child;
		}
		node.field = fieldAtPath(fields, path);
	}
	const render = (node: KeyTypeNode): string => {
		if (node.field) return fieldType(node.field);
		return `Readonly<{ ${[...node.children.entries()]
			.sort(([left], [right]) => compareAscii(left, right))
			.map(
				([key, child]) => `readonly ${JSON.stringify(key)}: ${render(child)};`,
			)
			.join(" ")} }>`;
	};
	return render(root);
}
function embeddedValueType(value: RecordValue): string {
	const options = record(value.options ?? {});
	let type =
		value.kind === "boolean"
			? "boolean"
			: value.kind === "integer"
				? "number"
				: value.kind === "object"
					? embeddedObjectType(record(options.properties))
					: value.kind === "array"
						? `ReadonlyArray<${embeddedValueType(record(options.items))}>`
						: "string";
	if (value.nullable === true) type = `${type} | null`;
	return type;
}
function embeddedObjectType(properties: RecordValue): string {
	return `Readonly<{ ${Object.entries(properties)
		.sort(([left], [right]) => compareAscii(left, right))
		.map(
			([key, child]) =>
				`readonly ${JSON.stringify(key)}: ${embeddedValueType(record(child))};`,
		)
		.join(" ")} }>`;
}

function embeddedFieldType(field: RecordValue): string {
	return embeddedObjectType(record(record(field.options).properties));
}

function collectionFields(
	resource: NormalizedResource,
): [string, RecordValue][] {
	const fields = Object.entries(record(resource.value.fields)) as [
		string,
		RecordValue,
	][];
	for (const augmentation of (resource.value.augmentations ??
		[]) as readonly unknown[]) {
		fields.push(
			...(Object.entries(record(record(augmentation).fields)) as [
				string,
				RecordValue,
			][]),
		);
	}
	return fields.sort(([left], [right]) => compareAscii(left, right));
}

function renderData(resources: readonly NormalizedResource[]): string {
	return resources
		.filter((resource) => resource.kind === "collection")
		.map((resource) => {
			const fields = collectionFields(resource);
			const row = fields
				.map(
					([key, field]) =>
						`readonly ${JSON.stringify(key)}: ${fieldNodeType(field, "Date")};`,
				)
				.join(" ");
			const constraints = record(resource.value.constraints);
			const primary = Object.values(constraints)
				.map(record)
				.find((constraint) => constraint.kind === "primaryKey");
			const key = renderKeyType(
				fields,
				(primary?.fields ?? []) as readonly unknown[],
			);
			return `readonly ${JSON.stringify(resource.name)}: ReadCollection<Readonly<{ ${row} }>, ${key}>;`;
		})
		.join("\n\t\t");
}

function renderCollectionRow(
	resource: NormalizedResource,
	paths?: readonly (readonly string[])[],
	optionalPaths: readonly (readonly string[])[] = [],
): string {
	const selected = paths
		? new Set(paths.filter((path) => path.length === 1).map((path) => path[0]))
		: null;
	const members = collectionFields(resource)
		.filter(([name]) => selected === null || selected.has(name))
		.map(([name, field]) => {
			const optional = optionalPaths.some(
				(path) => path.length === 1 && path[0] === name,
			);
			return `readonly ${JSON.stringify(name)}${optional ? "?" : ""}: ${fieldNodeType(field, "Date")};`;
		})
		.join(" ");
	return `Readonly<{ ${members} }>`;
}

function renderCollectionLifecycleDeclarations(
	resources: readonly NormalizedResource[],
	mutationContract: MutationGeneratedContractV1,
): string {
	const collections = resources.filter(
		(resource) => resource.kind === "collection",
	);
	const byIdentity = new Map(
		collections.map((resource) => [resource.identity, resource]),
	);
	const reads = mutationContract.operations.filter(
		(operation) => operation.member === "get" || operation.member === "list",
	);
	const lifecycleTypes = {
		field: (target: `collection:${string}`, path: readonly string[]) => {
			const collection = byIdentity.get(target);
			const field = collection
				? fieldAtPath(collectionFields(collection), path)
				: undefined;
			if (!field)
				throw new TypeError(
					`unknown lifecycle Field ${target}/${path.join("/")}`,
				);
			return fieldType(field, "Date");
		},
		fieldIdentity: (identity: string) => {
			const marker = "/field:";
			const index = identity.indexOf(marker);
			const collection = byIdentity.get(identity.slice(0, index));
			const field = collection
				? fieldAtPath(
						collectionFields(collection),
						identity.slice(index + marker.length).split("/"),
					)
				: undefined;
			if (!field) throw new TypeError(`unknown lifecycle Field ${identity}`);
			return fieldType(field, "Date");
		},
	};
	const writes = renderGeneratedMutationData(
		{
			...mutationContract,
			operations: mutationContract.operations.filter(
				(operation) =>
					operation.member === "create" || operation.member === "update",
			),
		},
		lifecycleTypes,
	);
	const dataByTarget = new Map<string, string[]>();
	for (const operation of reads) {
		const target = byIdentity.get(operation.target);
		if (!target)
			throw new TypeError(`unknown lifecycle read target ${operation.target}`);
		let member: string;
		if (operation.member === "get") {
			const constraints = record(target.value.constraints);
			const primary = Object.values(constraints)
				.map(record)
				.find((constraint) => constraint.kind === "primaryKey");
			member = `LifecycleReadCollection<${renderCollectionRow(target, operation.selectedFieldPaths, operation.optionalSelectedFieldPaths)}, ${renderKeyType(collectionFields(target), (primary?.fields ?? []) as readonly unknown[])}>`;
		} else {
			if (!operation.dataQuery)
				throw new TypeError(`${operation.identity} has no Data Query`);
			const parameters = operation.dataQuery.parameters
				.map(
					(parameter) =>
						`readonly ${JSON.stringify(parameter.name)}: ${renderDataQueryParameterType(parameter)};`,
				)
				.join(" ");
			const optionalPaths = new Set(
				operation.optionalSelectedFieldPaths.map((path) => path.join("/")),
			);
			const row = renderDataQuerySelection(
				operation.dataQuery,
				lifecycleTypes,
				optionalPaths,
			);
			member = `LifecycleListCollection<Readonly<{ ${parameters} }>, ${row}>`;
		}
		const members = dataByTarget.get(target.name) ?? [];
		members.push(member);
		dataByTarget.set(target.name, members);
	}
	const data = [...dataByTarget.entries()]
		.map(
			([name, members]) =>
				`readonly ${JSON.stringify(name)}: ${members.join(" & ")};`,
		)
		.sort(compareAscii)
		.join(" ");
	const jobAcceptances = renderServerOperationType(
		"Lifecycle Job",
		resources
			.filter(
				(resource) =>
					resource.kind === "job" &&
					record(resource.contract.input).kind === "object",
			)
			.map((resource) => ({
				name: resource.name,
				origin: resource.origin,
				value: `Readonly<{ accept(input: Readonly<{ readonly input: ${renderCodecType(resource.contract.input)}; readonly idempotencyKey: string; readonly notBefore?: Date; }>): Promise<JobRunReceipt<${JSON.stringify(resource.name)}>>; }>`,
			})),
	);
	const entries = collections
		.map((resource) => {
			const row = renderCollectionRow(resource);
			const issues = Object.keys(record(resource.value.issues ?? {}))
				.sort(compareAscii)
				.map(
					(name) =>
						`readonly ${JSON.stringify(name)}: () => CollectionIssueValue;`,
				)
				.join(" ");
			const common = `readonly candidate: ${row}; readonly current: ${row} | null; readonly now: Date; readonly issues: Readonly<{ ${issues} }>;`;
			return `readonly ${JSON.stringify(resource.name)}: Readonly<{ readonly normalize?: (input: Readonly<{ readonly input: Readonly<Partial<${row}>>; }>) => Readonly<Partial<${row}>>; readonly validate?: (input: Readonly<{ ${common} }>) => void; readonly check?: (input: Readonly<{ ${common} readonly ctx: Readonly<{ readonly data: Readonly<GeneratedLifecycleCheckData>; readonly now: Date; }>; }>) => Promise<void>; readonly afterWrite?: (input: Readonly<{ readonly row: ${row}; readonly previous: ${row} | null; readonly ctx: Readonly<{ readonly data: Readonly<GeneratedLifecycleCheckData & GeneratedLifecycleAfterWriteData>; readonly jobs: Readonly<GeneratedLifecycleJobAcceptances>; readonly now: Date; readonly callId: string; }>; }>) => Promise<void>; }>;`;
		})
		.sort(compareAscii)
		.join("\n\t");
	return `export interface LifecycleReadCollection<Row, Key> {
	get<const Select extends Readonly<Partial<Record<keyof Row, true>>>>(input: Readonly<{ readonly key: Key; readonly select: Select & (keyof Select extends never ? never : unknown) & Readonly<Record<Exclude<keyof Select, keyof Row>, never>>; }>): Promise<Readonly<Pick<Row, keyof Select & keyof Row>> | null>;
}

export interface LifecycleListCollection<Input, Row> {
	list(input: Input): Promise<ReadonlyArray<Row>>;
}

export interface GeneratedLifecycleCheckData {
	${data}
}

export interface GeneratedLifecycleAfterWriteData {
	${writes}
}

export type GeneratedLifecycleJobAcceptances = ${jobAcceptances};

export interface GeneratedCollectionLifecycles {
	${entries}
}

export type CollectionLifecycle<Name extends keyof GeneratedCollectionLifecycles> = GeneratedCollectionLifecycles[Name];`;
}

function renderQueries(resources: readonly NormalizedResource[]): string {
	return resources
		.filter((resource) => resource.kind === "query")
		.map((resource) => {
			const contract = resource.contract;
			return `${JSON.stringify(resource.name)}: Readonly<{ input: ${renderCodecType(contract.input)}; output: ${renderCodecType(contract.output)}; handlerOutput: ${renderCodecType(contract.output)}; }>;`;
		})
		.join("\n\t");
}

function renderQueryOperations(
	resources: readonly NormalizedResource[],
): string {
	return renderServerOperationType(
		"Query",
		resources
			.filter((resource) => resource.kind === "query")
			.map((resource) => ({
				name: resource.name,
				origin: resource.origin,
				value: `(input: ${renderCodecType(resource.contract.input)}) => Promise<${renderCodecType(resource.contract.output)}>`,
			})),
	);
}

const factoryNames = [] as const;

export function renderAppContract(
	resources: readonly NormalizedResource[],
	data: unknown,
	schema: unknown,
	sourceRoot: string,
	relational: RelationalGeneratedContractV1,
	mutationContract: MutationGeneratedContractV1,
	realtime: boolean,
): string {
	const sourceModulePath = (logicalPath: string): string => {
		const prefix =
			sourceRoot === "." ? "" : `${sourceRoot.replace(/\/$/, "")}/`;
		const relativePath = logicalPath.startsWith(prefix)
			? logicalPath.slice(prefix.length)
			: logicalPath;
		return `#questpie/source/${relativePath}`;
	};
	const sourceModule = (resource: NormalizedResource): string =>
		sourceModulePath(resource.origin.logicalPath);
	const definitionType = (resource: NormalizedResource): string =>
		`(typeof import(${JSON.stringify(sourceModule(resource))}))[${JSON.stringify(resource.origin.exportName)}]`;
	const context = resources.find(
		(resource) =>
			resource.kind === "context" && resource.origin.packageId === null,
	);
	const applicationServices = resources.filter(
		(resource) =>
			resource.kind === "service" && resource.origin.packageId === null,
	);
	const contextDefinition = context ? definitionType(context) : "never";
	const executionServices = executionServiceResources(resources)
		.map(
			(resource) =>
				`readonly ${JSON.stringify(resource.name)}: ServiceInstance<${definitionType(resource)}>;`,
		)
		.join("\n\t");
	const routeServices = applicationServices
		.sort((left, right) => compareAscii(left.identity, right.identity))
		.map((resource) => {
			const instance = `ServiceInstance<${definitionType(resource)}>`;
			return `readonly ${JSON.stringify(resource.name)}: ${resource.contract.lifetime === "execution" ? `() => Promise<${instance}>` : instance};`;
		})
		.join("\n\t");
	const actionServices = actionServiceResources(resources)
		.map(
			(resource) =>
				`readonly ${JSON.stringify(resource.name)}: ServiceInstance<${definitionType(resource)}>;`,
		)
		.join("\n\t");
	const otherFactories = factoryNames
		.map((name) => `export declare const ${name}: EmptyDefinitionFactory;`)
		.join("\n");
	const fieldByIdentity = (identity: string): RecordValue => {
		const marker = "/field:";
		const offset = identity.indexOf(marker);
		const collectionIdentity = identity.slice(0, offset);
		const path = identity.slice(offset + marker.length).split("/");
		const resource = resources.find(
			(candidate) => candidate.identity === collectionIdentity,
		);
		const field = resource
			? fieldAtPath(collectionFields(resource), path)
			: undefined;
		if (!field) throw new TypeError(`unknown selected Field ${identity}`);
		return field;
	};
	const renderSelection = (
		selection: readonly RelationalGeneratedSelectionV1[],
	): string =>
		`{ ${selection
			.map((selected) => {
				const key = JSON.stringify(String(selected.key));
				if (selected.kind === "field")
					return `${key}${selected.optional ? "?" : ""}: ${fieldType(fieldByIdentity(selected.field))};`;
				return selected.kind === "inverseList"
					? `${key}: readonly ${renderSelection(selected.select)}[];`
					: `${key}: ${renderSelection(selected.select)} | null;`;
			})
			.join(" ")} }`;
	const queryRuns = relational.queries
		.filter((query) => query.identity === null)
		.map((query) => {
			const definition = `(typeof import(${JSON.stringify(sourceModulePath(query.origin.path))}))[${JSON.stringify(query.origin.exportName)}]`;
			const result = `Readonly<{ nodes: Array<${renderSelection(query.select)}>; pageInfo: Readonly<{ endCursor: string | null; hasNextPage: boolean; }>; }>`;
			return `run(plan: ${definition}, input: ${definition}["parameters"]): Promise<${result}>;`;
		})
		.join("\n\t");
	const mutationData = renderGeneratedMutationData(mutationContract, {
		field: (target, path) =>
			fieldType(fieldByIdentity(`${target}/field:${path.join("/")}`), "Date"),
		fieldIdentity: (identity) => fieldType(fieldByIdentity(identity), "Date"),
	});
	const mutationDataByName = renderGeneratedMutationDataByName(
		mutationContract,
		{
			field: (target, path) =>
				fieldType(fieldByIdentity(`${target}/field:${path.join("/")}`), "Date"),
			fieldIdentity: (identity) => fieldType(fieldByIdentity(identity), "Date"),
		},
	);
	const routes = resources
		.filter((resource) => resource.kind === "route")
		.sort((left, right) => compareAscii(left.name, right.name));
	const routeNames =
		routes.length === 0
			? "never"
			: routes.map((resource) => JSON.stringify(resource.name)).join(" | ");
	const directRoutes = routes
		.map(
			(resource) =>
				`readonly ${JSON.stringify(resource.name)}: Readonly<{ direct(input: Readonly<{ request: Request; execution: Readonly<{ principal: Principal }> }>): Promise<Response>; }>;`,
		)
		.join("\n\t");
	const collectionLifecycleDeclarations = renderCollectionLifecycleDeclarations(
		resources,
		mutationContract,
	);
	return `import type { Authority, Codec, CollectionIssueValue, ContextInputOf, ContextResolvedOf, DataFieldDescriptor, DurableRetryDefinition, DurableRunAsDefinition, OperationErrorFactories, OperationErrorMap, Principal, ServiceInstance, TaggedJsonValue } from "questpie";

${renderCoreDataContract(data, schema)}

export interface ReadCollection<Row, Key> {
	get<const Select extends Readonly<Partial<Record<keyof Row, true>>>>(input: Readonly<{ key: Key; select: Select }>): Promise<Readonly<Pick<Row, keyof Select & keyof Row>> | null>;
}

export interface GeneratedData {
	${renderData(resources)}
	${queryRuns}
}

export interface GeneratedMutationData {
	${mutationData}
}

export interface GeneratedMutationDataByName {
	${mutationDataByName}
}

${collectionLifecycleDeclarations}

export interface GeneratedQueries {
	${renderQueries(resources)}
}

${renderMutationDeclarations(resources)}

${renderActionDeclarations(resources)}

export type GeneratedQueryOperations = ${renderQueryOperations(resources)};

export interface QueryContext {
	readonly data: Readonly<GeneratedData>;
	readonly signal: AbortSignal;
}

export interface MutationContext<Name extends keyof GeneratedMutations & keyof GeneratedMutationDataByName> extends Omit<RootExecution, "services"> {
	readonly data: Readonly<GeneratedMutationDataByName[Name]>;
	readonly now: Date;
	readonly callId: string;
	readonly transactionId: string;
	readonly dispatch: Readonly<{
		${renderReactionDispatch(resources)}
	}>;
	readonly jobs: Readonly<GeneratedJobAcceptances>;
}

type ApplicationContextDefinition = ${contextDefinition};
export type AppContextInput = ContextInputOf<ApplicationContextDefinition>;
export type AppResolvedContext = ContextResolvedOf<ApplicationContextDefinition>;

export type ExecutionServices = Readonly<{
	${executionServices}
}>;

export type RouteServices = Readonly<{
	${routeServices}
}>;

export type ActionServices = Readonly<{
	${actionServices}
}>;

export type ExecutionInput = Readonly<{
	principal: Principal;
	context: AppContextInput;
	signal?: AbortSignal;
	deadline?: number;
}>;

export type RootExecution = Readonly<{
	principal: Principal;
	authority: Authority;
	tenant: AppResolvedContext["tenant"];
	values: AppResolvedContext["values"];
	services: ExecutionServices;
	signal: AbortSignal;
	deadline: number | null;
}>;

export interface ActionContext extends Omit<RootExecution, "services"> {
	readonly services: ActionServices;
	readonly queries: GeneratedQueryOperations;
	readonly mutations: GeneratedMutationOperations;
}

type QueryDefinitionBase<Name extends keyof GeneratedQueries> = Readonly<{
	readonly kind: "query";
	readonly identity: \`query:\${Name & string}\`;
	readonly name: Name;
	readonly network: boolean;
}>;

type QueryHandler<Name extends keyof GeneratedQueries> = (input: Readonly<{
	input: GeneratedQueries[Name]["input"];
	ctx: QueryContext;
}>) => GeneratedQueries[Name]["handlerOutput"] | Promise<GeneratedQueries[Name]["handlerOutput"]>;

export type QueryDefinition<Name extends keyof GeneratedQueries> = QueryDefinitionBase<Name> & (Readonly<{
	readonly input: Codec<GeneratedQueries[Name]["input"]>;
	readonly output: Codec<GeneratedQueries[Name]["output"]>;
	readonly handler: QueryHandler<Name>;
}> | Readonly<{ readonly query: unknown; readonly handler: QueryHandler<Name> }>);

export type QueryFactory = <const Name extends keyof GeneratedQueries>(
	definition: Readonly<{
		name: Name;
		network?: boolean;
		input: Codec<GeneratedQueries[Name]["input"]>;
		output: Codec<GeneratedQueries[Name]["output"]>;
		handler(input: Readonly<{
			input: GeneratedQueries[Name]["input"];
			ctx: QueryContext;
		}>): GeneratedQueries[Name]["handlerOutput"] | Promise<GeneratedQueries[Name]["handlerOutput"]>;
	}> | Readonly<{ name: Name; network?: boolean; query: unknown }>,
) => QueryDefinition<Name>;

type EmptyDefinitionFactory = (definition: never) => never;

type RouteSegmentParams<Segment extends string> =
	Segment extends \`:\${infer Name}\` ? Readonly<Record<Name, string>> :
	Segment extends \`*\${infer Name}\` ? Readonly<Record<Name extends "" ? "wildcard" : Name, string>> :
	Readonly<Record<never, never>>;

export type RouteParams<Path extends string> =
	string extends Path ? Readonly<Record<string, string>> :
	Path extends \`\${infer Segment}/\${infer Rest}\`
		? RouteSegmentParams<Segment> & RouteParams<Rest>
		: RouteSegmentParams<Path>;

export type RouteContext<Path extends \`/\${string}\` = \`/\${string}\`> = Readonly<{
	principal: Principal;
	params: RouteParams<Path>;
	services: RouteServices;
	signal: AbortSignal;
	deadline: number;
	execution<Result>(
		input: ExecutionInput,
		use: (execution: RootExecution & Readonly<{ queries: GeneratedQueryOperations; mutations: GeneratedMutationOperations; actions: GeneratedActionOperations; jobs: GeneratedJobAcceptances }>) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
}>;

export type RouteDefinition<
	Name extends ${routeNames},
	Method extends "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT",
	Path extends \`/\${string}\`,
	Credentials extends "application" | "none",
> = Readonly<{
	readonly kind: "route";
	readonly identity: \`route:\${Name}\`;
	readonly name: Name;
	readonly method: Method;
	readonly path: Path;
	readonly policy: Readonly<{ kind: "booleanExpression" }>;
	readonly credentials: Credentials;
	readonly limits: Readonly<{ bodyBytes: number; durationMs: number }>;
	readonly handler: (input: Readonly<{ request: Request; ctx: RouteContext<Path> }>) => Response | Promise<Response>;
}>;

export type RouteFactory = <
	const Name extends ${routeNames},
	const Method extends "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT",
	const Path extends \`/\${string}\`,
	const Credentials extends "application" | "none",
>(definition: Readonly<{
	name: Name;
	method: Method;
	path: Path;
	policy: Readonly<{ kind: "booleanExpression" }>;
	credentials: Credentials;
	limits: Readonly<{ bodyBytes: number; durationMs: number }>;
	handler(input: Readonly<{ request: Request; ctx: RouteContext<Path> }>): Response | Promise<Response>;
}>) => RouteDefinition<Name, Method, Path, Credentials>;

${renderReactionDeclarations(resources, queryRuns)}

${renderJobDeclarations(resources)}

${renderDurableDeclarations()}

export const defineQuery: QueryFactory = ((definition) => Object.freeze({
	...definition,
	...("query" in definition ? {
		handler: (invocation: Readonly<{ input: unknown; ctx: QueryContext }>) =>
			invocation.ctx.data.run(definition.query as never, invocation.input as never) as never,
	} : {}),
	kind: "query" as const,
	identity: \`query:\${definition.name}\` as const,
	network: definition.network === true,
})) as QueryFactory;
${renderMutationFactory()}
${renderActionFactory()}
export const defineRoute: RouteFactory = ((definition) => Object.freeze({
	...definition,
	kind: "route" as const,
	identity: \`route:\${definition.name}\` as const,
})) as RouteFactory;
${otherFactories}

export interface CommittedResultUnavailable extends Error {
	readonly name: "CommittedResultUnavailable";
	readonly code: "COMMITTED_RESULT_UNAVAILABLE";
	readonly retryable: true;
	readonly payload: Readonly<{
		readonly callId: string;
		readonly transactionId: string;
	}>;
}

export interface GeneratedApp {
	fetch(request: Request): Promise<Response>;
	execution<Result>(
		input: ExecutionInput,
		callback: (execution: RootExecution & Readonly<{ queries: GeneratedQueryOperations; mutations: GeneratedMutationOperations; actions: GeneratedActionOperations; jobs: GeneratedJobAcceptances }>) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	readonly durable: GeneratedDurable;
	readonly routes: Readonly<{
		${directRoutes}
	}>;
	close(): Promise<void>;
}

export type CreateAppInput = Readonly<{
	postgres: Readonly<{
		connectionUrl: string;
		directConnectionUrl: string;
	}>;
	${realtime ? "realtime: Readonly<{ hmacKey: Uint8Array }>;" : ""}
	maintenance: Readonly<{ authorize: DurableMaintenanceAuthorization }>;
}>;

export async function createApp(input: CreateAppInput): Promise<GeneratedApp> {
	const application = await import("./internal/application.js");
	return application.createApplication(input);
}
`;
}

export function renderPackageContract(
	packageName: string,
	resources: readonly NormalizedResource[],
): string {
	const services = resources
		.filter((resource) => resource.kind === "service")
		.map(
			(resource) =>
				`readonly ${JSON.stringify(resource.name)}: ServiceInstance<typeof PackageDefinitions[${JSON.stringify(resource.origin.exportName)}]>;`,
		)
		.join("\n\t\t");
	const factories = [
		"defineQuery",
		"defineMutation",
		"defineAction",
		"defineRoute",
		"defineReaction",
		"defineJob",
	]
		.filter((name) => name !== "defineQuery")
		.map((name) => `export declare const ${name}: EmptyDefinitionFactory;`)
		.join("\n");
	return `import type { Codec, ServiceInstance } from "questpie";
import type * as PackageDefinitions from ${JSON.stringify(`${packageName}/questpie`)};

export interface ReadCollection<Row, Key> {
	get(input: Readonly<{ key: Key }>): Promise<Row | null>;
}

export interface PackageData {
	${renderData(resources)}
}

export interface PackageQueries {
	${renderQueries(resources)}
}

export type PackageServices = Readonly<{
	${services}
}>;

export type PackageQueryFactory = <const Name extends keyof PackageQueries>(
	definition: Readonly<{
		name: Name;
		input: Codec<PackageQueries[Name]["input"]>;
		output: Codec<PackageQueries[Name]["output"]>;
		handler(input: Readonly<{
			input: PackageQueries[Name]["input"];
			ctx: Readonly<{ data: PackageData; signal: AbortSignal }>;
		}>): PackageQueries[Name]["output"] | Promise<PackageQueries[Name]["output"]>;
	}>,
) => Readonly<{ kind: "query"; name: Name }>;

type EmptyDefinitionFactory = (definition: never) => never;

export declare const defineQuery: PackageQueryFactory;
${factories}
`;
}
