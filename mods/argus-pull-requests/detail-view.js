// Draws the pull request pane from plain data: the header with the verdict, the folding
// sections, and the bottom area that main.js builds (comment field, merge confirm, footer).
// State, reads and actions stay in main.js; handlers come in through `on`.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { frame, scrollArea } from "./ui.js";

/** The pane's sections, in order. */
export const SECTIONS = [
  ["checks", "Checks"],
  ["reviews", "Reviews"],
  ["agent", "Review agent"],
  ["description", "Description"],
  ["conversation", "Conversation"],
];

const STATE_WORDS = { approved: "approved", changes_requested: "changes requested", commented: "commented", dismissed: "dismissed" };
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

/** Muted text inside a section, with no padding of its own, so it lines up with the other rows. */
function muted(t, text) {
  return div().text_color(t.muted).whitespace_normal().child(text);
}

/** Markdown from a comment or a description, as Herdr's TextView draws it. */
function markdown(t, id, text) {
  return div().text_color(t.foreground).child(TextView.markdown(id, text).selectable(true));
}

/** A small tinted label, as Herdr's "Needs you" chip. */
function chip(t, id, text, color) {
  return div().id(id).flex_none().px(6).h(20).flex().items_center().rounded(5).bg(`${color}26`).text_size(11).font_medium().text_color(color).child(text);
}

/** A 24 px icon button; off when `enabled` is false. */
export function iconAction(t, id, path, onClick, { enabled = true, tooltip = null } = {}) {
  let el = div().id(id).flex_none().size(24).flex().items_center().justify_center().rounded(5).text_color(enabled ? t.muted : t.dim);
  if (tooltip) el = el.tooltip(tooltip);
  if (enabled) el = el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick);
  return el.child(svg(path).size(14));
}

/**
 * The pull request pane.
 * @param {object} t The theme.
 * @param {object} view What to show: `detail`, `verdict` (`verdictOf`), `summaries` (`sectionSummaries`),
 *   `open` (the open section ids), `checks` (`checkLayout`), `items` (`conversationItems`), `nameOf(login)`,
 *   `position` (`positionIn` or null), `hasCheckout`, `checkingOut`, `error`, `now`, `age(at, now)`,
 *   `icon(name)` (a path), `agentRows` (elements), `bottom` (an element: the area under the scroll).
 * @param {object} on Handlers, each given the click's `cx` last: `toggle(section, cx)`, `togglePassed(cx)`,
 *   `prev(cx)`, `next(cx)`, `openBrowser(cx)`, `checkOut(cx)`.
 */
export function prPane(t, view, on) {
  const { detail, verdict, position } = view;
  const pr = detail.pr;
  const color = verdictTone(t, verdict.group);
  const head = v_flex()
    .px(14)
    .pt(12)
    .gap(6)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(svg(view.icon(pr.provider === "gitlab" ? "gitlab" : "github")).size(14).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(`${pr.repo} · #${pr.number}`))
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
    .child(div().text_size(16).font_semibold().whitespace_normal().child(pr.title))
    .child(div().text_size(12).text_color(t.dim).whitespace_normal().child(`${pr.headRef} → ${pr.baseRef}`))
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
    .when(!view.hasCheckout, (el) => el.child(div().text_size(11.5).text_color(t.muted).child("No local checkout")))
    .when(view.checkingOut, (el) => el.child(div().text_size(11.5).text_color(t.muted).child("Checking out…")))
    .when(Boolean(view.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).whitespace_normal().child(view.error ?? "")));

  const parts = [head];
  for (const [id, label] of SECTIONS) {
    const open = view.open.has(id);
    parts.push(
      h_flex()
        .id(`sec-${id}`)
        .mt(4)
        .px(14)
        .py(6)
        .gap(6)
        .items_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => on.toggle(id, cx))
        .child(svg(view.icon(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
        .child(div().flex_none().text_size(11.5).font_medium().text_color(t.dim).child(label))
        .child(div().flex_1())
        .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(view.summaries[id] ?? "")),
    );
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
      if (rows.length === 0 && passedLine === null) return [muted(t, "No checks")];
      const out = rows.map((check, index) => checkRow(t, `check-${index}`, check));
      if (passedLine !== null) {
        out.push(
          h_flex()
            .id("checks-passed")
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
      return out;
    }
    case "reviews":
      if (detail.reviewers.length === 0) return [muted(t, "No reviewers")];
      return detail.reviewers.map((reviewer, index) =>
        h_flex()
          .id(`reviewer-${index}`)
          .gap(8)
          .child(div().flex_1().min_w(0).truncate().child(view.nameOf(reviewer.name)))
          .child(div().flex_none().text_color(reviewer.state === "changes_requested" ? t.blocked : reviewer.state === "approved" ? t.done : t.muted).child(REVIEWER_WORDS[reviewer.state] ?? reviewer.state)),
      );
    case "agent":
      if (!view.hasCheckout) return [muted(t, "No local checkout, so no review agent can start here.")];
      return view.agentRows.length > 0 ? view.agentRows : [muted(t, "No review agent yet. Review with agent starts one.")];
    case "description":
      return [detail.body.trim() === "" ? muted(t, "No description") : markdown(t, "md-description", detail.body)];
    default: {
      const rows = [];
      if (detail.threadsError) rows.push(div().text_size(11.5).text_color(t.blocked).whitespace_normal().child(`File comments could not be read: ${detail.threadsError}`));
      if (detail.threadsNote) rows.push(div().text_size(11.5).text_color(t.muted).child(detail.threadsNote));
      if (view.items.length === 0) rows.push(muted(t, "No comments"));
      view.items.forEach((item, index) => rows.push(itemView(t, view, item, index)));
      return rows;
    }
  }
}

function checkRow(t, id, check) {
  const color = check.state === "failed" ? t.blocked : check.state === "running" ? t.working : t.muted;
  const mark = check.state === "failed" ? "✗" : check.state === "running" ? "●" : "✓";
  return h_flex().id(id).gap(8).child(div().flex_none().text_color(color).child(mark)).child(div().flex_1().min_w(0).whitespace_normal().child(check.name));
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
        .child(div().flex_none().font_semibold().child(view.nameOf(entry.author)))
        .child(div().flex_none().text_color(t.muted).child(action))
        .when(entry.kind === "review" && entry.state !== null, (el) => el.child(chip(t, `item-state-${index}`, STATE_WORDS[entry.state] ?? entry.state, stateColor)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(view.age(entry.at, view.now))),
    )
    .when(entry.body.trim() !== "", (el) => el.child(markdown(t, `md-item-${index}`, entry.body)))
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
              .child(div().text_size(11.5).text_color(t.dim).child(`${view.nameOf(comment.author)} · ${view.age(comment.at, view.now)}`))
              .child(markdown(t, `md-thread-${key}-${n}`, comment.body)),
          ),
        ),
    );
}
