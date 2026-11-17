# ADR-059: Label-scoped guest access (M9)

## Context

The backlog lists fine-grained, attribute-based access control. The most
requested case is sharing part of a private project with a client or
contractor: they should see the tasks meant for them and nothing else.
Guests already need explicit project membership and are capped at
commenter (ADR-018); this adds an attribute rule on top.

## Decisions

- **Rule.** A guest's project membership can carry up to 20 label ids
  (`project_memberships.label_scope`). The guest then sees only tasks
  carrying at least one of them; an empty list shows nothing; NULL keeps
  the role's normal access. Scopes only ever narrow, and only guests can
  be scoped (400 for anyone else, and the resolver ignores a scope if the
  person stops being a guest). Labels must belong to the organization.
- **Set with the role:** `PUT .../members/:userId` takes `labelIds`
  (array to set, null to clear, omitted to keep). Changes are audited.
- **One predicate, every read path.** The project guard puts the scope on
  the project context, and a shared SQL condition (`label-scope.ts`) is
  added wherever a task is read for the caller: the task list (and so
  board, table, calendar and timeline), task details, comments, history,
  attachments (list and by id), time, dependencies (hidden blockers are
  left out), presence, milestone counts and search. Hidden tasks answer
  404, like tasks that do not exist.
- **Aggregates.** Project analytics answer 403 for scoped guests rather
  than describing work they cannot see.
- **Notifications and mentions.** The notifier skips scoped guests for
  tasks outside their labels, and a scoped guest cannot be mentioned on
  such a task (400), so titles never reach them by email.
- **Not covered:** live-update envelopes still carry the ids of changed
  tasks (never titles or content, ADR-029), which tells a scoped guest that
  something changed; the browser refetches through the scoped list. A
  management screen for project members, scopes included, is still API
  only, as project roles are.

## Gates

`tests/integration/guest-scope.test.ts`: validation (guests only, known
labels), the list, every by-number read path and comment creation
returning 404 for hidden tasks, a hidden blocker left out, search, milestone
counts, analytics refused, mentions refused, assignment notifications on
hidden tasks suppressed, and clearing or keeping the scope.
