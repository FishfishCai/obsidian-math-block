import { describe, expect, it } from "vitest";

import {
  DEFAULT_BLOCK_DEFINITIONS,
  parseSettings,
  quoteFontFamily,
  uniqueCustomType,
} from "../src/settings-model";

const axiom = {
  type: "axiom",
  title: { family: "STIX Two Text", style: "bold-italic" },
  body: { family: "Menlo", style: "roman" },
  numbered: true,
};

describe("settings", () => {
  it("starts with seven default definitions", () => {
    const settings = parseSettings(null);
    expect(settings.blocks).toHaveLength(7);
    expect(settings.blocks.filter((block) => block.numbered)).toHaveLength(5);
    expect(settings.blocks[0]?.type).toBe("definition");
  });

  it("keeps stored definitions", () => {
    expect(parseSettings({ blocks: [axiom] })).toEqual({ blocks: [axiom] });
  });

  it("trims stored font families", () => {
    const settings = parseSettings({
      blocks: [{ ...axiom, body: { family: " Menlo ", style: "roman" } }],
    });
    expect(settings.blocks[0]?.body.family).toBe("Menlo");
  });

  it.each([
    ["a non-object", "settings"],
    ["a missing blocks list", {}],
    ["an invalid name", { blocks: [{ ...axiom, type: "not valid" }] }],
    ["a missing numbered flag", { blocks: [{ ...axiom, numbered: undefined }] }],
    ["an empty font family", {
      blocks: [{ ...axiom, title: { family: "  ", style: "bold" } }],
    }],
    ["an unknown font style", {
      blocks: [{ ...axiom, body: { family: "Menlo", style: "heavy" } }],
    }],
    ["a duplicate name", { blocks: [axiom, axiom] }],
  ])("rejects %s", (_case, value) => {
    expect(() => parseSettings(value)).toThrow();
  });

  it("quotes a family for CSS", () => {
    expect(quoteFontFamily("Times New Roman")).toBe('"Times New Roman"');
    expect(quoteFontFamily('A"B\\C')).toBe('"A\\"B\\\\C"');
  });

  it("creates a unique name for a new custom row", () => {
    expect(uniqueCustomType(DEFAULT_BLOCK_DEFINITIONS)).toBe("custom");
    expect(uniqueCustomType([
      ...DEFAULT_BLOCK_DEFINITIONS,
      { ...DEFAULT_BLOCK_DEFINITIONS[0]!, type: "custom" },
      { ...DEFAULT_BLOCK_DEFINITIONS[0]!, type: "custom-2" },
    ])).toBe("custom-3");
  });
});
