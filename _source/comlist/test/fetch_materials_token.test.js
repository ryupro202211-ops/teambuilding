"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { resolveTokenFile } = require("../fetch_materials.js");

test("作業フォルダの2階層上にあるトークンを参照する", () => {
  const projectDir = path.join("C:\\Users\\example", "Codex-work", "チームビルディング", "マイベストライフ");
  assert.equal(
    resolveTokenFile(projectDir),
    path.join("C:\\Users\\example", "Codex-work", ".garden_token")
  );
});
