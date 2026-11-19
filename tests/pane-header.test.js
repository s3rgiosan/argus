import { test } from "node:test";
import assert from "node:assert/strict";
import { PANE_HEADER, PaneHeaderError, ownsHeader, paneHeaderManifest, patchPaneHeader, useHeader } from "../scripts/pane-header.mjs";

// The parts of Herdr's pane header that the patch changes, in the shape it ships.
const SHIPPED = `import { View, div } from "gpui-kit";
import { panes, props, run, theme, home, layout } from "herdr";

export default class Pane extends View {
  render(cx) {
    const p = this.me();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    return div()
      .child(div().flex_none().truncate().max_w(260).font_medium().child(name))
      .child(div().flex_1().truncate().child("~/folder"));
  }
}
`;

test("patchPaneHeader: a mod pane shows the title its mod shares, else the shipped name", () => {
  const out = patchPaneHeader(SHIPPED);
  assert.match(out, /import \{ panes, props, run, theme, home, layout, shared \} from "herdr";/);
  assert.match(out, /const name = paneTitle\(p\) \?\? \(\(\(p\.program\?\.agent \|\| p\.program\?\.shell\) && p\.program\.name\) \|\| p\.title \|\| p\.program\?\.name \|\| "shell"\);/);
  assert.match(out, /function paneTitle\(p\)/);
});

test("patchPaneHeader: the added helper reads <mod>.paneTitle and skips empty values", () => {
  const out = patchPaneHeader(SHIPPED);
  const helper = out.slice(out.indexOf("function paneTitle"));
  const paneTitle = new Function("shared", `${helper}; return paneTitle;`);
  const store = { "argus-tsk.paneTitle": "T12 · Example task", "argus-pull-requests.paneTitle": "" };
  const read = paneTitle((key) => store[key]);
  assert.equal(read({ mod: "argus-tsk", title: "argus-tsk" }), "T12 · Example task");
  assert.equal(read({ mod: "argus-pull-requests" }), null);
  assert.equal(read({ mod: "other" }), null);
  assert.equal(read({ terminal: "t1", title: "zsh" }), null);
});

test("patchPaneHeader: keeps shared when Herdr already imports it", () => {
  const out = patchPaneHeader(SHIPPED.replace("home, layout }", "home, layout, shared }"));
  assert.match(out, /import \{ panes, props, run, theme, home, layout, shared \} from "herdr";/);
});

test("patchPaneHeader: refuses a header whose name line or herdr import changed", () => {
  assert.throws(() => patchPaneHeader(SHIPPED.replace("const name =", "const label =")), PaneHeaderError);
  assert.throws(() => patchPaneHeader(SHIPPED.replace('from "herdr";', 'from "herdr/api";')), PaneHeaderError);
  assert.throws(() => patchPaneHeader(SHIPPED.replace("render(cx) {", "render(cx) {\n    const name = 1;")), PaneHeaderError);
});

test("paneHeaderManifest: names the copy and marks it as Argus's", () => {
  assert.deepEqual(paneHeaderManifest({ place: "none", title: "Pane header" }), {
    place: "none",
    title: "Pane header (Argus)",
    generated_by: "argus",
  });
});

test("useHeader: every pane header that uses the shipped mod uses the copy", () => {
  const layout = {
    id: "root",
    children: [
      { id: "a", content: { tab: "active", pane: { header: { content: { mod: "pane" }, height: 30 } } } },
      { id: "b", content: { mod: "pane" } },
      { id: "c", content: { tab: "active", pane: { header: { content: { mod: "custom" } } } } },
    ],
  };
  const out = useHeader(layout, PANE_HEADER);
  assert.equal(out.children[0].content.pane.header.content.mod, "argus-pane");
  assert.equal(out.children[0].content.pane.header.height, 30);
  // Only pane headers change.
  assert.equal(out.children[1].content.mod, "pane");
  assert.equal(out.children[2].content.pane.header.content.mod, "custom");
  assert.equal(layout.children[0].content.pane.header.content.mod, "pane");
});

test("patchPaneHeader: refuses a header that already has a paneTitle or its own shared", () => {
  assert.throws(() => patchPaneHeader(SHIPPED + "\nfunction paneTitle() {}\n"), PaneHeaderError);
  assert.throws(() => patchPaneHeader(SHIPPED.replace("home, layout }", "home, layout, shared as read }")), PaneHeaderError);
  assert.throws(() => patchPaneHeader(SHIPPED + "\nconst shared = 1;\n"), PaneHeaderError);
});

test("patchPaneHeader: changes the name line itself, not an earlier copy of its text", () => {
  const line = SHIPPED.split("\n").find((l) => l.includes("const name ="));
  const source = SHIPPED.replace("export default", `//${line}\nexport default`);
  const out = patchPaneHeader(source);
  assert.ok(out.includes(`//${line}\n`));
  assert.match(out, /^    const name = paneTitle\(p\) \?\? \(\(\(p\.program/m);
});

test("ownsHeader: only a mod.json with the marker", () => {
  assert.equal(ownsHeader({ generated_by: "argus" }), true);
  assert.equal(ownsHeader({ generated_by: "someone" }), false);
  assert.equal(ownsHeader(null), false);
});

test("patchPaneHeader: a blank line before the name line keeps the indent", () => {
  const out = patchPaneHeader(SHIPPED.replace("    const name =", "\n    const name ="));
  assert.match(out, /\n\n    const name = paneTitle\(p\)/);
});

test("patchPaneHeader: the name shrinks, so a long title leaves room for the hover buttons", () => {
  const out = patchPaneHeader(SHIPPED);
  assert.match(out, /^      \.child\(div\(\)\.flex_initial\(\)\.min_w\(0\)\.truncate\(\)\.max_w\(260\)\.font_medium\(\)\.child\(name\)\)$/m);
  assert.doesNotMatch(out, /flex_none\(\)\.truncate\(\)\.max_w\(260\)/);
});

test("patchPaneHeader: refuses a header whose name element changed", () => {
  assert.throws(() => patchPaneHeader(SHIPPED.replace(".flex_none().truncate().max_w(260)", ".truncate()")), PaneHeaderError);
});
