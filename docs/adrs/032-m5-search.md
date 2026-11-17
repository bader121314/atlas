# ADR-032: Full-text search

## Decisions

- **PostgreSQL full-text search, no separate engine.** Generated `tsvector`
  columns on `tasks` (title weighted above description) and
  `task_comments`, each with a GIN index. They stay correct inside the same
  transaction as every edit, and there is no second system to keep in sync
  or secure.
- **The `simple` configuration.** It lowercases and splits on word
  boundaries without stemming, so Arabic, English and mixed text behave the
  same. Stemming per language can come later with a language setting.
- **Prefix search built from words only.** The query keeps letters and
  digits in any script, makes every word required and a prefix (`surv` finds
  "survey"), and drops everything else, so user input can never inject
  tsquery operators. A task key such as `NW-12` jumps straight to that task.
- **Access is part of the query.** Every query is filtered by organization
  and joined to the projects the caller can read, using the same rule as the
  project guard (owners and admins see all projects; members see
  organization-wide projects and those they belong to; guests only those
  they belong to). Private projects never show up for people outside them;
  deleted comments are not searched.
- **Ranking:** exact key match first, then title and description matches by
  rank, then comment matches; at most 30 results.

## Consequences

- The GIN indexes are global; the organization filter runs on the matched
  rows. At large scale, partitioning or a composite index (`btree_gin`)
  keeps plans tenant-scoped; not needed at current sizes.
