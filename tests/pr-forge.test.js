import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIST_LIMIT,
  limitNote,
  GH_LIST_FIELDS,
  GH_VIEW_FIELDS,
  GL_DETAIL_QUERY,
  GL_MR_FIELDS,
  GL_PROJECT_QUERY,
  GL_USER_QUERY,
  fetchRef,
  ghListArgs,
  ghLoginArgs,
  ghSearchArgs,
  ghViewArgs,
  ghThreadsArgs,
  GH_THREADS_QUERY,
  glabArgs,
} from "../mods/argus-pull-requests/forge.js";

test("ghLoginArgs", () => {
  assert.deepEqual(ghLoginArgs(), ["api", "user", "--jq", ".login"]);
});
test("ghSearchArgs", () => {
  assert.deepEqual(ghSearchArgs("needsReview"), ["search", "prs", "--review-requested=@me", "--state=open", "--archived=false", "--limit", "100", "--json", "number,url"]);
  assert.deepEqual(ghSearchArgs("mine", "octo-user"), ["search", "prs", "--author=octo-user", "--state=open", "--archived=false", "--limit", "100", "--json", "number,url"]);
  assert.throws(() => ghSearchArgs("mine"));
});
test("ghListArgs / ghViewArgs", () => {
  assert.deepEqual(ghListArgs("example-org/example-repo"), ["pr", "list", "--repo", "example-org/example-repo", "--state", "open", "--limit", "100", "--json", GH_LIST_FIELDS]);
  assert.deepEqual(ghViewArgs("example-org/example-repo", 7), ["pr", "view", "7", "--repo", "example-org/example-repo", "--json", GH_VIEW_FIELDS]);
});
test("glabArgs passes the host, the query and string variables", () => {
  assert.deepEqual(glabArgs("gitlab.example.com", GL_DETAIL_QUERY, { path: "example-group/example-project", iid: "12" }),
    ["api", "graphql", "--hostname", "gitlab.example.com", "-f", `query=${GL_DETAIL_QUERY}`, "-f", "path=example-group/example-project", "-f", "iid=12"]);
});
test("queries ask for the fields the parsers read", () => {
  for (const f of ["iid", "webUrl", "draft", "sourceBranch", "targetBranch", "updatedAt", "detailedMergeStatus", "conflicts", "approvedBy", "headPipeline", "targetProject"]) assert.match(GL_MR_FIELDS, new RegExp(`\\b${f}\\b`));
  assert.match(GL_USER_QUERY, /reviewRequestedMergeRequests\(state: opened, first: 100\)/);
  assert.match(GL_USER_QUERY, /authoredMergeRequests\(state: opened, first: 100\)/);
  assert.match(GL_PROJECT_QUERY, /project\(fullPath: \$path\)/);
  for (const f of ["description", "jobs", "reviewers", "mergeRequestInteraction", "notes", "system"]) assert.match(GL_DETAIL_QUERY, new RegExp(`\\b${f}\\b`));
});
test("fetchRef", () => {
  assert.equal(fetchRef("github", 7), "refs/pull/7/head");
  assert.equal(fetchRef("gitlab", 12), "refs/merge-requests/12/head");
});

test("LIST_LIMIT is the 100 every list and search asks for", () => {
  assert.equal(LIST_LIMIT, 100);
  assert.ok(ghListArgs("o/r").includes(String(LIST_LIMIT)));
  assert.ok(ghSearchArgs("needsReview").includes(String(LIST_LIMIT)));
  assert.ok(GL_PROJECT_QUERY.includes(`first: ${LIST_LIMIT}`));
  assert.ok(GL_USER_QUERY.includes(`first: ${LIST_LIMIT}`));
});

test("limitNote: a note only when a list reached the limit", () => {
  assert.equal(limitNote("pull requests of example-org/example-repo", 100), "Showing the first 100 pull requests of example-org/example-repo.");
  assert.equal(limitNote("merge requests", 101), "Showing the first 100 merge requests.");
  assert.equal(limitNote("pull requests", 99), null);
  assert.equal(limitNote("pull requests", 0), null);
  assert.equal(limitNote("pull requests", 3, 3), "Showing the first 3 pull requests.");
});

test("detail reads ask for the head sha", () => {
  assert.ok(GH_VIEW_FIELDS.split(",").includes("headRefOid"));
  assert.match(GL_DETAIL_QUERY, /diffHeadSha squashOnMerge/);
});

test("GL_DETAIL_QUERY reads discussions and the squash lock, not notes", () => {
  assert.match(GL_DETAIL_QUERY, /discussions\(first: 100\)/);
  assert.match(GL_DETAIL_QUERY, /squashReadOnly/);
  assert.match(GL_DETAIL_QUERY, /position \{ filePath newLine oldLine \}/);
  assert.doesNotMatch(GL_DETAIL_QUERY, /notes\(first: 100\) \{ nodes \{ author/);
});

test("ghThreadsArgs asks GraphQL for the review threads of one pull request", () => {
  assert.deepEqual(ghThreadsArgs("example-org/example-repo", 12), [
    "api", "graphql", "-f", `query=${GH_THREADS_QUERY}`, "-f", "owner=example-org", "-f", "name=example-repo", "-F", "number=12",
  ]);
  assert.match(GH_THREADS_QUERY, /reviewThreads\(first: 100\) \{ nodes \{ isResolved path line originalLine comments\(first: 50\)/);
});

test("the detail reads ask for display names", () => {
  assert.match(GH_THREADS_QUERY, /participants\(first: 100\) \{ nodes \{ login name \} \}/);
  assert.match(GL_DETAIL_QUERY, /author \{ username name \} body createdAt system position/);
});
