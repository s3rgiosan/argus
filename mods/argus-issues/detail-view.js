// Draws the issue pane from plain data: the header, the facts, the folding Description and
// Comments sections, and the footer with New worktree. State and reads stay in main.js; handlers
// come in through `on`.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { frame, scrollArea, iconButton, chip, errorLine, note, button, foldTitle, paneHead, mutedText, markdown, nameLabel } from "./ui.js";
import { displayName, uniqueKeys } from "./forge-board.js";
import { SECTIONS, hiddenText, openedLine, stateText } from "./detail.js";

/** One line of facts: a dim label, then the value. */
function factRow(t, id, label, value) {
  return h_flex().id(id).gap(8).items_start().text_size(12).child(div().w(72).flex_none().text_color(t.dim).child(label)).child(div().flex_1().min_w(0).whitespace_normal().child(value));
}

/**
 * The issue pane.
 * @param {object} t The theme.
 * @param {object} view What to show: `detail`, `names` (`namesOf`), `comments` (`commentItems`),
 *   `summaries` (`sectionSummaries`), `open` (the open section ids), `position` (`positionIn` or null),
 *   `error` (a failed read again), `now`, `age(at, now)`, `icon(name)` (a path), and `worktree`
 *   (`worktreeState`): `{reason, running, busy, error, note}`, where `reason` is why New worktree
 *   cannot start, or null.
 * @param {object} on Handlers, each given the click's `cx` last: `toggle(section, cx)`, `prev(cx)`,
 *   `next(cx)`, `openBrowser(cx)`, `openLink(url, cx)` (a link in Markdown text), `newWorktree(cx)`.
 */
export function issuePane(t, view, on) {
  const { detail, names, position } = view;
  const issue = detail.issue;
  const state = stateText(issue);
  const people = issue.assignees.map((person) => displayName(person.login, names)).join(", ");
  const head = paneHead(t, {
    provider: issue.provider,
    place: `${issue.repo} · #${issue.number}`,
    title: issue.title,
    position,
    noun: "issue",
    idPrefix: "issue",
    icon: view.icon,
    onPrev: on.prev,
    onNext: on.next,
    actions: [iconButton(t, "issue-browser", view.icon("external-link"), (_e, cx) => on.openBrowser(cx), { enabled: issue.url !== null, tooltip: "Open in browser" })],
  })
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .flex_wrap()
        .child(chip(t, "issue-state", state.text, state.open ? t.done : t.muted))
        .when(issue.confidential, (el) => el.child(chip(t, "issue-confidential", "confidential", t.working)))
        .child(div().min_w(0).text_size(12).text_color(t.dim).whitespace_normal().child(openedLine(issue, names, view.now))),
    )
    .child(
      v_flex()
        .id("issue-facts")
        .mt(4)
        .gap(4)
        .child(factRow(t, "fact-assignees", "Assignees", people === "" ? "None" : people))
        .child(
          factRow(
            t,
            "fact-labels",
            "Labels",
            issue.labels.length === 0 ? "None" : h_flex().gap(4).flex_wrap().children(issue.labels.map((label, index) => chip(t, `label-${index}`, label, t.muted))),
          ),
        )
        .when(issue.milestone !== null, (el) => el.child(factRow(t, "fact-milestone", "Milestone", issue.milestone ?? ""))),
    )
    .when(Boolean(view.error), (el) => el.child(errorLine(t, view.error ?? "").px(0)));

  const parts = [head];
  for (const [id, label] of SECTIONS) {
    const open = view.open.has(id);
    parts.push(foldTitle(t, `sec-${id}`, { label, chevron: view.icon(open ? "chevron-down" : "chevron-right"), summary: view.summaries[id] ?? "", onToggle: (cx) => on.toggle(id, cx) }));
    if (open) parts.push(v_flex().px(14).pt(4).pb(10).gap(8).children(sectionBody(t, id, view, on)));
  }
  parts.push(div().h(10));

  return frame(t, "argus-issues-issue")
    .rounded_none()
    .border_0()
    .child(scrollArea("argus-issues-issue-detail", parts, { padding: 0, gap: 0 }))
    .child(footerBar(t, view.worktree, on));
}

/** The area under the scroll: the New worktree reason, note and error, then the New worktree button. */
function footerBar(t, worktree, on) {
  const above = [];
  if (worktree.reason !== null) above.push(note(t, worktree.reason).p(0).text_size(11));
  if (worktree.note !== null) above.push(note(t, worktree.note).p(0));
  if (worktree.error !== null) above.push(errorLine(t, worktree.error).id("worktree-error").px(0).py(0));
  return v_flex()
    .flex_none()
    .px(12)
    .py(10)
    .gap(8)
    .border_t(1)
    .border_color(t.border)
    .bg(t.background)
    .children(above)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(
          button(t, "new-worktree", worktree.running ? "Starting…" : "New worktree", (_e, cx) => on.newWorktree(cx), {
            primary: true,
            enabled: worktree.reason === null && !worktree.busy,
          }),
        ),
    );
}

function sectionBody(t, id, view, on) {
  const { detail } = view;
  if (id === "description") {
    return [detail.body.trim() === "" ? mutedText(t, "No description") : markdown(t, "md-description", detail.body, on.openLink)];
  }
  const rows = [];
  if (detail.commentsNote) rows.push(div().text_size(11).text_color(t.muted).child(detail.commentsNote));
  if (view.comments.length === 0) rows.push(mutedText(t, "No comments"));
  // A comment's key comes from its time and author, so it does not depend on its place in the list.
  const keys = uniqueKeys(view.comments.map((comment) => `${comment.at}:${comment.author}`));
  view.comments.forEach((comment, index) => rows.push(commentView(t, view, on, comment, keys[index])));
  return rows;
}

/** One comment: a header line (name, chips, age) and a balloon with its Markdown, or the hidden note. */
function commentView(t, view, on, comment, key) {
  const body =
    comment.hidden !== null ? div().p(10).text_size(12).text_color(t.dim).child(hiddenText(comment.hidden)) : div().p(10).child(markdown(t, `md-comment-${key}`, comment.body, on.openLink));
  return v_flex()
    .id(`comment-${key}`)
    .gap(6)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(nameLabel(`comment-name-${key}`, displayName(comment.author, view.names), comment.author).font_semibold())
        .when(comment.internal, (el) => el.child(chip(t, `comment-internal-${key}`, "internal", t.working)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.dim).child(view.age(comment.at, view.now))),
    )
    .child(v_flex().id(`balloon-${key}`).rounded(8).border_1().border_color(t.border).overflow_hidden().child(body));
}
