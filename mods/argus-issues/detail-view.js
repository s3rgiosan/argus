// Draws the issue pane from plain data: the header, the facts, and the folding Description and
// Comments sections. State and reads stay in main.js; handlers come in through `on`.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { frame, scrollArea, iconButton, chip, errorLine } from "./ui.js";
import { SECTIONS, displayName, hiddenText, openedLine, stateText } from "./detail.js";

/** Muted text inside a section, with no padding of its own, so it lines up with the other rows. */
function muted(t, text) {
  return div().text_color(t.muted).whitespace_normal().child(text);
}

/** Markdown from the description or a comment, as Herdr's TextView draws it. A link goes to `on.openLink`. */
function markdown(id, text, on) {
  return TextView.markdown(id, text)
    .selectable(true)
    .on_link_click((url, cx) => on.openLink(url, cx));
}

/** A name with the login as its tooltip, so a display name cannot stand in for another login. */
function nameView(id, login, names) {
  let el = div().id(id).min_w(0).truncate().child(displayName(login, names));
  if (login !== "") el = el.tooltip(`@${login}`);
  return el;
}

/** One line of facts: a dim label, then the value. */
function factRow(t, id, label, value) {
  return h_flex().id(id).gap(8).items_start().text_size(12).child(div().w(72).flex_none().text_color(t.dim).child(label)).child(div().flex_1().min_w(0).whitespace_normal().child(value));
}

/**
 * The issue pane.
 * @param {object} t The theme.
 * @param {object} view What to show: `detail`, `names` (`namesOf`), `comments` (`commentItems`),
 *   `summaries` (`sectionSummaries`), `open` (the open section ids), `position` (`positionIn` or null),
 *   `error`, `now`, `age(at, now)`, `icon(name)` (a path).
 * @param {object} on Handlers, each given the click's `cx` last: `toggle(section, cx)`, `prev(cx)`,
 *   `next(cx)`, `openBrowser(cx)`, `openLink(url, cx)` (a link in Markdown text).
 */
export function issuePane(t, view, on) {
  const { detail, names, position } = view;
  const issue = detail.issue;
  const state = stateText(issue);
  const people = issue.assignees.map((person) => displayName(person.login, names)).join(", ");
  const head = v_flex()
    .px(14)
    .pt(12)
    .gap(6)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(svg(view.icon(issue.provider === "gitlab" ? "gitlab" : "github")).size(14).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(`${issue.repo} · #${issue.number}`))
        .child(div().flex_1())
        .when(position !== null, (el) =>
          el
            .child(div().flex_none().text_size(12).text_color(t.dim).child(`${position.index} of ${position.total}`))
            .child(iconButton(t, "issue-prev", view.icon("arrow-up"), (_e, cx) => on.prev(cx), { enabled: position.prev !== null, tooltip: "Previous issue" }))
            .child(iconButton(t, "issue-next", view.icon("arrow-down"), (_e, cx) => on.next(cx), { enabled: position.next !== null, tooltip: "Next issue" })),
        )
        .child(iconButton(t, "issue-browser", view.icon("external-link"), (_e, cx) => on.openBrowser(cx), { enabled: issue.url !== null, tooltip: "Open in browser" })),
    )
    .child(div().text_size(16).font_semibold().whitespace_normal().child(issue.title))
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
    if (open) parts.push(v_flex().px(14).pt(4).pb(10).gap(8).children(sectionBody(t, id, view, on)));
  }
  parts.push(div().h(10));

  return frame(t, "argus-issues-issue").rounded_none().border_0().child(scrollArea("argus-issues-issue-detail", parts, { padding: 0, gap: 0 }));
}

function sectionBody(t, id, view, on) {
  const { detail } = view;
  if (id === "description") {
    return [detail.body.trim() === "" ? muted(t, "No description") : div().text_color(t.foreground).child(markdown("md-description", detail.body, on))];
  }
  const rows = [];
  if (detail.commentsNote) rows.push(div().text_size(11).text_color(t.muted).child(detail.commentsNote));
  if (view.comments.length === 0) rows.push(muted(t, "No comments"));
  // A comment's key comes from its time and author; a repeated key gets `~2`, `~3` and so on.
  const seen = new Map();
  for (const comment of view.comments) {
    const base = `${comment.at}:${comment.author}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    rows.push(commentView(t, view, on, comment, count === 1 ? base : `${base}~${count}`));
  }
  return rows;
}

/** One comment: a header line (name, chips, age) and a balloon with its Markdown, or the hidden note. */
function commentView(t, view, on, comment, key) {
  const body =
    comment.hidden !== null
      ? div().p(10).text_size(12).text_color(t.dim).child(hiddenText(comment.hidden))
      : div().p(10).text_color(t.foreground).child(markdown(`md-comment-${key}`, comment.body, on));
  return v_flex()
    .id(`comment-${key}`)
    .gap(6)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(nameView(`comment-name-${key}`, comment.author, view.names).font_semibold())
        .when(comment.internal, (el) => el.child(chip(t, `comment-internal-${key}`, "internal", t.working)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.dim).child(view.age(comment.at, view.now))),
    )
    .child(v_flex().id(`balloon-${key}`).rounded(8).border_1().border_color(t.border).overflow_hidden().child(body));
}
