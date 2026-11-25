import { describe, expect, it } from "vitest";
import { cellText, mapHeaders, parseCsv, rowsFromTable, templateCsv } from "./spreadsheet";

describe("parseCsv", () => {
  it("handles quotes, commas and blank lines", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
  it("strips the Excel byte-order mark", () => {
    expect(parseCsv("﻿Name\nAda")[0][0]).toBe("Name");
  });
});

describe("mapHeaders", () => {
  it("recognises common column names", () => {
    const { map, missing } = mapHeaders(["Surname", "First Name", "Sex", "Class", "Parent Phone", "Adm No"]);
    expect(map).toEqual(["lastName", "firstName", "gender", "className", "guardianPhone", "admissionNo"]);
    expect(missing).toEqual([]);
  });
  it("reports required columns that are missing", () => {
    expect(mapHeaders(["Name", "Class"]).missing).toEqual(["First name", "Surname", "Gender"]);
  });
});

describe("rowsFromTable", () => {
  it("skips empty rows and fixes Excel's dates and phone numbers", () => {
    const { rows } = rowsFromTable([
      ["First name", "Surname", "Gender", "Class", "Date of birth", "Guardian phone"],
      ["Ada", "Obi", "F", "JSS 1", new Date(Date.UTC(2014, 4, 30)), 8031234567],
      ["", "", "", "", "", ""],
    ]);
    expect(rows).toEqual([{ firstName: "Ada", lastName: "Obi", gender: "F", className: "JSS 1", dateOfBirth: "30/05/2014", guardianPhone: "08031234567" }]);
  });
});

describe("template", () => {
  it("round-trips through the parser with every column recognised", () => {
    const table = parseCsv(templateCsv());
    expect(mapHeaders(table[0]).map.every(Boolean)).toBe(true);
    expect(rowsFromTable(table).rows[0].className).toBe("Primary 6");
  });
  it("keeps text cells as text", () => {
    expect(cellText(" JSS 1 ", "className")).toBe("JSS 1");
  });
});
