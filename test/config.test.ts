import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("최소 설정에 안전한 기본값을 적용한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "admob-config-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify({ publisherId: "pub-1234567890123456" }));

  const config = await loadConfig(path);

  assert.equal(config.reportType, "mediation");
  assert.equal(config.oauthTokenFile, ".data/oauth-token.json");
  assert.equal(config.discordWebhookEnv, "DISCORD_WEBHOOK_URL");
});

test("잘못된 게시자 ID를 거부한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "admob-config-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify({ publisherId: "1234" }));

  await assert.rejects(loadConfig(path), /publisherId/);
});
