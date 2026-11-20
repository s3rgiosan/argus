// Draws the pull request pane from plain data: the header, the tab strip, and the content of
// the chosen tab. State, reads and actions stay in main.js; handlers come in through `on`.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { frame, scrollArea, note, button } from "./ui.js";

/** The pane's tabs, in strip order. */
export const TABS = [
  ["conversation", "Conversation"],
  ["checks", "Checks"],
  ["description", "Description"],
  ["agent", "Agent"],
  ["details", "Details"],
];

const STATE_WORDS = { approved: "approved", changes_requested: "changes requested", commented: "commented", dismissed: "dismissed" };
const REVIEWER_WORDS = { approved: "Approved", changes_requested: "Changes requested", commented: "Commented", dismissed: "Dismissed", pending: "Pending", requested: "Review requested" };
const MERGE_WORDS = { mergeable: "Mergeable", conflicting: "Has conflicts", blocked: "Blocked", unknown: "Not checked yet" };

/** The color of a status icon. */
function tone(t, icon) {
  switch (icon) {
    case "pass":
      return t.done;
    case "fail":
      return t.blocked;
    case "run":
      return t.working;
    default:
      return t.muted;
  }
}

/** A small tinted label, as Herdr's "Needs you" chip. */
function chip(t, id, text, color) {
  return div().id(id).flex_none().px(6).h(20).flex().items_center().rounded(5).bg(`${color}26`).text_size(11).font_medium().text_color(color).child(text);
}

/** A 24 px icon button; off when `enabled` is false. */
function iconAction(t, id, path, onClick, { enabled = true, tooltip = null } = {}) {
  let el = div().id(id).flex_none().size(24).flex().items_center().justify_center().rounded(5).text_color(enabled ? t.muted : t.dim);
  if (tooltip) el = el.tooltip(tooltip);
  if (enabled) el = el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick);
  return el.child(svg(path).size(14));
}

/**
 * The pull request pane.
 * @param {object} t The theme.
 * @param {object} view What to show: `detail`, `status` (`statusRows`), `summary` (`summaryOf`), `items`
 *   (`conversationItems`), `position` (`positionIn` or null), `tab`, `hasCheckout`, `checkingOut`, `error`,
 *   `now`, `age(at, now)`, `icon(name)` (a path), `stateLabel`, `cardActions` (an element or null),
 *   `bottom` (an element or null), `agentRows` (elements), `canReview`.
 * @param {object} on Handlers, each given the click's `cx` last: `tab(name, cx)`, `prev(cx)`, `next(cx)`, `openBrowser(cx)`, `checkOut(cx)`, `reviewWithAgent(cx)`.
 */
export function prPane(t, view, on) {
  const { detail } = view;
  const pr = detail.pr;
  const position = view.position;
  const head = v_flex()
    .flex_none()
    .px(14)
    .pt(12)
    .pb(8)
    .gap(8)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(svg(view.icon(pr.provider === "gitlab" ? "gitlab" : "github")).size(14).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(pr.repo))
        .child(div().flex_none().text_size(12).text_color(t.muted).child(`#${pr.number}`))
        .child(div().flex_1())
        .when(position !== null, (el) =>
          el
            .child(div().flex_none().text_size(12).text_color(t.dim).child(`${position.index} of ${position.total}`))
            .child(iconAction(t, "pr-prev", view.icon("arrow-up"), (_e, cx) => on.prev(cx), { enabled: position.prev !== null, tooltip: "Previous pull request" }))
            .child(iconAction(t, "pr-next", view.icon("arrow-down"), (_e, cx) => on.next(cx), { enabled: position.next !== null, tooltip: "Next pull request" })),
        )
        .child(iconAction(t, "pr-browser", view.icon("external-link"), (_e, cx) => on.openBrowser(cx), { tooltip: "Open in browser" }))
        .child(iconAction(t, "pr-checkout", view.icon("git-branch"), (_e, cx) => on.checkOut(cx), { enabled: view.hasCheckout && !view.checkingOut, tooltip: "Check out in a worktree" })),
    )
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .child(chip(t, "pr-state", view.stateLabel, pr.state === "open" ? (pr.isDraft ? t.muted : t.done) : t.muted))
        .child(div().min_w(0).flex_1().truncate().text_size(12).text_color(t.dim).child(`${pr.headRef} → ${pr.baseRef}`)),
    )
    .child(div().text_size(18).font_semibold().whitespace_normal().child(pr.title))
    .when(!view.hasCheckout, (el) => el.child(div().text_size(11.5).text_color(t.muted).child("No local checkout")))
    .when(view.checkingOut, (el) => el.child(div().text_size(11.5).text_color(t.muted).child("Checking out…")))
    .when(Boolean(view.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).whitespace_normal().child(view.error ?? "")));

  const tabs = h_flex()
    .flex_none()
    .px(14)
    .gap(16)
    .border_b(1)
    .border_color(t.border)
    .children(
      TABS.map(([id, label]) => {
        const chosen = view.tab === id;
        return div()
          .id(`tab-${id}`)
          .py(8)
          .text_size(13)
          .cursor_pointer()
          .text_color(chosen ? t.foreground : t.muted)
          .hover((s) => s.text_color(t.foreground))
          .border_b(2)
          .border_color(chosen ? t.accent : t.background)
          .on_click((_e, cx) => on.tab(id, cx))
          .child(label);
      }),
    );

  let parts;
  switch (view.tab) {
    case "checks":
      parts = checksTab(t, detail);
      break;
    case "description":
      parts = [detail.body.trim() === "" ? note(t, "No description") : div().whitespace_normal().child(detail.body)];
      break;
    case "agent":
      parts = agentTab(t, view, on);
      break;
    case "details":
      parts = detailsTab(t, view);
      break;
    default:
      parts = conversationTab(t, view, on);
  }

  return frame(t, "argus-pull-requests-pr")
    .rounded_none()
    .border_0()
    .child(head)
    .child(tabs)
    .child(scrollArea("argus-pull-requests-pr-detail", parts, { padding: 12, gap: 12 }))
    .when(view.bottom !== null && view.bottom !== undefined, (el) => el.child(view.bottom));
}

function conversationTab(t, view, on) {
  const { status, summary, items } = view;
  const row = (id, icon, color, title, noteText, onClick = null) => {
    let el = h_flex().id(id).px(12).py(10).gap(10).items_center().border_b(1).border_color(t.border);
    if (onClick) el = el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick);
    return el
      .child(svg(view.icon(icon)).size(14).flex_none().text_color(color))
      .child(div().flex_none().font_medium().child(title))
      .when(Boolean(noteText), (inner) => inner.child(div().min_w(0).flex_1().truncate().text_color(t.muted).child(noteText ?? "")));
  };
  const checkIcon = { pass: "circle-check", fail: "circle-x", run: "circle-dot", none: "circle-dot" };
  const card = v_flex()
    .id("status-card")
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .overflow_hidden()
    .child(row("status-checks", checkIcon[status.checks.icon], tone(t, status.checks.icon), status.checks.title, status.checks.note))
    .child(row("status-review", checkIcon[status.review.icon], tone(t, status.review.icon), status.review.title, null))
    .child(row("status-merge", "git-merge", tone(t, status.merge.icon), status.merge.title, status.merge.note))
    .child(row("status-agent", "play", t.muted, status.agent.title, null, (_e, cx) => on.tab("agent", cx)))
    .when(view.cardActions !== null, (el) => el.child(h_flex().flex_wrap().gap(8).p(12).bg(t.raised).child(view.cardActions)));

  const chips = [];
  if (summary.requested > 0) chips.push(chip(t, "sum-requested", `${summary.requested} requested changes`, t.blocked));
  if (summary.openThreads > 0) chips.push(chip(t, "sum-threads", `${summary.openThreads} open threads`, t.working));
  const people = summary.people === 1 ? "1 person" : `${summary.people} people`;
  const comments = summary.comments === 1 ? "1 comment" : `${summary.comments} comments`;
  const sum = v_flex()
    .id("summary")
    .p(12)
    .gap(8)
    .rounded(8)
    .bg(t.raised)
    .when(chips.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).children(chips)))
    .child(div().text_color(t.muted).child(`${comments} from ${people}`))
    .when(Boolean(view.detail.threadsError), (el) => el.child(div().text_size(11.5).text_color(t.blocked).whitespace_normal().child(`File comments could not be read: ${view.detail.threadsError}`)))
    .when(Boolean(view.detail.threadsNote), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(view.detail.threadsNote ?? "")));

  const parts = [card, sum];
  if (items.length === 0) parts.push(note(t, "No comments"));
  items.forEach((item, index) => parts.push(itemView(t, view, item, index)));
  return parts;
}

function itemView(t, view, item, index) {
  const threads = item.threads.map((thread, n) => threadView(t, view, thread, `${index}-${n}`));
  if (item.kind === "thread") return v_flex().id(`item-${index}`).gap(6).children(threads);
  const entry = item.entry;
  const action = entry.kind === "review" ? "reviewed" : "commented";
  const stateColor = entry.state === "changes_requested" ? t.blocked : entry.state === "approved" ? t.done : t.muted;
  return v_flex()
    .id(`item-${index}`)
    .gap(6)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(div().flex_none().font_semibold().child(entry.author))
        .child(div().flex_none().text_color(t.muted).child(action))
        .when(entry.kind === "review" && entry.state !== null, (el) => el.child(chip(t, `item-state-${index}`, STATE_WORDS[entry.state] ?? entry.state, stateColor)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(view.age(entry.at, view.now))),
    )
    .when(entry.body.trim() !== "", (el) => el.child(div().whitespace_normal().child(entry.body)))
    .when(threads.length > 0, (el) => el.child(v_flex().pl(16).gap(6).children(threads)));
}

function threadView(t, view, thread, key) {
  const place = thread.line === null ? thread.path : `${thread.path}:${thread.line}`;
  return v_flex()
    .id(`thread-${key}`)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .overflow_hidden()
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
              .id(`thread-${key}-${n}`)
              .gap(2)
              .child(div().text_size(11.5).text_color(t.dim).child(`${comment.author} · ${view.age(comment.at, view.now)}`))
              .child(div().whitespace_normal().child(comment.body)),
          ),
        ),
    );
}

function checksTab(t, detail) {
  if (detail.checks.length === 0) return [note(t, "No checks")];
  return detail.checks.map((check, index) => {
    const color = check.state === "failed" ? t.blocked : check.state === "running" ? t.working : t.muted;
    const mark = check.state === "failed" ? "✗" : check.state === "running" ? "●" : "✓";
    return h_flex().id(`check-${index}`).gap(8).child(div().flex_none().text_color(color).child(mark)).child(div().flex_1().min_w(0).whitespace_normal().child(check.name));
  });
}

function agentTab(t, view, on) {
  const parts = [];
  if (!view.hasCheckout) parts.push(note(t, "No local checkout"));
  else if (view.agentRows.length === 0) parts.push(note(t, "No agent yet"));
  parts.push(...view.agentRows);
  parts.push(h_flex().child(button(t, "agent-review", "Review with agent", (_e, cx) => on.reviewWithAgent(cx), { primary: true, enabled: view.canReview })));
  return parts;
}

function detailsTab(t, view) {
  const { detail } = view;
  const pr = detail.pr;
  const line = (id, label, value) =>
    h_flex().id(id).gap(10).child(div().w(110).flex_none().text_color(t.muted).child(label)).child(div().flex_1().min_w(0).whitespace_normal().child(value));
  const parts = [
    line("d-author", "Author", pr.author),
    line("d-head", "Head", pr.headRef),
    line("d-base", "Base", pr.baseRef),
    line("d-updated", "Updated", view.age(pr.updatedAt, view.now)),
    line("d-draft", "Draft", pr.isDraft ? "Yes" : "No"),
    line("d-merge", "Merge state", MERGE_WORDS[detail.merge.state] ?? "Not checked yet"),
  ];
  if (detail.merge.reason) parts.push(line("d-reason", "Merge reason", detail.merge.reason));
  parts.push(line("d-sha", "Head commit", detail.headSha ?? "Not known"));
  parts.push(div().pt(4).text_size(11.5).font_medium().text_color(t.dim).child("Reviewers"));
  if (detail.reviewers.length === 0) parts.push(note(t, "No reviewers"));
  detail.reviewers.forEach((reviewer, index) =>
    parts.push(
      h_flex()
        .id(`d-reviewer-${index}`)
        .gap(8)
        .child(div().flex_1().min_w(0).truncate().child(reviewer.name))
        .child(div().flex_none().text_color(reviewer.state === "changes_requested" ? t.blocked : t.muted).child(REVIEWER_WORDS[reviewer.state] ?? reviewer.state)),
    ),
  );
  return parts;
}
