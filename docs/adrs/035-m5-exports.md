# ADR-035: Background task exports

## Decisions

- **Exports are jobs.** `POST .../exports` queues a row; the worker claims
  queued rows with `SKIP LOCKED`, writes the CSV to object storage and marks
  it ready. Requests return at once however large the project is (up to
  50,000 tasks per file). At most three exports wait per person and project.
- **Policy is checked three times.** Requesting needs the new `task.export`
  project permission (managers and editors; viewers and commenters may read
  tasks but not copy them all out). The worker rechecks the requester's
  access when it runs and fails the job without a file if access is gone.
  Downloading passes the project guard again and is limited to the
  requester; anyone else's export id answers 404.
- **Exports expire.** A file is downloadable for 24 hours through a
  one-minute signed URL (`Content-Disposition: attachment`). After that the
  API answers 410 and the worker deletes the object and marks it expired.
- **Safe spreadsheets.** Cells that a spreadsheet would evaluate as a
  formula (`= + - @`, tab, carriage return) get a leading apostrophe; values
  are quoted per RFC 4180; the file starts with a UTF-8 byte order mark so
  Excel shows Arabic text correctly.
