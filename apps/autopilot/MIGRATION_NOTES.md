# Autopilot Migration Notes

## Admin UX

Canonical admin-view decisions now live in `ADMIN_VIEW.md`.

Keep this file for migration notes only. Do not duplicate the admin information
architecture here.

## Historical List View Direction

Build one reusable framework/admin `list-view` instead of app-specific task
board or knowledge pages.

The view should support:

- Linear-like task lists with nested rows.
- Folder-like Knowledge browsing.
- Outline levels by field, relation field, relation edge, or path prefix.
- Grouping, columns, sorting, filtering, search, and the existing collection
  table affordances.
- Collection config such as:

```ts
.list(({ v, f }) =>
	v.listView({
		outline: {
			defaultExpanded: "roots",
			levels: [
				{ kind: "field", field: f.status },
				{
					kind: "edge",
					collection: "task_relations",
					parentField: "sourceTask",
					childField: "targetTask",
					where: { relationType: "parent_of" },
					repeat: { maxDepth: 8 },
				},
			],
		},
		columns: [f.title, f.priority, f.updatedAt],
		defaultSort: { field: f.updatedAt, direction: "desc" },
	}),
)
```

For Knowledge, the same view should be configured folder-style, not implemented
as a separate page:

```ts
.list(({ v, f }) =>
	v.listView({
		outline: {
			defaultExpanded: "roots",
			levels: [
				{ kind: "field", field: f.scopeType },
				{ kind: "relation-field", relation: f.project },
				{
					kind: "path",
					field: f.path,
					separator: "/",
					syntheticFolders: true,
					repeat: true,
				},
			],
		},
		columns: [f.title, f.kind, f.scopeType, f.updatedAt],
		defaultSort: { field: f.path, direction: "asc" },
	}),
)
```

Keep the old Autopilot/operator-web design intent: dense, Linear-like,
operator-first, nested where useful. Generalize the capability in the admin
framework so future collections can reuse it.
