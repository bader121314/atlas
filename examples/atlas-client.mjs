// A small Atlas API client for scripts, with no dependencies (Node 18+).
// Create a token on your organization page, then:
//
//   ATLAS_URL=https://atlas.example/api ATLAS_TOKEN=atl_... \
//     node examples/atlas-client.mjs my-org NW "Check the buoys"
//
// The API is described in contracts/openapi.yaml; tokens can read and,
// with the tasks:write scope, change tasks (ADR-037).

export class AtlasClient {
  /** @param {{ baseUrl: string, token: string, fetch?: typeof fetch }} options */
  constructor({ baseUrl, token, fetch: fetcher = globalThis.fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.fetch = fetcher;
  }

  async request(method, path, body) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      // Errors are RFC 9457 problem details.
      const error = new Error(data?.title ?? `HTTP ${response.status}`);
      error.status = response.status;
      error.problem = data;
      throw error;
    }
    return data;
  }

  /** Tasks of a project, following keyset pagination to the end. */
  async *tasks(org, project, filters = {}) {
    let after;
    for (;;) {
      const query = new URLSearchParams({
        ...filters,
        limit: '100',
        ...(after ? { after: String(after) } : {}),
      });
      const page = await this.request(
        'GET',
        `/organizations/${org}/projects/${project}/tasks?${query}`,
      );
      yield* page.tasks;
      if (page.nextCursor === null || page.nextCursor === undefined) return;
      after = page.nextCursor;
    }
  }

  createTask(org, project, task) {
    return this.request(
      'POST',
      `/organizations/${org}/projects/${project}/tasks`,
      task,
    );
  }

  comment(org, project, number, body) {
    return this.request(
      'POST',
      `/organizations/${org}/projects/${project}/tasks/${number}/comments`,
      { body },
    );
  }

  search(org, q) {
    return this.request(
      'GET',
      `/organizations/${org}/search?q=${encodeURIComponent(q)}`,
    );
  }
}

// Run as a script: create a task and list the project's open ones.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [org, project, title] = process.argv.slice(2);
  const client = new AtlasClient({
    baseUrl: process.env.ATLAS_URL,
    token: process.env.ATLAS_TOKEN,
  });
  if (title) {
    const task = await client.createTask(org, project, { title });
    console.log(`Created ${task.key}`);
  }
  for await (const task of client.tasks(org, project)) {
    console.log(`${task.key}\t${task.state.label}\t${task.title}`);
  }
}
