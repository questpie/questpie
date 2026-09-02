export interface OperationDescription<Input, Output> {
	readonly summary: string;
	readonly description?: string;
	readonly examples?: readonly Readonly<{
		input: Input;
		output?: Output;
	}>[];
}
