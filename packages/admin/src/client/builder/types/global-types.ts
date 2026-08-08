/**
 * Global Builder Types
 */

import type { ComponentReference } from "../../../server/augmentation/index.js";
import type { I18nText } from "../../i18n/types.js";
import type { Admin } from "../admin";
import type { IconComponent } from "./common";

export interface GlobalBuilderState<TAdminApp extends Admin<any> = Admin<any>> {
	readonly name: string;
	readonly "~adminApp": TAdminApp;
	/** Display label - supports inline translations */
	readonly label?: I18nText;
	/** Description - supports inline translations */
	readonly description?: I18nText;
	readonly icon?: IconComponent | ComponentReference;
	readonly fields?: Record<string, any>;
	readonly form?: any;
}
