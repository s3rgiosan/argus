// The Settings window: `argus.json` in Herdr's code editor. Save checks the
// text with the rules the mods use, and writes only when the file on disk is
// still the text the window last read.

import { View, div } from "gpui-kit";
import { v_flex, Editor, EditorState } from "gpui-base";
import { appHome, home, readTextFile, writeTextFile, settings, theme } from "herdr";
import { checkArgusFile } from "./argus-file.js";
import { tildePath } from "./paths.js";
import { frame, header, footer, button, note } from "./ui.js";
import { TEMPLATE, isDirty, revertStep, saveFailure, statusText } from "./settings-logic.js";

const FILE = "argus.json";

export default class ArgusSettings extends View {
  init(_props, cx) {
    this.path = `${appHome()}/${FILE}`;
    // The editor state, made once the file is read.
    this.state = null;
    // The file text at the last read or save; null when the file is missing.
    this.base = null;
    this.loaded = false;
    this.loadError = null;
    this.problems = [];
    this.error = null;
    this.asking = false;
    this.saving = false;
    // A read runs; Save and Revert wait for it.
    this.loading = false;
    this.saved = null;
    this.closed = false;
    this.load(cx);
  }

  close() {
    this.closed = true;
    this.state?.release();
    this.state = null;
  }

  /** Reads the file into the editor: its text, or the template when it is missing. */
  load(cx) {
    this.loading = true;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      if (this.closed) return;
      try {
        const text = await readTextFile(this.path);
        if (this.closed) return;
        this.base = text;
        this.loadError = null;
        const value = text ?? TEMPLATE;
        if (this.state) this.state.set_value(value);
        else this.state = this.editor(value);
      } catch (error) {
        const message = `Could not read ${FILE} (${error instanceof Error ? error.message : String(error)})`;
        // With an editor on screen, the reason goes to the status line.
        if (this.state) this.error = message;
        else this.loadError = message;
      } finally {
        this.loading = false;
        this.loaded = true;
        if (!this.closed) cx.notify();
      }
    });
  }

  /** A JSON editor with the theme's syntax colors. An edit clears the ask and the old problems. */
  editor(value) {
    const t = theme();
    const state = EditorState.new({
      language: "json",
      value,
      soft_wrap: true,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
    });
    state.on("change", (_e, cx) => {
      this.asking = false;
      this.problems = [];
      cx.notify();
    });
    return state;
  }

  dirty() {
    return this.state !== null && isDirty(this.state.value(), this.base);
  }

  /** Checks the text, then writes it only when the file still holds the text last read. */
  save(cx) {
    if (!this.state || this.saving || this.loading) return;
    const text = this.state.value();
    const expected = this.base;
    this.asking = false;
    this.error = null;
    this.problems = checkArgusFile(text, home());
    if (this.problems.length > 0) {
      cx.notify();
      return;
    }
    this.saving = true;
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      try {
        await writeTextFile(this.path, text, expected);
        this.base = text;
        this.saved = new Date();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let onDisk = expected;
        try {
          onDisk = await readTextFile(this.path);
        } catch {
          // The file cannot be read now, so the write's own reason is the message.
        }
        this.error = saveFailure(expected, onDisk, message);
      } finally {
        this.saving = false;
        cx.notify();
      }
    });
  }

  /** Reloads the file. With unsaved changes, the first click asks and the second reloads. */
  revert(cx) {
    if (this.saving || this.loading) return;
    if (revertStep(this.dirty(), this.asking) === "ask") {
      this.asking = true;
      cx.notify();
      return;
    }
    this.asking = false;
    this.problems = [];
    this.error = null;
    this.saved = null;
    this.load(cx);
  }

  render() {
    const t = theme();
    const path = div().min_w(0).truncate().text_size(12).text_color(t.dim).child(tildePath(this.path, home()));
    const status = statusText({ base: this.base, dirty: this.dirty(), asking: this.asking, problems: this.problems, saved: this.saved, error: this.error });
    const font = settings();
    const busy = this.saving || this.loading;
    let body;
    if (this.state) {
      body = Editor.new(this.state).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0);
    } else {
      body = v_flex().flex_1().min_h(0).child(note(t, this.loadError ?? (this.loaded ? "" : `Loading ${FILE}…`)));
    }
    return frame(t, "argus-settings")
      .child(header(t, "Settings", [path]))
      .child(body)
      .child(
        footer(t)
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .text_size(12)
              .text_color(status.level === "error" ? t.blocked : t.dim)
              .children(status.text.split("\n").filter(Boolean).map((line) => div().whitespace_normal().child(line))),
          )
          .child(button(t, "argus-settings-revert", "Revert", (_e, cx) => this.revert(cx), { enabled: !busy }))
          .child(button(t, "argus-settings-save", this.saving ? "Saving…" : "Save", (_e, cx) => this.save(cx), { primary: true, enabled: Boolean(this.state) && !busy })),
      );
  }
}
