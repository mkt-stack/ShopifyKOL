// Runs the fixtures straight against the JS (no wasm build), so the rule can
// be checked on machines where the function runner can't start (Windows).
// default.test.js runs the same fixtures through the compiled wasm.
import path from "path";
import fs from "fs";
import { describe, test, expect } from "vitest";
import { cartValidationsGenerateRun } from "../src/cart_validations_generate_run";

const fixturesDir = path.join(__dirname, "fixtures");

describe("weekly order limit rule", () => {
  for (const file of fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"))) {
    test(file, () => {
      const { payload } = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), "utf8"));
      expect(cartValidationsGenerateRun(payload.input)).toEqual(payload.output);
    });
  }
});
