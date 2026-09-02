import { describe, expect, it } from "bun:test";

import { csvLine, exportCell, exportLine } from "./csv.ts";

describe("csv writers", () => {
  it("quotes what RFC 4180 says and prints structured values as JSON", () => {
    expect(csvLine(["a,b", 'say "hi"', null, 7, true, { k: [1] }])).toBe(
      '"a,b","say ""hi""",,7,true,"{""k"":[1]}"'
    );
  });

  it("neutralises a formula in an export but not in a file Testate reads back", () => {
    expect(exportCell("=1+1")).toBe("'=1+1");
    expect(exportCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(exportCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(exportCell("-x")).toBe("'-x");
    expect(csvLine(["=1+1", "-x"])).toBe("=1+1,-x");
  });

  it("leaves a negative number a number", () => {
    expect(exportLine([-5, "-5", "-.5", "-0"])).toBe("-5,-5,-.5,-0");
  });
});
