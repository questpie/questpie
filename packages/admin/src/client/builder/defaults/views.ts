/**
 * Built-in View Definitions
 */

import FormView from "../../views/collection/form-view.js";
import TableView from "../../views/collection/table-view.js";
import { editView, listView } from "../view/view";

/**
 * Table list view
 */
const tableView = listView("table", { component: TableView });

/**
 * Form edit view
 */
const formView = editView("form", { component: FormView });

/**
 * All built-in views
 */
export const builtInViews = {
	table: tableView,
	form: formView,
} as const;
