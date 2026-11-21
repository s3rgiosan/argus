// Draws the pull request pane from plain data: the header with the verdict, the folding
// sections, and the bottom area that main.js builds (comment field, merge confirm, footer).
// State, reads and actions stay in main.js; handlers come in through `on`.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { frame, scrollArea, iconButton, chip, errorLine, foldTitle, paneHead, mutedText, markdown, nameLabel } from "./ui.js";
import { uniqueKeys } from "./forge-board.js";

/** The pane's sections, in order. */
export const SECTIONS = [
  ["checks", "Checks"],
  ["reviews", "Reviews"],
  ["agent", "Review agent"],
  ["description", "Description"],
  ["conversation", "Conversation"],
];

/** The chip of a review, by its state; a review that only left comments reads "reviewed". */
const REVIEW_CHIPS = { approved: "approved", changes_requested: "changes requested", commented: "reviewed", dismissed: "dismissed" };
const REVIEWER_WORDS = { approved: "Approved", changes_requested: "Changes requested", commented: "Commented", dismissed: "Dismissed", pending: "Pending", requested: "Review requested" };

/** The color of a verdict group. */
function verdictTone(t, group) {
  switch (group) {
    case "ready":
      return t.done;
    case "needsWork":
      return t.blocked;
    case "waiting":
      return t.working;
    case "merged":
      return t.accent;
    default:
      return t.muted;
  }
}

/** A key for a conversation item that does not depend on its place in the list. */
function itemKey(item) {
  if (item.entry !== null) return item.entry.id ?? `${item.kind}:${item.at}:${item.entry.author}`;
  return `thread:${threadKey(item.threads[0])}`;
}

/** A key for a thread from its file, line and first comment time. */
function threadKey(thread) {
  return `${thread.path}:${thread.line ?? ""}:${thread.comments[0]?.at ?? ""}`;
}

/**
 * The pull request pane.
 * @param {object} t The theme.
 * @param {object} view What to show: `detail`, `verdict` (`verdictOf`), `summaries` (`sectionSummaries`),
 *   `open` (the open section ids), `checks` (`checkLayout`), `items` (`conversationItems`), `nameOf(login)`,
 *   `position` (`positionIn` or null), `hasCheckout`, `checkingOut`, `error`, `now`, `age(at, now)`,
 *   `icon(name)` (a path), `agentRows` (elements), `bottom` (an element: the area under the scroll).
 * @param {object} on Handlers, each given the click's `cx` last: `toggle(section, cx)`, `togglePassed(cx)`,
 *   `prev(cx)`, `next(cx)`, `openBrowser(cx)`, `openCheck(url, cx)`, `openLink(url, cx)` (a link in Markdown text), `checkOut(cx)`.
 */
export function prPane(t, view, on) {
  const { detail, verdict, position } = view;
  const pr = detail.pr;
  const color = verdictTone(t, verdict.group);
  const head = paneHead(t, {
    provider: pr.provider,
    place: `${pr.repo} · #${pr.number}`,
    title: pr.title,
    position,
    noun: "pull request",
    idPrefix: "pr",
    icon: view.icon,
    onPrev: on.prev,
    onNext: on.next,
    actions: [
      iconButton(t, "pr-browser", view.icon("external-link"), (_e, cx) => on.openBrowser(cx), { tooltip: "Open in browser" }),
      iconButton(t, "pr-checkout", view.icon("git-branch"), (_e, cx) => on.checkOut(cx), { enabled: view.hasCheckout && !view.checkingOut, tooltip: "Check out in a worktree" }),
    ],
  })
    .child(div().min_w(0).text_size(12).text_color(t.dim).whitespace_normal().child(`${pr.headRef} → ${pr.baseRef}`))
    .child(
      v_flex()
        .id("verdict")
        .mt(4)
        .px(12)
        .py(10)
        .gap(2)
        .rounded(8)
        .bg(`${color}26`)
        .child(div().text_size(14).font_semibold().text_color(color).child(verdict.title))
        .child(div().text_size(12).text_color(t.muted).whitespace_normal().child(verdict.reasons)),
    )
    .when(!view.hasCheckout, (el) => el.child(div().text_size(11).text_color(t.muted).child("No local checkout")))
    .when(view.checkingOut, (el) => el.child(div().text_size(11).text_color(t.muted).child("Checking out…")))
    .when(Boolean(view.error), (el) => el.child(errorLine(t, view.error ?? "").px(0)));

  const parts = [head];
  for (const [id, label] of SECTIONS) {
    const open = view.open.has(id);
    parts.push(foldTitle(t, `sec-${id}`, { label, chevron: view.icon(open ? "chevron-down" : "chevron-right"), summary: view.summaries[id] ?? "", onToggle: (cx) => on.toggle(id, cx) }));
    // Every section body has the same inset and gap, so text, rows and notes line up.
    if (open) parts.push(v_flex().px(14).pt(4).pb(10).gap(8).children(sectionBody(t, id, view, on)));
  }
  parts.push(div().h(10));

  return frame(t, "argus-pull-requests-pr")
    .rounded_none()
    .border_0()
    .child(scrollArea("argus-pull-requests-pr-detail", parts, { padding: 0, gap: 0 }))
    .when(view.bottom !== null && view.bottom !== undefined, (el) => el.child(view.bottom));
}

function sectionBody(t, id, view, on) {
  const { detail } = view;
  switch (id) {
    case "checks": {
      const { rows, passedLine } = view.checks;
      if (rows.length === 0 && passedLine === null) return [mutedText(t, "No checks")];
      const out = rows.map((check, index) => checkRow(t, view, on, `check-${index}`, check));
      if (passedLine !== null) {
        out.push(
          h_flex()
            .id("checks-passed")
            .mx(-8)
            .px(8)
            .py(4)
            .gap(8)
            .items_center()
            .child(div().flex_none().text_color(t.done).child("✓"))
            .child(div().flex_1().text_color(t.muted).child(`${passedLine.count} passed`))
            .child(
              div()
                .id("checks-passed-toggle")
                .flex_none()
                .text_size(12)
                .text_color(t.accent)
                .cursor_pointer()
                .hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => on.togglePassed(cx))
                .child(passedLine.open ? "Hide" : "Show"),
            ),
        );
      }
      // The rows' own padding spaces them, so they sit in a stack without the section's gap.
      return [v_flex().id("checks-list").children(out)];
    }
    case "reviews":
      if (detail.reviewers.length === 0) return [mutedText(t, "No reviewers")];
      return detail.reviewers.map((reviewer, index) =>
        h_flex()
          .id(`reviewer-${index}`)
          .gap(8)
          .child(nameLabel(`reviewer-name-${index}`, view.nameOf(reviewer.name), reviewer.name).flex_1())
          .child(div().flex_none().text_color(reviewer.state === "changes_requested" ? t.blocked : reviewer.state === "approved" ? t.done : t.muted).child(REVIEWER_WORDS[reviewer.state] ?? reviewer.state)),
      );
    case "agent":
      if (!view.hasCheckout) return [mutedText(t, "No local checkout, so no review agent can start here.")];
      return view.agentRows.length > 0 ? view.agentRows : [mutedText(t, "No review agent yet. Review with agent starts one.")];
    case "description":
      return [detail.body.trim() === "" ? mutedText(t, "No description") : markdown(t, "md-description", detail.body, on.openLink)];
    default: {
      const rows = [];
      if (detail.threadsError) rows.push(div().text_size(11).text_color(t.blocked).whitespace_normal().child(`File comments could not be read: ${detail.threadsError}`));
      if (detail.threadsNote) rows.push(div().text_size(11).text_color(t.muted).child(detail.threadsNote));
      if (view.items.length === 0) rows.push(mutedText(t, "No comments"));
      const keys = uniqueKeys(view.items.map(itemKey));
      view.items.forEach((item, index) => rows.push(itemView(t, view, on, item, keys[index])));
      return rows;
    }
  }
}

/** One check; a check with a run or job page opens it in the browser on click. */
function checkRow(t, view, on, id, check) {
  const color = check.state === "failed" ? t.blocked : check.state === "running" ? t.working : t.done;
  const mark = check.state === "failed" ? "✗" : check.state === "running" ? "●" : "✓";
  // The row's padding gives its hover room; the negative margin keeps its text in line with the section.
  let row = h_flex().id(id).mx(-8).px(8).py(4).gap(8).items_center().rounded(7).child(div().flex_none().text_color(color).child(mark)).child(div().flex_1().min_w(0).whitespace_normal().child(check.name));
  if (!check.url) return row;
  const url = check.url;
  return row
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .tooltip("Open in browser")
    .on_click((_e, cx) => on.openCheck(url, cx))
    .child(svg(view.icon("external-link")).size(12).flex_none().text_color(t.dim));
}

/**
 * One conversation item: a header line (name, chip, age) and a balloon with the text and, for a
 * review, its file threads. An item with nothing to put in the balloon shows the header only.
 */
function itemView(t, view, on, item, key) {
  const entry = item.entry;
  // A thread with no listed review stands for itself: its first comment gives the header.
  const first = item.threads[0]?.comments[0] ?? null;
  const author = entry?.author ?? first?.author ?? "";
  const label = entry === null ? "commented" : entry.kind === "review" ? (REVIEW_CHIPS[entry.state] ?? "reviewed") : "commented";
  const color = entry?.state === "changes_requested" ? t.blocked : entry?.state === "approved" ? t.done : t.muted;
  const parts = [];
  if (entry !== null && entry.body.trim() !== "") parts.push(div().p(10).child(markdown(t, `md-item-${key}`, entry.body, on.openLink)));
  const threadKeys = uniqueKeys(item.threads.map(threadKey));
  item.threads.forEach((thread, n) => parts.push(threadSection(t, view, on, thread, `${key}|${threadKeys[n]}`, author, parts.length > 0)));
  return v_flex()
    .id(`item-${key}`)
    .gap(6)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(nameLabel(`item-name-${key}`, view.nameOf(author), author).font_semibold())
        .child(chip(t, `item-state-${key}`, label, color))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.dim).child(view.age(item.at, view.now))),
    )
    .when(parts.length > 0, (el) => el.child(v_flex().id(`balloon-${key}`).rounded(8).border_1().border_color(t.border).overflow_hidden().children(parts)));
}

/**
 * A file thread inside a balloon: a bar with the file, line and open or resolved, then its
 * comments. A comment by the balloon's author shows no name line, so a name never shows twice.
 */
function threadSection(t, view, on, thread, key, author, divided) {
  const commentKeys = uniqueKeys(thread.comments.map((comment) => `${comment.at}:${comment.author}`));
  const place = thread.line === null ? thread.path : `${thread.path}:${thread.line}`;
  return v_flex()
    .id(`thread-${key}`)
    .when(divided, (el) => el.border_t(1).border_color(t.border))
    .child(
      h_flex()
        .px(10)
        .py(6)
        .gap(6)
        .items_center()
        .bg(t.raised)
        .child(svg(view.icon("code")).size(13).flex_none().text_color(t.muted))
        .child(div().min_w(0).flex_1().truncate().text_size(12).text_color(t.accent).child(place))
        .child(chip(t, `thread-state-${key}`, thread.resolved ? "resolved" : "open", thread.resolved ? t.muted : t.working)),
    )
    .child(
      v_flex()
        .p(10)
        .gap(8)
        .children(
          thread.comments.map((comment, n) =>
            v_flex()
              .id(`thread-${key}|${commentKeys[n]}`)
              .gap(2)
              .when(comment.author !== author, (el) =>
                el.child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .text_size(12)
                    .child(nameLabel(`thread-name-${key}|${commentKeys[n]}`, view.nameOf(comment.author), comment.author).font_semibold())
                    .child(div().flex_1())
                    .child(div().flex_none().text_size(11).text_color(t.dim).child(view.age(comment.at, view.now))),
                ),
              )
              .when(comment.body.trim() !== "", (el) => el.child(markdown(t, `md-thread-${key}|${commentKeys[n]}`, comment.body, on.openLink))),
          ),
        ),
    );
}
