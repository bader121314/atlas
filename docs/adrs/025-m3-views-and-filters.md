# ADR-025: Table and calendar views, filters and saved views

## Decisions

- **Four layouts over one task list.** Board, list, table and calendar all
  render the same filtered task set, so switching layouts never changes which
  tasks are shown (the M3 exit asks for equivalent filtered results across
  views).
- **Filtering is server-side, sorting is client-side.** Filters (status,
  assignee, priority, label, milestone) go to the API, which already enforces
  access and paginates by task number. The table sorts the loaded set in the
  browser; tasks without a value (no due date, unassigned) sort last. This
  keeps keyset pagination simple and is adequate for project-sized lists
  (the web loads up to 2,000 tasks); server-side sort is a later optimization.
- **Calendar by due date** shows one month at a time in UTC days, with a
  count of tasks that have no due date.
- **Saved views** store a name, layout, filters and sort as validated JSON
  (`viewConfigSchema`, strict). Private views are visible only to their
  owner; shared views to everyone who can read the project. Names are unique
  per owner and project ignoring case; 50 views per person per project.
  Owners delete their views; project managers may delete shared ones.
  Someone else's private view answers 404. Stored configs are re-validated
  when read, so a schema change cannot send malformed configs to clients.
