import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["08031234567", "+2348031234567"],
    ["0803 123 4567", "+2348031234567"],
    ["+234 803 123 4567", "+2348031234567"],
    ["2348031234567", "+2348031234567"],
    ["+44 7700 900123", "+447700900123"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "abc", "123", null, undefined])("rejects %s", (input) => {
    expect(normalizePhone(input as string)).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formats Nigerian numbers in local style", () => {
    expect(formatPhone("+2348031234567")).toBe("0803 123 4567");
  });
  it("leaves other numbers alone", () => {
    expect(formatPhone("+447700900123")).toBe("+447700900123");
  });
});
