import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { defaultConfig, loadConfig } from "../src/config.js";

test("默认配置包含数据目录与文案目录", () => {
  const cfg = defaultConfig("D:/demo");
  assert.equal(cfg.dataDir, join("D:/demo", "data"));
  assert.equal(cfg.copiesDir, join(cfg.stateDir, "copies"));
});

test("loadConfig:stateDir 环境变量联动重算 copiesDir", async () => {
  const prev = process.env.MINI_OPENCLAW_STATE_DIR;
  const tmp = mkdtempSync(join(tmpdir(), "cfg-"));
  process.env.MINI_OPENCLAW_STATE_DIR = tmp;
  try {
    const cfg = await loadConfig(process.cwd());
    assert.equal(cfg.stateDir, tmp);
    assert.equal(cfg.copiesDir, join(tmp, "copies"));
    assert.equal(cfg.sessionDir, join(tmp, "sessions"));
    assert.equal(cfg.agentDir, join(tmp, "agent"));
  } finally {
    if (prev === undefined) delete process.env.MINI_OPENCLAW_STATE_DIR;
    else process.env.MINI_OPENCLAW_STATE_DIR = prev;
  }
});
