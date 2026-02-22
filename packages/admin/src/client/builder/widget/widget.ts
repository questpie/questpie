/**
 * Widget Builder
 *
 * Defines dashboard widgets.
 */

import type { SetProperty } from "questpie/shared";
import type { MaybeLazyComponent } from "../types/common";

export interface WidgetDefinition<
	TName extends string = string,
	TConfig = any,
> {
	readonly name: TName;
	readonly component: any;
	readonly "~config"?: TConfig;
}

export interface WidgetBuilderState {
	readonly name: string;
	readonly "~config": any;
	readonly component: any;
}

export class WidgetBuilder<TState extends WidgetBuilderState> {
	constructor(public readonly state: TState) {}

	$config<TNewConfig>(
		config: TNewConfig,
	): WidgetBuilder<SetProperty<TState, "~config", TNewConfig>> {
		return new WidgetBuilder({
			...this.state,
			"~config": config,
		} as any);
	}
}

/**
 * Create a dashboard widget
 */
export function widget<
	TName extends string,
	TComponent extends MaybeLazyComponent,
>(
	name: TName,
	config: { component: TComponent },
): WidgetBuilder<{
	name: TName;
	"~config": any;
	component: TComponent;
}> {
	return new WidgetBuilder({
		name,
		"~config": {},
		component: config.component,
	} as any);
}
