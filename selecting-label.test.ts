import { describe, expect, it } from "vitest";
import {
  SELECTING_LABEL_BASE,
  selectingLabel,
  selectingLabelDots,
  toCssContentString,
} from "./selecting-label.js";

describe("selectingLabelDots", () => {
  it("cycles one to three dots and wraps", () => {
    expect([0, 1, 2, 3, 4, 5].map(selectingLabelDots)).toEqual([
      ".",
      "..",
      "...",
      ".",
      "..",
      "...",
    ]);
  });

  it("never returns an empty run for a large tick", () => {
    expect(selectingLabelDots(1_000_001)).toBe("...");
  });
});

describe("selectingLabel", () => {
  it("animates the dots after the base sentence", () => {
    expect(selectingLabel(0)).toBe(`${SELECTING_LABEL_BASE}.`);
    expect(selectingLabel(2)).toBe(`${SELECTING_LABEL_BASE}...`);
  });

  it("collapses to a static ellipsis under reduced motion", () => {
    expect(selectingLabel(0, true)).toBe(`${SELECTING_LABEL_BASE}…`);
    expect(selectingLabel(7, true)).toBe(selectingLabel(0, true));
  });
});

describe("toCssContentString", () => {
  it("quotes the label for CSS content", () => {
    expect(toCssContentString("Selecting a model for the job..")).toBe(
      '"Selecting a model for the job.."',
    );
  });

  it("escapes quotes and backslashes so the declaration cannot be broken", () => {
    expect(toCssContentString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
