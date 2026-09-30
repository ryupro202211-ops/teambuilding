"use strict";

/* フォルダ位置に依存するパスを1か所で解決する。
   正本は ASCII パスの C:\Users\ryupr\claude-work\garden.config.json で、PowerShell 側
   (garden_publish.ps1 / _deploy_garden.ps1 / _rm_garden_work.ps1) も同じファイルを読む。
   フォルダを動かしたときに直すのはこの設定ファイルだけ。 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONFIG_PATH = "C:\\Users\\ryupr\\claude-work\\garden.config.json";
const CLAUDE_WORK = "C:\\Users\\ryupr\\claude-work";

function loadGardenPaths(options = {}) {
  const configPath = options.configPath || process.env.GARDEN_CONFIG || DEFAULT_CONFIG_PATH;
  const projectDir = options.projectDir || __dirname;
  const defaults = {
    gardenRoot: projectDir,
    gardenToken: path.join(projectDir, "..", "..", ".garden_token"),
    gmailOAuthClient: path.join(CLAUDE_WORK, ".gmail_oauth_client.json"),
    gmailOAuthToken: path.join(CLAUDE_WORK, ".gmail_oauth_token.json")
  };
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
    } catch (e) {
      throw new Error("garden.config.json を読めません: " + configPath + " (" + e.message + ")");
    }
  }
  const out = {};
  for (const key of Object.keys(defaults)) {
    const value = typeof config[key] === "string" && config[key] ? config[key] : defaults[key];
    out[key] = path.resolve(value);
  }
  return out;
}

module.exports = { loadGardenPaths, DEFAULT_CONFIG_PATH };
