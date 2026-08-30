import { MarkdownView, Plugin } from "obsidian";

import { BlockIndex } from "./block-index";
import { createBlockEditorExtension } from "./editor-extension";
import { processReadingModeBlocks } from "./reading-mode";
import { ReferenceSuggest } from "./reference-suggest";
import {
  normalizeSettings,
  type MathBlockSettings,
} from "./settings-model";
import { MathBlockSettingTab } from "./settings-tab";

export default class MathBlockPlugin extends Plugin {
  config!: MathBlockSettings;
  private index!: BlockIndex;

  async onload(): Promise<void> {
    this.config = normalizeSettings(await this.loadData());
    this.index = new BlockIndex(this.app, () => this.config.blocks);
    this.index.register(this);

    this.registerEditorExtension(
      createBlockEditorExtension(this, () => this.config.blocks),
    );
    this.registerEditorSuggest(
      new ReferenceSuggest(this, this.index, () => this.config.blocks),
    );
    this.registerMarkdownPostProcessor((element, context) =>
      processReadingModeBlocks(
        this,
        this.index,
        () => this.config.blocks,
        element,
        context,
      ),
    );
    this.addSettingTab(new MathBlockSettingTab(this.app, this));
  }

  async saveSettings(clearIndex = true): Promise<void> {
    // The editor state tracks definition changes by array identity.
    this.config.blocks = [...this.config.blocks];
    await this.saveData(this.config);
    if (clearIndex) {
      this.index.clear();
    }
    this.app.workspace.updateOptions();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        view.previewMode.rerender(true);
      }
    }
  }
}
