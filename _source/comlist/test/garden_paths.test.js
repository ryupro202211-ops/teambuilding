"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadGardenPaths } = require("../garden_paths.js");

test("設定ファイルがあれば各パスをそこから読む", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-"));
  const file = path.join(dir, "garden.config.json");
  fs.writeFileSync(file, JSON.stringify({
    gardenRoot: "C:\\x\\garden",
    gardenToken: "C:\\x\\.garden_token",
    gmailOAuthClient: "C:\\x\\client.json",
    gmailOAuthToken: "C:\\x\\token.json"
  }));
  const p = loadGardenPaths({ configPath: file });
  assert.equal(p.gardenRoot, path.resolve("C:\\x\\garden"));
  assert.equal(p.gardenToken, path.resolve("C:\\x\\.garden_token"));
  assert.equal(p.gmailOAuthClient, path.resolve("C:\\x\\client.json"));
  assert.equal(p.gmailOAuthToken, path.resolve("C:\\x\\token.json"));
});

test("設定ファイルが無ければ従来の場所を使う", () => {
  const p = loadGardenPaths({ configPath: path.join(os.tmpdir(), "no-such-garden.json"), projectDir: "C:\\a\\b\\c" });
  assert.equal(p.gardenRoot, path.resolve("C:\\a\\b\\c"));
  assert.equal(p.gardenToken, path.resolve("C:\\a\\.garden_token"));
  assert.equal(p.gmailOAuthClient, path.resolve("C:\\Users\\ryupr\\claude-work\\.gmail_oauth_client.json"));
});

test("設定ファイルが壊れていたら黙って既定値にせず止める", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-"));
  const file = path.join(dir, "garden.config.json");
  fs.writeFileSync(file, "{broken");
  assert.throws(() => loadGardenPaths({ configPath: file }), /garden\.config\.json/);
});
