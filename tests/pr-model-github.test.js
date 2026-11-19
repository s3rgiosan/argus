import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ghCheckList, parseGhDetail, parseGhList, parseGhSearch, parsePrUrl, prKey, summarize } from "../mods/argus-pull-requests/model.js";

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
  assert.deepEqual(ghCheckList([{ context: "ci/example", state: "SUCCESS" }]), [{ name: "ci/example", state: "passed" }]);
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
  assert.deepEqual(d.checks, [{ name: "build", state: "failed" }, { name: "test", state: "running" }]);
  assert.deepEqual(d.reviewers, [
    { name: "review-user", state: "changes_requested" },
    { name: "octo-reviewer", state: "requested" },
    { name: "example-team", state: "requested" },
  ]);
  assert.deepEqual(d.conversation, [
    { author: "octo-user", body: "Example comment.", at: "2026-11-12T08:30:00Z", kind: "comment" },
    { author: "review-user", body: "Please fix the build.", at: "2026-11-12T09:00:00Z", kind: "review" },
  ]);
  assert.deepEqual(d.merge, { state: "blocked", reason: "Blocked by branch protection: required reviews or checks." });
});

test("parsers throw on bad output", () => {
  assert.throws(() => parseGhList("not json", repo), /unexpected gh output/);
  assert.throws(() => parseGhList("{}", repo), /unexpected gh output/);
  assert.throws(() => parseGhDetail("[]", repo), /unexpected gh output/);
  assert.throws(() => parseGhDetail("null", repo), /unexpected gh output/);
});
