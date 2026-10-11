import { AbstractInputSuggest, Notice, type Plugin } from "obsidian";

import { quoteFontFamily } from "./settings-model";

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<{ family: string }[]>;
};

let fontList: Promise<string[]> | null = null;

async function querySystemFonts(): Promise<string[]> {
  const fontWindow = window as LocalFontWindow;
  if (!fontWindow.queryLocalFonts) {
    throw new Error("This device cannot list system fonts.");
  }
  const fonts = await fontWindow.queryLocalFonts();
  return [...new Set(fonts.map((font) => font.family))]
    .sort((a, b) => a.localeCompare(b));
}

function systemFonts(): Promise<string[]> {
  fontList ??= querySystemFonts();
  return fontList;
}

export class FontSuggest extends AbstractInputSuggest<string> {
  constructor(
    private readonly plugin: Plugin,
    inputEl: HTMLInputElement,
    private readonly getFamily: () => string,
    private readonly onChoose: (family: string) => void,
  ) {
    super(plugin.app, inputEl);
    this.limit = 1000;
  }

  protected async getSuggestions(query: string): Promise<string[]> {
    let families: string[];
    try {
      families = await systemFonts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`${this.plugin.manifest.name}: ${message}`);
      return [];
    }
    const search = query.trim().toLowerCase();
    // An unedited value lists every font, like a dropdown.
    if (!search || query === this.getFamily()) {
      return families;
    }
    return families.filter((family) => family.toLowerCase().includes(search));
  }

  renderSuggestion(family: string, el: HTMLElement): void {
    el.setText(family);
    el.style.setProperty("font-family", quoteFontFamily(family));
  }

  selectSuggestion(family: string): void {
    this.setValue(family);
    this.onChoose(family);
    this.close();
  }
}
