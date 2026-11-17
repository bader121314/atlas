# ADR-034: Attachments

## Decisions

- **Direct upload to S3-compatible storage.** The API records a pending
  attachment and returns a presigned `PUT` URL valid for five minutes, bound
  to the declared content type (a different `Content-Type` fails the
  signature). File bytes never pass through the API. Storage keys are
  `{org}/{project}/{task}/{attachment}`; display names are cleaned of paths
  and control characters and are never used in keys.
- **SigV4 written with node:crypto.** No SDK can be installed here, and query
  signing is small. The implementation reproduces the AWS documentation
  example exactly (unit test). The server's own HEAD, ranged GET and DELETE
  also use one-minute presigned URLs. Tests run against a small in-process
  S3 stand-in that verifies the same signatures.
- **Nothing is downloadable until checked.** After the upload the browser
  calls `complete`: the object must exist with the declared size (otherwise
  it is deleted and rejected). It is then `quarantined`. A worker loop reads
  the first 64 KB, checks the magic bytes against an allowlist (PNG, JPEG,
  GIF, WebP, PDF, UTF-8 text and CSV) and runs the malware scanner; a
  mismatch or a finding rejects the file and deletes the object. Only `clean`
  files get a download link: a 302 to a one-minute presigned `GET` that
  forces `Content-Disposition: attachment` and the checked content type, so
  an uploaded file can never render as a page on any origin of ours.
- **The scanner is a stub.** It detects the EICAR test file; deployment
  replaces it with ClamAV (or a storage-provider scan) behind the same
  function. The quarantine flow is real and tested.
- **Limits:** 10 MB per file, 20 per task. Abandoned pending uploads are
  removed after an hour.
- **Permissions:** anyone who can read the task can list and download;
  editors can upload; the uploader or a project manager can delete.
- Without storage settings (`STORAGE_ENDPOINT`, `STORAGE_BUCKET`,
  `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`), attachment writes answer 503
  and the rest of Atlas works normally.
