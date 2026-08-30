import { describe, expect, it } from "vitest";

import {
  DEFAULT_BLOCK_DEFINITIONS,
  DEFAULT_FONT_FAMILY,
  normalizeSettings,
  uniqueCustomType,
} from "../src/settings-model";

describe("settings", () => {
  it("starts with a fixed proof followed by seven regular definitions", () => {
    const settings = normalizeSettings(null);
    expect(settings.blocks).toHaveLength(8);
    expect(settings.blocks.filter((block) => block.numbered)).toHaveLength(6);
    expect(settings.blocks[0]?.type).toBe("proof");
  });

  it("restores proof first in stored settings", () => {
    const settings = normalizeSettings({
      blocks: [
        {
          type: "proof",
          title: { family: "sans-serif", style: "bold" },
          body: { family: "monospace", style: "italic" },
          numbered: true,
        },
        DEFAULT_BLOCK_DEFINITIONS[1],
      ],
    });

    expect(settings.blocks.map((block) => block.type)).toEqual([
      "proof",
      "definition",
    ]);
    expect(settings.blocks[0]).toEqual({
      type: "proof",
      title: { family: "sans-serif", style: "bold" },
      body: { family: "monospace", style: "italic" },
      numbered: false,
    });
  });

  it("keeps valid custom definitions and removes invalid duplicates", () => {
    const settings = normalizeSettings({
      blocks: [
        {
          type: "axiom",
          title: {
            family: '"STIX Two Text", serif',
            style: "bold-italic",
          },
          body: { family: "monospace", style: "roman" },
          numbered: true,
        },
        { type: "axiom", numbered: false },
        { type: "not valid", numbered: false },
      ],
    });

    expect(settings.blocks).toEqual([
      {
        type: "proof",
        title: { family: DEFAULT_FONT_FAMILY, style: "italic" },
        body: { family: DEFAULT_FONT_FAMILY, style: "roman" },
        numbered: false,
      },
      {
        type: "axiom",
        title: {
          family: '"STIX Two Text", serif',
          style: "bold-italic",
        },
        body: { family: "monospace", style: "roman" },
        numbered: true,
      },
    ]);
  });

  it("uses the default family when a stored family is empty", () => {
    const settings = normalizeSettings({
      blocks: [{
        type: "definition",
        title: { family: "  ", style: "bold" },
        body: { family: "Aptos, sans-serif", style: "roman" },
        numbered: true,
      }],
    });

    expect(settings.blocks[1]?.title.family).toBe(DEFAULT_FONT_FAMILY);
    expect(settings.blocks[1]?.body.family).toBe("Aptos, sans-serif");
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
