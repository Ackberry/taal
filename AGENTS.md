# Working on Taal

Use `rules.md` as the source of truth for confirmed product behavior. GitHub issues track decisions and changes. Product implementation starts when the owner asks for it. Language, framework, and source-code naming conventions will be defined when we choose the stack.

## Issues

- Search for an existing issue before opening one. Give each issue one decision or one outcome that can be reviewed independently.
- Title issues `<type>(<scope>): <summary>`. Use `feat` for new behavior, `fix` for a defect, `docs` for documentation, `chore` for maintenance, and `decision` for a product or architecture question. Use an imperative summary such as `feat(events): add reference images`.
- For work, describe the current behavior, proposed behavior, and observable acceptance criteria. Include reproduction steps for defects and link the relevant rule, issue, or PR when there is one.
- For decisions, record the current rule, the question to settle, and what counts as resolution. Use `defer` for intentionally postponed decisions or work. Record the behavior to use in the meantime and leave the issue open. Remove `defer` when the owner brings the item back into scope. Approved work on the interim behavior can link to the deferred issue.
- Use sanitized examples in public issues and repository changes. Keep credentials, guest information, invite links, and private event details out of them.

## Branches and naming

- Start from the latest `origin/main`. Commit and push directly to `main` for routine changes. Open a pull request only if the owner asks for one.
- If the owner requests a separate branch, name issue branches `<type>/<issue-number>-<short-slug>`, such as `feat/24-event-reference-images`. For changes without an issue, use `<type>/<short-slug>`, such as `docs/update-workflow`.
- Use lowercase kebab-case for branch slugs and new project documentation filenames. Keep conventional filenames such as `AGENTS.md` and `README.md`.
- Use short, stable scopes that describe the area changed. Start with `auth`, `events`, `rsvp`, `announcements`, `playlist`, `spotify`, `repo`, or `ci`. Use `playlist` for tracklist behavior and `spotify` for the integration. Use the same scope vocabulary in issues and commits.

## Commits and pushes

- Write commits as `<type>(<scope>): <imperative summary>`. Use `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, or `chore` as appropriate. For example, `docs(rsvp): record interim cancellation behavior`. Use `decision` for issue titles. Use `docs` for commits that record a decision.
- Keep commits focused. Add a body when the reason or tradeoff needs explanation. Use `Refs #12` to link related work when helpful.
- Review the diff and run applicable checks before pushing to `main`. If `main` has advanced, incorporate the remote changes and verify the result before pushing again.

Scoped titles were adapted from [KHI’s pull request and commit history](https://github.com/GoogleCloudPlatform/khi/pulls?q=is%3Apr+is%3Aclosed).
