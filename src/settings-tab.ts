import {
  ButtonComponent,
  PluginSettingTab,
  setIcon,
  type App,
  type Plugin,
  type SettingDefinitionItem,
} from "obsidian";

import { FontSuggest } from "./font-suggest";
import {
  BLOCK_TYPE_PATTERN,
  DEFAULT_FONT_FAMILY,
  quoteFontFamily,
  uniqueCustomType,
  type BlockDefinition,
  type MathBlockSettings,
  type Typography,
} from "./settings-model";

type SettingsPlugin = Plugin & {
  config: MathBlockSettings;
  saveSettings(clearIndex?: boolean): Promise<void>;
};

export class MathBlockSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly settingsPlugin: SettingsPlugin,
  ) {
    super(app, settingsPlugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        items: [
          {
            name: "Block type table",
            desc: "Pick an installed font or type its name. Numbered rows share one counter.",
            aliases: ["font", "typography", "numbering", "custom block"],
            render: (setting) => {
              setting.settingEl.empty();
              setting.settingEl.addClass("math-block-settings-container");
              this.renderTable(setting.settingEl);
            },
          },
        ],
      },
    ];
  }

  private renderTable(container: HTMLElement): void {
    const table = container.createEl("table", {
      cls: "math-block-settings-table",
    });
    const columns = table.createEl("colgroup");
    for (const name of ["name", "title", "body", "numbering"]) {
      columns.createEl("col", {
        cls: `math-block-settings-${name}-column`,
      });
    }
    const header = table.createEl("thead").createEl("tr");
    for (const name of ["Name", "Title", "Body", "Number"]) {
      header.createEl("th", { text: name });
    }

    const tableBody = table.createEl("tbody");
    for (const block of this.settingsPlugin.config.blocks) {
      this.renderBlockRow(tableBody, block);
    }

    const addContainer = container.createDiv({ cls: "math-block-settings-add" });
    new ButtonComponent(addContainer)
      .setButtonText("Add block type")
      .onClick(() => {
        this.settingsPlugin.config.blocks.push({
          type: uniqueCustomType(this.settingsPlugin.config.blocks),
          title: { family: DEFAULT_FONT_FAMILY, style: "bold" },
          body: { family: DEFAULT_FONT_FAMILY, style: "roman" },
          numbered: false,
        });
        void this.settingsPlugin.saveSettings().then(() => this.update());
      });
  }

  private renderBlockRow(
    tableBody: HTMLTableSectionElement,
    block: BlockDefinition,
  ): void {
    const row = tableBody.createEl("tr");
    this.renderNameCell(row, block);
    this.renderTypographyCell(row, block.title);
    this.renderTypographyCell(row, block.body);

    const numberedCell = row.createEl("td", {
      cls: "math-block-settings-numbered",
    });
    const numbered = numberedCell.createEl("input", { type: "checkbox" });
    numbered.checked = block.numbered;
    numbered.addEventListener("change", () => {
      block.numbered = numbered.checked;
      void this.settingsPlugin.saveSettings();
    });
  }

  private renderNameCell(
    row: HTMLTableRowElement,
    block: BlockDefinition,
  ): void {
    const cell = row.createEl("td");
    const wrapper = cell.createDiv({ cls: "math-block-settings-name" });
    const input = wrapper.createEl("input", {
      type: "text",
      value: block.type,
    });
    input.setAttr("aria-label", "Block name");
    input.addEventListener("change", () => {
      const type = input.value.trim().toLowerCase();
      const duplicate = this.settingsPlugin.config.blocks.some(
        (candidate) => candidate !== block && candidate.type === type,
      );
      input.setCustomValidity(
        !BLOCK_TYPE_PATTERN.test(type)
          ? "Use a letter followed by letters, digits, or hyphens."
          : duplicate ? "A block with this name already exists." : "",
      );
      if (!input.reportValidity()) {
        return;
      }
      block.type = type;
      input.value = type;
      deleteButton.setAttr("aria-label", `Delete ${type}`);
      void this.settingsPlugin.saveSettings();
    });

    const deleteButton = wrapper.createEl("button", {
      cls: "clickable-icon math-block-settings-delete",
      attr: { "aria-label": `Delete ${block.type}` },
    });
    setIcon(deleteButton, "trash-2");
    deleteButton.addEventListener("click", () => {
      this.settingsPlugin.config.blocks = this.settingsPlugin.config.blocks.filter(
        (candidate) => candidate !== block,
      );
      void this.settingsPlugin.saveSettings().then(() => this.update());
    });
  }

  private renderTypographyCell(
    row: HTMLTableRowElement,
    typography: Typography,
  ): void {
    const cell = row.createEl("td");
    const wrapper = cell.createDiv({ cls: "math-block-settings-typography" });
    const familyField = wrapper.createDiv({
      cls: "math-block-settings-family",
    });
    const family = familyField.createEl("input", {
      type: "text",
      value: typography.family,
      attr: {
        "aria-label": "Font family",
        placeholder: "Font family",
        spellcheck: "false",
      },
    });
    const familyToggle = familyField.createEl("button", {
      cls: "clickable-icon math-block-settings-family-toggle",
      attr: { type: "button", tabindex: "-1", "aria-label": "Show fonts" },
    });
    setIcon(familyToggle, "chevron-down");
    // Keep focus in the input so the font list stays attached to it.
    familyToggle.addEventListener("mousedown", (event) => event.preventDefault());
    familyToggle.addEventListener("click", () => {
      if (family.ownerDocument.activeElement === family) {
        family.blur();
      } else {
        family.focus();
      }
    });
    const previewFamily = (): void => {
      family.style.setProperty(
        "font-family",
        quoteFontFamily(typography.family),
      );
    };
    const chooseFamily = (value: string): void => {
      family.setCustomValidity("");
      typography.family = value;
      family.value = value;
      previewFamily();
      void this.settingsPlugin.saveSettings(false);
    };
    family.addEventListener("focus", () => family.select());
    family.addEventListener("change", () => {
      const value = family.value.trim();
      family.setCustomValidity(value ? "" : "Enter a font name.");
      if (family.reportValidity()) {
        chooseFamily(value);
      }
    });
    new FontSuggest(
      this.settingsPlugin,
      family,
      () => typography.family,
      chooseFamily,
    );
    previewFamily();

    const styleControls = wrapper.createDiv({
      cls: "math-block-settings-style-controls",
    });

    let bold = typography.style === "bold" ||
      typography.style === "bold-italic";
    let italic = typography.style === "italic" ||
      typography.style === "bold-italic";

    const boldButton = styleControls.createEl("button", {
      cls: "math-block-settings-style-button math-block-settings-bold",
      text: "B",
      attr: { type: "button", "aria-label": "Bold" },
    });
    const italicButton = styleControls.createEl("button", {
      cls: "math-block-settings-style-button math-block-settings-italic",
      text: "I",
      attr: { type: "button", "aria-label": "Italic" },
    });

    const renderStyle = (): void => {
      boldButton.toggleClass("is-active", bold);
      italicButton.toggleClass("is-active", italic);
      boldButton.setAttr("aria-pressed", bold.toString());
      italicButton.setAttr("aria-pressed", italic.toString());
    };
    const updateStyle = (): void => {
      typography.style = bold
        ? italic ? "bold-italic" : "bold"
        : italic ? "italic" : "roman";
      renderStyle();
      void this.settingsPlugin.saveSettings(false);
    };

    boldButton.addEventListener("click", () => {
      bold = !bold;
      updateStyle();
    });
    italicButton.addEventListener("click", () => {
      italic = !italic;
      updateStyle();
    });
    renderStyle();
  }
}
