export type {
	CodegenPlugin,
	CodegenResult,
	CrossTargetValidator,
	CategoryDeclaration,
	CodegenTargetGenerateContext,
	CodegenTargetContribution,
	CodegenTargetOutput,
	DiscoveredFile,
	DiscoverPattern,
	DiscoveryResult,
	MultiTargetCodegenResult,
	ProjectionError,
	ResolvedTarget,
	ScaffoldConfig,
	ScaffoldContext,
	SingletonFactory,
	RegistryExtension,
	BuilderFactory,
	CodegenContext,
	CodegenOptions,
	CallbackParamDefinition,
} from "#questpie/cli/codegen/types.js";

export {
	categoryRecordEntry,
	categoryTypeEntry,
	importStatement,
	safeKey,
	sortedValues,
	sourceBasename,
} from "#questpie/cli/codegen/category-emit.js";
// A target that brings its own `generate` runs in module mode too, and there it
// has to emit a module definition rather than app output. Without this export a
// custom generator has no way to produce that shape.
export {
	generateModuleTemplate,
	type ModuleTemplateOptions,
	type ModuleTemplateResult,
} from "#questpie/cli/codegen/module-template.js";
