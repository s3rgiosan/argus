import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THREADS_LIMIT_NOTE, ghCheckList, mergeThreads, parseGhDetail, parseGhList, parseGhSearch, parseGhThreads, parsePrUrl, prKey, summarize } from "../mods/argus-pull-requests/model.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const repo = "example-org/example-repo";

test("parseGhList maps every PR", () => {
  const prs = parseGhList(fixture("pr-gh-list.json"), repo);
  assert.equal(prs.length, 4);
  const [a, b, c, d] = prs;
  assert.deepEqual(a.checks, { passed: 3, failed: 0, running: 0, total: 3 });
  assert.equal(a.reviewDecision, "approved");
  assert.equal(a.mergeable, "mergeable");
  assert.equal(a.state, "open");
  assert.equal(a.headRef, "feature/one");
  assert.equal(a.baseRef, "main");
  assert.equal(a.author, "octo-user");
  assert.equal(a.host, "github.com");
  assert.equal(a.provider, "github");
  assert.equal(a.repo, repo);
  assert.equal(a.number, 101);
  assert.equal(a.localPath, null);
  assert.equal(a.isDraft, false);
  assert.deepEqual(b.checks, { passed: 0, failed: 1, running: 1, total: 2 });
  assert.equal(b.reviewDecision, "review_required");
  assert.equal(b.mergeable, "blocked");
  assert.deepEqual(c.checks, { passed: 0, failed: 0, running: 1, total: 1 });
  assert.equal(c.reviewDecision, null);
  assert.equal(c.mergeable, "unknown");
  assert.equal(d.isDraft, true);
  assert.equal(d.reviewDecision, "changes_requested");
  assert.equal(d.mergeable, "conflicting");
  assert.equal(d.checks.total, 0);
});

test("state maps merged and closed", () => {
  const raw = JSON.parse(fixture("pr-gh-list.json"));
  raw[0].state = "MERGED";
  raw[1].state = "CLOSED";
  const [a, b] = parseGhList(JSON.stringify(raw), repo);
  assert.equal(a.state, "merged");
  assert.equal(b.state, "closed");
});

test("ghCheckList maps every conclusion and status", () => {
  const run = (conclusion, status = "COMPLETED") => ({ name: "x", status, conclusion });
  for (const c of ["SUCCESS", "NEUTRAL", "SKIPPED"]) assert.equal(ghCheckList([run(c)])[0].state, "passed", c);
  for (const c of ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]) {
    assert.equal(ghCheckList([run(c)])[0].state, "failed", c);
  }
  assert.equal(ghCheckList([run("", "IN_PROGRESS")])[0].state, "running");
  assert.equal(ghCheckList([run("", "QUEUED")])[0].state, "running");
  for (const s of ["ERROR", "FAILURE"]) assert.equal(ghCheckList([{ context: "c", state: s }])[0].state, "failed", s);
  for (const s of ["PENDING", "EXPECTED"]) assert.equal(ghCheckList([{ context: "c", state: s }])[0].state, "running", s);
  assert.equal(ghCheckList([{ context: "c", state: "SUCCESS" }])[0].state, "passed");
  assert.deepEqual(ghCheckList([{ foo: 1 }, null, "x"]), []);
  assert.deepEqual(ghCheckList(null), []);
  assert.deepEqual(ghCheckList([{ context: "ci/example", state: "SUCCESS" }]), [{ name: "ci/example", state: "passed", url: null }]);
  // Only web links are kept.
  assert.equal(ghCheckList([{ context: "c", state: "SUCCESS", targetUrl: "javascript:alert(1)" }])[0].url, null);
});

test("summarize counts states", () => {
  assert.deepEqual(
    summarize([{ name: "a", state: "passed" }, { name: "b", state: "failed" }, { name: "c", state: "running" }, { name: "d", state: "passed" }]),
    { passed: 2, failed: 1, running: 1, total: 4 },
  );
});

test("parseGhSearch reads host, repo and number", () => {
  assert.deepEqual(parseGhSearch(fixture("pr-gh-search.json")), [
    { host: "github.com", repo: "example-org/example-repo", number: 101 },
    { host: "github.com", repo: "example-org/other-repo", number: 7 },
  ]);
  assert.throws(() => parseGhSearch("nope"), /unexpected gh output/);
});

test("parsePrUrl reads GitHub and GitLab URLs", () => {
  assert.deepEqual(parsePrUrl("https://github.com/example-org/example-repo/pull/5"), { host: "github.com", repo: "example-org/example-repo", number: 5 });
  assert.deepEqual(
    parsePrUrl("https://gitlab.example.com/example-group/example-sub/example-project/-/merge_requests/12"),
    { host: "gitlab.example.com", repo: "example-group/example-sub/example-project", number: 12 },
  );
  assert.equal(parsePrUrl("https://github.com/example-org/example-repo/issues/5"), null);
  assert.equal(parsePrUrl("nope"), null);
});

test("prKey is lower-case", () => {
  assert.equal(prKey({ host: "GitHub.com", repo: "Example-Org/Example-Repo", number: 3 }), "github.com/example-org/example-repo#3");
});

test("parseGhDetail builds reviewers, conversation and merge", () => {
  const d = parseGhDetail(fixture("pr-gh-view.json"), repo);
  assert.equal(d.pr.number, 102);
  assert.equal(d.body, "Example body.");
  assert.deepEqual(d.checks, [
    { name: "build", state: "failed", url: "https://github.com/example-org/example-repo/actions/runs/1/job/2" },
    { name: "test", state: "running", url: null },
    { name: "ci/example", state: "passed", url: "https://ci.example.com/build/3" },
  ]);
  assert.deepEqual(d.reviewers, [
    { name: "review-user", state: "changes_requested" },
    { name: "octo-reviewer", state: "requested" },
    { name: "example-team", state: "requested" },
  ]);
  assert.deepEqual(d.conversation, [
    { author: "octo-user", body: "Example comment.", at: "2026-11-12T08:30:00Z", kind: "comment", state: null, id: null },
    { author: "review-user", body: "Please fix the build.", at: "2026-11-12T09:00:00Z", kind: "review", state: "changes_requested", id: "PRR_example0" },
    { author: "review-user", body: "", at: "2026-11-12T09:05:00Z", kind: "review", state: "commented", id: "PRR_example2" },
    { author: "octo-reviewer", body: "", at: "2026-11-12T09:10:00Z", kind: "review", state: "approved", id: "PRR_example1" },
  ]);
  assert.deepEqual([d.threads, d.threadsError, d.threadsNote, d.squashLocked], [[], null, null, false]);
  assert.deepEqual(d.merge, { state: "blocked", reason: "Blocked by branch protection: required reviews or checks." });
});

test("parsers throw on bad output", () => {
  assert.throws(() => parseGhList("not json", repo), /unexpected gh output/);
  assert.throws(() => parseGhList("{}", repo), /unexpected gh output/);
  assert.throws(() => parseGhDetail("[]", repo), /unexpected gh output/);
  assert.throws(() => parseGhDetail("null", repo), /unexpected gh output/);
});

test("parseGhDetail reads the head sha", () => {
  const d = parseGhDetail(fixture("pr-gh-view.json"), repo);
  assert.equal(d.headSha, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(d.squash, false);
});

test("parseGhDetail without headRefOid gives null", () => {
  const raw = JSON.parse(fixture("pr-gh-view.json"));
  delete raw.headRefOid;
  assert.equal(parseGhDetail(JSON.stringify(raw), repo).headSha, null);
});

test("parseGhDetail reads an empty headRefOid as null", () => {
  const raw = JSON.parse(fixture("pr-gh-view.json"));
  raw.headRefOid = "";
  assert.equal(parseGhDetail(JSON.stringify(raw), repo).headSha, null);
});

test("parseGhThreads: path, line, resolved, comments by time, and the review of the first comment", () => {
  const read = parseGhThreads(fixture("pr-gh-threads.json"));
  assert.equal(read.truncated, false);
  assert.deepEqual(read.threads, [
    { path: "src/old.js", line: 7, resolved: true, reviewId: "PRR_example0", comments: [{ author: "review-user", body: "Old remark.", at: "2026-11-12T09:01:00Z" }] },
    {
      path: "src/example.js",
      line: 12,
      resolved: false,
      reviewId: "PRR_example1",
      comments: [
        { author: "octo-reviewer", body: "Rename this.", at: "2026-11-12T09:10:00Z" },
        { author: "octo-user", body: "Fixed.", at: "2026-11-12T09:20:00Z" },
      ],
    },
  ]);
});

test("parseGhThreads throws on bad output and GraphQL errors", () => {
  assert.throws(() => parseGhThreads("not json"), /unexpected gh output/);
  assert.throws(() => parseGhThreads('{"errors":[{"message":"x"}]}'));
});

test("parseGhThreads marks a list of 100 threads as cut", () => {
  const one = JSON.parse(fixture("pr-gh-threads.json")).data.repository.pullRequest.reviewThreads.nodes[1];
  const raw = { data: { repository: { pullRequest: { reviewThreads: { nodes: Array.from({ length: 100 }, () => one) } } } } };
  assert.equal(parseGhThreads(JSON.stringify(raw)).truncated, true);
});

test("mergeThreads: threads, the limit note, or the read error", () => {
  const d = parseGhDetail(fixture("pr-gh-view.json"), repo);
  const failed = mergeThreads(d, null, "gh: rate limited");
  assert.deepEqual([failed.threads, failed.threadsError, failed.threadsNote], [[], "gh: rate limited", null]);
  assert.equal(failed.body, d.body);
  const cut = mergeThreads(d, { threads: [], truncated: true }, null);
  assert.deepEqual([cut.threadsNote, cut.threadsError], [THREADS_LIMIT_NOTE, null]);
  const read = parseGhThreads(fixture("pr-gh-threads.json"));
  assert.equal(mergeThreads(d, read, null).threads.length, 2);
});

test("parseGhThreads: display names of the participants, without empty ones", () => {
  assert.deepEqual(parseGhThreads(fixture("pr-gh-threads.json")).names, { "octo-user": "Octo User", "waiting-user": "Waiting User" });
  const d = parseGhDetail(fixture("pr-gh-view.json"), repo);
  assert.deepEqual(d.names, {});
  assert.deepEqual(mergeThreads(d, parseGhThreads(fixture("pr-gh-threads.json")), null).names, { "octo-user": "Octo User", "waiting-user": "Waiting User" });
  assert.deepEqual(mergeThreads(d, null, "gh: x").names, {});
});

test("ghCheckList drops a link with whitespace", () => {
  assert.equal(ghCheckList([{ context: "c", state: "SUCCESS", targetUrl: "https://example.com/a b" }])[0].url, null);
  assert.equal(ghCheckList([{ context: "c", state: "SUCCESS", targetUrl: "https://example.com/a" }])[0].url, "https://example.com/a");
});

test("parseGhThreads keeps display names for logins that match Object properties", () => {
  const raw = JSON.parse(fixture("pr-gh-threads.json"));
  const pull = raw.data.repository.pullRequest;
  pull.participants = { nodes: [{ login: "constructor", name: "C Name" }, { login: "__proto__", name: "P Name" }] };
  const read = parseGhThreads(JSON.stringify(raw));
  assert.equal(read.names.constructor, "C Name");
  assert.equal(Object.getOwnPropertyDescriptor(read.names, "__proto__").value, "P Name");
  const detail = mergeThreads(parseGhDetail(fixture("pr-gh-view.json"), "example-org/example-repo"), read, null);
  assert.equal(detail.names.constructor, "C Name");
  assert.equal(Object.getOwnPropertyDescriptor(detail.names, "__proto__").value, "P Name");
});
