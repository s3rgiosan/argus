import test from "node:test";
import assert from "node:assert/strict";
import { issueKey, glRepoOf, parseGhSearch, parseGhList, parseGhView, parseGlUser, parseGlProject, parseGlDetail } from "../mods/argus-issues/model.js";

const ghItem = (overrides = {}) => ({
  number: 7,
  title: "Example title",
  url: "https://github.com/example-org/example-repo/issues/7",
  author: { login: "octo-user", name: "Octo User" },
  assignees: [{ login: "octo-user", name: "Octo User" }, { login: "other-user" }],
  labels: [{ name: "bug", color: "d73a4a" }, { name: "help wanted" }],
  commentsCount: 2,
  createdAt: "2026-01-01T10:00:00Z",
  updatedAt: "2026-01-02T10:00:00Z",
  repository: { name: "example-repo", nameWithOwner: "example-org/example-repo" },
  state: "open",
  isPullRequest: false,
  ...overrides,
});

const glNode = (overrides = {}) => ({
  iid: "12",
  title: "Example title",
  webUrl: "https://gitlab.example.com/example-group/example-project/-/issues/12",
  state: "opened",
  reference: "example-group/example-project#12",
  confidential: false,
  createdAt: "2026-01-01T10:00:00Z",
  updatedAt: "2026-01-03T10:00:00Z",
  userNotesCount: 3,
  author: { username: "octo-user", name: "Octo User" },
  assignees: { nodes: [{ username: "octo-user", name: "Octo User" }] },
  labels: { nodes: [{ title: "bug" }] },
  milestone: { title: "Example milestone" },
  ...overrides,
});

test("issueKey is the lower-case host, repo and number", () => {
  assert.equal(issueKey({ host: "GitHub.com", repo: "Example-Org/Repo", number: 3 }), "github.com/example-org/repo#3");
});

test("parseGhSearch reads issues and leaves out pull requests and broken items", () => {
  const raw = JSON.stringify([ghItem(), ghItem({ number: 8, isPullRequest: true }), ghItem({ number: 0 }), ghItem({ repository: { nameWithOwner: "noslash" } }), "junk"]);
  const issues = parseGhSearch(raw);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0], {
    provider: "github",
    host: "github.com",
    repo: "example-org/example-repo",
    number: 7,
    title: "Example title",
    url: "https://github.com/example-org/example-repo/issues/7",
    author: "octo-user",
    authorName: "Octo User",
    assignees: [
      { login: "octo-user", name: "Octo User" },
      { login: "other-user", name: "" },
    ],
    labels: ["bug", "help wanted"],
    state: "open",
    stateReason: null,
    confidential: false,
    comments: 2,
    milestone: null,
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-02T10:00:00Z",
  });
});

test("parseGhSearch refuses output that is not a JSON list", () => {
  assert.throws(() => parseGhSearch("not json"), /unexpected gh output/);
  assert.throws(() => parseGhSearch("{}"), /unexpected gh output/);
});

test("parseGhList takes the repo from the call and reads upper-case states", () => {
  const raw = JSON.stringify([{ ...ghItem(), repository: undefined, commentsCount: undefined, state: "OPEN" }]);
  const [issue] = parseGhList(raw, "example-org/example-repo");
  assert.equal(issue.repo, "example-org/example-repo");
  assert.equal(issue.state, "open");
  assert.equal(issue.comments, null);
});

test("parseGhView reads the body, the closed reason and sorts the comments", () => {
  const raw = JSON.stringify({
    ...ghItem({ state: "CLOSED", stateReason: "NOT_PLANNED", milestone: { title: "Example milestone" } }),
    body: "Example body",
    closedAt: "2026-01-04T10:00:00Z",
    comments: [
      { author: { login: "other-user" }, body: "Second", createdAt: "2026-01-03T10:00:00Z" },
      { author: { login: "octo-user" }, body: "First", createdAt: "2026-01-02T10:00:00Z" },
      { author: { login: "spam-user" }, body: "Buy now", createdAt: "2026-01-02T11:00:00Z", isMinimized: true, minimizedReason: "LOW_QUALITY" },
      { author: { login: "empty-user" }, body: "  ", createdAt: "2026-01-02T12:00:00Z" },
    ],
  });
  const detail = parseGhView(raw, "example-org/example-repo");
  assert.equal(detail.issue.state, "closed");
  assert.equal(detail.issue.stateReason, "not_planned");
  assert.equal(detail.issue.milestone, "Example milestone");
  assert.equal(detail.body, "Example body");
  assert.equal(detail.closedAt, "2026-01-04T10:00:00Z");
  assert.deepEqual(
    detail.comments.map((c) => [c.author, c.body, c.hidden]),
    [
      ["octo-user", "First", null],
      ["spam-user", "", "low quality"],
      ["other-user", "Second", null],
    ],
  );
});

test("glRepoOf reads the project of a full reference", () => {
  assert.equal(glRepoOf("example-group/sub/example-project#12"), "example-group/sub/example-project");
  assert.equal(glRepoOf("#12"), null);
  assert.equal(glRepoOf("project#12"), null);
  assert.equal(glRepoOf(null), null);
});

test("parseGlUser reads the assigned and created lists, with the repo from the reference", () => {
  const raw = JSON.stringify({ data: { assigned: { nodes: [glNode(), glNode({ iid: "x" })] }, created: { nodes: [glNode({ iid: "13", reference: "other-group/other-project#13", state: "locked" })] } } });
  const { assigned, created } = parseGlUser(raw, "gitlab.example.com");
  assert.equal(assigned.length, 1);
  assert.deepEqual(assigned[0], {
    provider: "gitlab",
    host: "gitlab.example.com",
    repo: "example-group/example-project",
    number: 12,
    title: "Example title",
    url: "https://gitlab.example.com/example-group/example-project/-/issues/12",
    author: "octo-user",
    authorName: "Octo User",
    assignees: [{ login: "octo-user", name: "Octo User" }],
    labels: ["bug"],
    state: "open",
    stateReason: null,
    confidential: false,
    comments: 3,
    milestone: "Example milestone",
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-03T10:00:00Z",
  });
  assert.equal(created[0].repo, "other-group/other-project");
  assert.equal(created[0].state, "open");
});

test("GitLab parsers throw the first GraphQL error and refuse a missing project", () => {
  assert.throws(() => parseGlUser(JSON.stringify({ errors: [{ message: "Example error" }] }), "gitlab.example.com"), /Example error/);
  assert.throws(() => parseGlProject(JSON.stringify({ data: { project: null } }), "gitlab.example.com", "example-group/example-project"), /project not found/);
});

test("parseGlProject uses the project path of the call", () => {
  const raw = JSON.stringify({ data: { project: { issues: { nodes: [glNode({ reference: null })] } } } });
  const [issue] = parseGlProject(raw, "gitlab.example.com", "example-group/example-project");
  assert.equal(issue.repo, "example-group/example-project");
});

test("parseGlDetail leaves out system notes, and marks internal notes", () => {
  const notes = (list) => ({ notes: { nodes: list } });
  const raw = JSON.stringify({
    data: {
      project: {
        issue: {
          ...glNode({ state: "closed", confidential: true }),
          description: "Example description",
          closedAt: null,
          discussions: {
            pageInfo: { hasNextPage: false },
            nodes: [
              notes([{ author: { username: "octo-user", name: "Octo User" }, body: "changed the label", createdAt: "2026-01-02T09:00:00Z", system: true, internal: false }]),
              notes([
                { author: { username: "other-user", name: "Other User" }, body: "Later", createdAt: "2026-01-03T10:00:00Z", system: false, internal: true },
                { author: { username: "octo-user", name: "Octo User" }, body: "Earlier", createdAt: "2026-01-02T10:00:00Z", system: false, internal: false },
              ]),
            ],
          },
        },
      },
    },
  });
  const detail = parseGlDetail(raw, "gitlab.example.com", "example-group/example-project");
  assert.equal(detail.issue.state, "closed");
  assert.equal(detail.issue.confidential, true);
  assert.equal(detail.body, "Example description");
  assert.deepEqual(
    detail.comments.map((c) => [c.author, c.name, c.body, c.internal]),
    [
      ["octo-user", "Octo User", "Earlier", false],
      ["other-user", "Other User", "Later", true],
    ],
  );
  assert.equal(detail.commentsNote, null);
});

test("parseGlDetail notes more discussions or more notes in a discussion", () => {
  const reply = (discussions) => JSON.stringify({ data: { project: { issue: { ...glNode(), description: "", discussions } } } });
  const note = { author: { username: "octo-user" }, body: "x", createdAt: "2026-01-02T00:00:00Z", system: false, internal: false };
  const moreThreads = parseGlDetail(reply({ pageInfo: { hasNextPage: true }, nodes: [{ notes: { nodes: [note] } }] }), "gitlab.example.com", "example-group/example-project");
  assert.match(moreThreads.commentsNote ?? "", /GitLab has more comments/);
  const moreNotes = parseGlDetail(reply({ pageInfo: { hasNextPage: false }, nodes: [{ notes: { pageInfo: { hasNextPage: true }, nodes: [note] } }] }), "gitlab.example.com", "example-group/example-project");
  assert.match(moreNotes.commentsNote ?? "", /GitLab has more comments/);
});

test("parseGlDetail refuses a missing issue", () => {
  assert.throws(() => parseGlDetail(JSON.stringify({ data: { project: { issue: null } } }), "gitlab.example.com", "example-group/example-project"), /issue not found/);
});
