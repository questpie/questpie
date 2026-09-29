# Autopilot marketing media handoff

The `/autopilot` page deliberately ships with neutral, correctly sized media slots. Replace them only with captures from the release candidate. Do not recreate the interface for marketing.

## Files to prepare

Put the final files in `apps/docs/public/media/autopilot/`.

| Slot             | Filename                                   | Capture                                                                                                                                              |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero workflow    | `workflow.webm` and `workflow-poster.webp` | 12–18 second silent loop: create or assign one task, show agent progress, stop at one approval, then show completion. Record at 1440×1080 or larger. |
| Shared queue     | `work-queue.webp`                          | A real queue containing both people and agents, clear owners and statuses, and one genuine blocker. Export at 1600×1100 or larger.                   |
| Approval         | `approval.webp`                            | A consequential proposal showing source context, the exact intended change and approve/reject controls. Export at 1920×1200 or larger.               |
| Activity history | `activity-history.webp`                    | The completed run with agent actions and human decisions in one readable history. Export at 1600×1100 or larger.                                     |

## One coherent demo story

Use the same staging workspace and the same task in every capture. A good sequence is:

1. A person assigns a recurring operational task.
2. The agent reads the records or files needed for that task.
3. Progress appears in the shared queue.
4. A consequential change pauses for approval.
5. The person approves or rejects it.
6. The final result and full history remain attached to the task.

Use real staging data that is safe to publish. Redact personal information; do not replace it with invented customer names, revenue, testimonials or performance metrics.

## Recording rules

- Use the final production theme, browser scale and navigation.
- Hide bookmarks, extensions, tokens, localhost URLs and personal notifications.
- Keep the cursor still unless it explains an action. Do not add decorative zooms.
- Do not splice out meaningful waits if the page makes a speed claim.
- Prefer WebM to GIF. Keep the hero video under 8 MB if practical and include a static poster.
- No autoplay audio. Caption the staging build and capture month when the real files are wired in.
- Check the page at 1280 px and 390 px after every replacement; media must use the existing frame without changing its aspect ratio.

## Wiring the files

In `src/components/marketing/autopilot.tsx`, add these props to the matching `ProductMedia` calls:

```text
Hero:             src="/media/autopilot/workflow.webm"
                  poster="/media/autopilot/workflow-poster.webp"
                  kind="video"
Shared queue:     src="/media/autopilot/work-queue.webp"
Approval:         src="/media/autopilot/approval.webp"
Activity history: src="/media/autopilot/activity-history.webp"
```

The hero video intentionally waits for user playback. Do not add autoplay without also respecting `prefers-reduced-motion`.
