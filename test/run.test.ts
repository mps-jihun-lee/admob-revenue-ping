import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Config } from "../src/config.js";
import { runOnce } from "../src/run.js";

test("같은 날짜의 알림은 성공 후 다시 보내지 않는다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "admob-revenue-ping-"));
  const config: Config = {
    publisherId: "pub-1234567890123456",
    reportType: "mediation",
    oauthClientFile: "unused",
    oauthTokenFile: "unused",
    stateFile: join(directory, "state.json"),
    discordWebhookEnv: "DISCORD_WEBHOOK_URL",
  };
  let reportCalls = 0;
  let notifications = 0;
  const client = {
    async getAccount() {
      return {
        publisherId: config.publisherId,
        reportingTimeZone: "Asia/Seoul",
        currencyCode: "KRW",
      };
    },
    async getDailyRevenue() {
      reportCalls += 1;
      return [{
        appId: "app-1",
        appName: "테스트 앱",
        earningsMicros: 1_000_000,
        impressions: 10,
      }];
    },
  };
  const notifier = {
    async send() {
      notifications += 1;
    },
  };
  const now = new Date("2026-09-04T01:00:00.000Z");

  const first = await runOnce(config, client, notifier, { now });
  const second = await runOnce(config, client, notifier, { now });

  assert.deepEqual(first, { date: "2026-09-03", sent: true, appCount: 1 });
  assert.deepEqual(second, { date: "2026-09-03", sent: false, appCount: 0 });
  assert.equal(reportCalls, 1);
  assert.equal(notifications, 1);
});

test("전송 실패 시 날짜를 기록하지 않아 다음 실행에서 재시도한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "admob-revenue-ping-"));
  const config: Config = {
    publisherId: "pub-1234567890123456",
    reportType: "network",
    oauthClientFile: "unused",
    oauthTokenFile: "unused",
    stateFile: join(directory, "state.json"),
    discordWebhookEnv: "DISCORD_WEBHOOK_URL",
  };
  const client = {
    async getAccount() {
      return {
        publisherId: config.publisherId,
        reportingTimeZone: "UTC",
        currencyCode: "USD",
      };
    },
    async getDailyRevenue() {
      return [];
    },
  };
  let attempts = 0;
  const notifier = {
    async send() {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
    },
  };
  const now = new Date("2026-09-04T12:00:00.000Z");

  await assert.rejects(runOnce(config, client, notifier, { now }), /temporary failure/);
  const retry = await runOnce(config, client, notifier, { now });

  assert.equal(retry.sent, true);
  assert.equal(attempts, 2);
});
