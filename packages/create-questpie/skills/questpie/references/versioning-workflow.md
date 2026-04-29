# Versioning & Workflow

Use versioning for history and restore. Add workflow when content needs named publishing stages such as `draft`, `review`, and `published`.

## Configure Workflow

```ts
import { collection } from "#questpie/factories";

export const pages = collection("pages")
	.fields(({ f }) => ({
		title: f.text(255).required().localized(),
		slug: f.text(255).required(),
		content: f.blocks().localized(),
	}))
	.options({
		versioning: {
			enabled: true,
			maxVersions: 50,
			workflow: {
				initialStage: "draft",
				stages: {
					draft: {
						label: "Draft",
						transitions: ["review", "published"],
					},
					review: {
						label: "In review",
						transitions: ["draft", "published"],
					},
					published: {
						label: "Published",
						transitions: ["draft"],
					},
				},
			},
		},
	});
```

`workflow: true` is the shorthand for the default `draft` and `published` stages. Object stages are used when outgoing transitions must be explicit. If `transitions` is omitted, a stage can transition to any configured stage; if `transitions: []` is set, the stage has no outgoing transitions.

After enabling versioning or workflow on an existing collection, generate and commit a migration. Workflow snapshots need `{collection}_versions` and, for localized fields, `{collection}_i18n_versions`.

## Reading Stages

Reads without `stage` use the working stage, normally the initial stage:

```ts
const draft = await collections.pages.findOne({
	where: { slug: "about" },
});
```

Read the published snapshot explicitly for public pages:

```ts
const page = await collections.pages.findOne({
	where: { slug: "about" },
	stage: "published",
});
```

Draft preview routes usually branch on the admin draft-mode cookie: draft mode reads the working stage, public mode reads `stage: "published"`.

## Transitioning

```ts
await collections.pages.transitionStage({
	id: "page_123",
	stage: "published",
});

await client.collections.pages.transitionStage({
	id: "page_123",
	stage: "published",
});
```

A transition validates that workflow is enabled, the target stage exists, the graph allows the move, and `access.transition` allows the user. If `access.transition` is omitted, QUESTPIE falls back to `access.update`.

Transitioning creates a version snapshot at the target stage. It does not mutate the working draft row, so editors can keep changing the draft after publishing.

## Scheduled Transitions

Admin transition dialogs can pass a future `scheduledAt`. Scheduled transitions require a queue adapter because the core module publishes a delayed scheduled-transition job.

```ts
await client.collections.pages.transitionStage({
	id: "page_123",
	stage: "published",
	scheduledAt: new Date("2026-05-01T09:00:00Z"),
});
```

## Hooks

```ts
.hooks({
	beforeTransition: ({ data, fromStage, toStage }) => {
		if (toStage === "published" && !data.title) {
			throw new Error("Cannot publish without a title");
		}
	},
	afterTransition: async ({ data, toStage, queue }) => {
		if (toStage === "published") {
			await queue.notifySubscribers.publish({ pageId: data.id });
		}
	},
})
```

Hook context includes AppContext services plus `data`, `fromStage`, `toStage`, `recordId` for collections, `locale`, `accessMode`, and optional `scheduledAt`.

## Admin And Preview

When a collection/global has workflow:

- The form toolbar shows transition actions based on the current stage and configured outgoing transitions.
- The history sidebar shows stage metadata on versions.
- Successful transitions invalidate queries so the form and history refresh.
- In the Visual Edit Workspace, stage transitions trigger `FULL_RESYNC` so the iframe discards its local draft and re-runs the loader against the new stage snapshot.
