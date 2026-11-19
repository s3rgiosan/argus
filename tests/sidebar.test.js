import { test } from "node:test";
import assert from "node:assert/strict";
import { SIDEBAR, SidebarError, ownsSidebar, patchSidebar, sidebarManifest, useSidebar } from "../scripts/sidebar.mjs";

// The part of Herdr's sidebar that the patch changes, in the shape it ships.
const SHIPPED = `export default class Spaces {
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const branch = raw === "main" ? "" : raw;
    const repo = tree ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \\u00b7 ");
    return h_flex()
      .when(Boolean(where), (el) => el.child(div().child(where)))
      .when(g.ahead > 0, (el) => el.child(\`\\u2191\${g.ahead}\`))
      .when(g.behind > 0, (el) => el.child(\`\\u2193\${g.behind}\`));
  }

  row() {
    const where = "elsewhere";
    return where;
  }
}
`;

test("patchSidebar: the space row shows no repo or branch text", () => {
  const out = patchSidebar(SHIPPED);
  const tail = out.slice(out.indexOf("gitTail("), out.indexOf("row()"));
  assert.match(tail, /^    const where = "";$/m);
  assert.doesNotMatch(tail, /filter\(Boolean\)\.join/);
});

test("patchSidebar: keeps the ahead and behind counts and the rest of the file", () => {
  const out = patchSidebar(SHIPPED);
  assert.match(out, /g\.ahead > 0/);
  assert.match(out, /g\.behind > 0/);
  assert.match(out, /const where = "elsewhere";/);
});

test("patchSidebar: refuses a sidebar whose gitTail changed", () => {
  assert.throws(() => patchSidebar(SHIPPED.replace("gitTail(g", "spaceTail(g")), SidebarError);
  assert.throws(() => patchSidebar(SHIPPED.replace('    const where = [repo', "    const place = [repo")), SidebarError);
  assert.throws(() => patchSidebar(SHIPPED.replaceAll("g.ahead", "g.up")), SidebarError);
  assert.throws(() => patchSidebar(SHIPPED + "\n  gitTail(other) {\n  }\n"), SidebarError);
});

test("sidebarManifest and ownsSidebar: the copy is named and marked as Argus's", () => {
  const manifest = sidebarManifest({ place: "none", title: "Spaces" });
  assert.deepEqual(manifest, { place: "none", title: "Spaces (Argus)", generated_by: "argus" });
  assert.equal(ownsSidebar(manifest), true);
  assert.equal(ownsSidebar({ title: "Spaces" }), false);
  assert.equal(ownsSidebar(null), false);
});

test("useSidebar: every block that shows the shipped sidebar shows the copy", () => {
  const layout = { id: "root", children: [{ id: "spaces", content: { mod: "spaces" } }, { id: "agents", content: { mod: "agents" } }] };
  const out = useSidebar(layout, SIDEBAR);
  assert.equal(out.children[0].content.mod, "argus-spaces");
  assert.equal(out.children[1].content.mod, "agents");
  assert.equal(layout.children[0].content.mod, "spaces");
});
