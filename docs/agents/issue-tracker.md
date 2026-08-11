# Issue tracker: GitHub

Issues, framework specs, API design tickets, and grilling tickets live in
GitHub Issues for `questpie/questpie`.

Use the `gh` CLI from this repository.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body-file <file>`
- Label: `gh issue edit <number> --add-label "..."`
- Close: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`.

## Pull requests as request surface

PRs as a request surface: no.

Pull requests are implementation and review surfaces. They are not substitutes
for framework design issues or specifications.

## Publishing rules

When a skill says to publish a spec or ticket, create a GitHub Issue.

When a skill says to fetch a ticket, read its body, comments, labels, and linked
dependencies.

## Design maps

A large design effort uses one map issue with linked child issues.

- Map label: `wayfinder:map`
- Child labels: `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`
- Use GitHub sub-issues and native issue dependencies when available.
- A ticket is ready only when all blocking issues are closed.
- Claim a ticket by assigning it before implementation.
- Record resolved decisions in the issue before closing it.
