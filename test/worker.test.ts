import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  parseWorkerAccounts, refreshAccessToken, runAdMobWorker, type AdMobWorkerEnv,
} from "../src/worker.js";

// node:sqlite를 D1 API 모양으로 감싼다. 실제 마이그레이션 SQL을 그대로 적용한다.
async function d1(): Promise<AdMobWorkerEnv["DB"] & { raw: DatabaseSync }> {
  const db = new DatabaseSync(":memory:");
  db.exec(await readFile("migrations/0001_admob_sends.sql", "utf8"));
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    async first<T>() { return (db.prepare(sql).get(...(args as never[])) ?? null) as T | null; },
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }; },
  });
  return { raw: db, prepare: (sql) => statement(sql) };
}

const NOW = new Date("2026-11-26T00:10:00.000Z"); // 09:10 KST → 보고 날짜 2026-11-25

interface FixtureOptions {
  discordStatus?: (publisher: string) => number;
  discordThrows?: boolean;
  tokenStatus?: number;
  tokenError?: string;
  reportStatus?: (publisher: string) => number;
  dryRun?: boolean;
}

async function fixture(options: FixtureOptions = {}) {
  const sent: Array<{ webhook: string; content: string }> = [];
  const tokenBodies: URLSearchParams[] = [];
  const db = await d1();
  const env: AdMobWorkerEnv = {
    DB: db,
    ACCOUNTS: JSON.stringify([
      {
        name: "여비", publisherId: "pub-111", reportType: "mediation", cumulativeStartDate: "2026-08-04",
        payoutTarget: 100, refreshTokenSecret: "YEOBEE_REFRESH_TOKEN", webhookSecret: "YEOBEE_WEBHOOK_URL",
      },
      {
        name: "반다라트", publisherId: "pub-222", cumulativeStartDate: "2026-01-01",
        refreshTokenSecret: "BANDALART_REFRESH_TOKEN", webhookSecret: "BANDALART_WEBHOOK_URL",
      },
    ]),
    OAUTH_CLIENT_ID: "client-id",
    OAUTH_CLIENT_SECRET: "client-secret",
    YEOBEE_REFRESH_TOKEN: "refresh-yeobee",
    BANDALART_REFRESH_TOKEN: "refresh-bandalart",
    YEOBEE_WEBHOOK_URL: "https://discord.com/api/webhooks/1/yeobee",
    BANDALART_WEBHOOK_URL: "https://discord.com/api/webhooks/2/bandalart",
    ...(options.dryRun ? { DRY_RUN: "true" } : {}),
  };
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com") {
      const body = init?.body as URLSearchParams;
      tokenBodies.push(body);
      if (options.tokenStatus) {
        return Response.json({ error: options.tokenError ?? "server_error" }, { status: options.tokenStatus });
      }
      return Response.json({ access_token: `access-${body.get("refresh_token")}`, expires_in: 3599 });
    }
    if (url.hostname === "discord.com") {
      if (options.discordThrows) throw new DOMException("timed out", "TimeoutError");
      const body = JSON.parse(String(init?.body)) as { content: string; allowed_mentions: unknown };
      assert.deepEqual(body.allowed_mentions, { parse: [] });
      assert.equal(url.searchParams.get("wait"), "true");
      const publisher = url.pathname.includes("yeobee") ? "pub-111" : "pub-222";
      const status = options.discordStatus?.(publisher) ?? 200;
      if (status === 200) sent.push({ webhook: url.pathname, content: body.content });
      return new Response("{}", { status });
    }
    assert.equal(url.hostname, "admob.googleapis.com");
    const publisher = decodeURIComponent(url.pathname.split("/")[3]!);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer access-refresh-${publisher === "pub-111" ? "yeobee" : "bandalart"}`);
    const status = options.reportStatus?.(publisher) ?? 200;
    if (status !== 200) return new Response("{}", { status });
    if (url.pathname === `/v1/accounts/${publisher}`) {
      return Response.json({ publisherId: publisher, reportingTimeZone: "Asia/Seoul", currencyCode: "KRW" });
    }
    assert.equal(url.pathname, `/v1/accounts/${publisher}/mediationReport:generate`);
    const spec = (JSON.parse(String(init?.body)) as { reportSpec: { dimensions?: string[] } }).reportSpec;
    if (!spec.dimensions) {
      return Response.json([{ header: {} }, { row: { metricValues: { ESTIMATED_EARNINGS: { microsValue: "42000000000" } } } }, { footer: {} }]);
    }
    return Response.json([
      { header: {} },
      {
        row: {
          dimensionValues: { APP: { value: "a", displayLabel: "테스트 앱 - 부제" }, PLATFORM: { value: "Android" } },
          metricValues: { ESTIMATED_EARNINGS: { microsValue: "1000000000" }, IMPRESSIONS: { integerValue: "100" } },
        },
      },
      { footer: {} },
    ]);
  }) as typeof fetch;
  const rows = () => db.raw.prepare("SELECT publisher_id, report_date, state FROM admob_sends ORDER BY publisher_id")
    .all().map((row) => ({ ...row }));
  return { env, fetcher, sent, tokenBodies, rows };
}

test("계정마다 전날 수익을 한 번 보내고, 같은 날 다시 실행하면 건너뛴다", async () => {
  const f = await fixture();
  assert.deepEqual(await runAdMobWorker(f.env, f.fetcher, NOW), { 여비: "sent", 반다라트: "sent" });
  assert.equal(f.sent.length, 2);
  assert.match(f.sent[0]!.content, /AdMob 일일 수익 — 11월 25일/);
  assert.match(f.sent[0]!.content, /최근 7일 eCPM \(2026-11-19~2026-11-25\)/);
  assert.match(f.sent[0]!.content, /누적 예상 수익 \(2026-08-04~2026-11-25\)/);
  assert.equal(f.sent[0]!.webhook, "/api/webhooks/1/yeobee");
  assert.equal(f.sent[1]!.webhook, "/api/webhooks/2/bandalart");
  assert.deepEqual(f.rows(), [
    { publisher_id: "pub-111", report_date: "2026-11-25", state: "SENT" },
    { publisher_id: "pub-222", report_date: "2026-11-25", state: "SENT" },
  ]);

  assert.deepEqual(await runAdMobWorker(f.env, f.fetcher, NOW), { 여비: "already-sent", 반다라트: "already-sent" });
  assert.equal(f.sent.length, 2);
});

test("토큰 요청은 refresh_token grant를 form으로 보낸다", async () => {
  const f = await fixture();
  await runAdMobWorker(f.env, f.fetcher, NOW);
  const body = f.tokenBodies[0]!;
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("client_id"), "client-id");
  assert.equal(body.get("client_secret"), "client-secret");
  assert.equal(body.get("refresh_token"), "refresh-yeobee");
});

test("Discord 4xx면 기록을 지워 다음 실행에서 다시 보낸다", async () => {
  let status = 400;
  const f = await fixture({ discordStatus: (publisher) => publisher === "pub-111" ? status : 200 });
  await assert.rejects(runAdMobWorker(f.env, f.fetcher, NOW), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(String((error.errors[0] as Error).message), /여비: Discord HTTP 400/);
    return true;
  });
  // 실패한 계정과 상관없이 다른 계정은 보냈다.
  assert.deepEqual(f.rows(), [{ publisher_id: "pub-222", report_date: "2026-11-25", state: "SENT" }]);

  status = 200;
  assert.deepEqual(await runAdMobWorker(f.env, f.fetcher, NOW), { 여비: "sent", 반다라트: "already-sent" });
  assert.equal(f.sent.length, 2);
});

test("Discord 5xx·타임아웃이면 SENDING을 남기고 다시 보내지 않는다", async () => {
  for (const options of [{ discordStatus: () => 503 }, { discordThrows: true }] satisfies FixtureOptions[]) {
    const f = await fixture(options);
    await assert.rejects(runAdMobWorker(f.env, f.fetcher, NOW), AggregateError);
    assert.deepEqual(f.rows().map((row) => row.state), ["SENDING", "SENDING"]);

    const retry = await fixture();
    retry.env.DB = f.env.DB;
    assert.deepEqual(await runAdMobWorker(retry.env, retry.fetcher, NOW), { 여비: "already-sent", 반다라트: "already-sent" });
    assert.equal(retry.sent.length, 0);
  }
});

test("AdMob 조회가 실패하면 기록을 남기지 않아 다음 실행이 다시 시도한다", async () => {
  const f = await fixture({ reportStatus: (publisher) => publisher === "pub-222" ? 500 : 200 });
  await assert.rejects(runAdMobWorker(f.env, f.fetcher, NOW), /실패 1건/);
  assert.deepEqual(f.rows(), [{ publisher_id: "pub-111", report_date: "2026-11-25", state: "SENT" }]);
});

test("refresh token이 취소되면 다시 발급하라고 알려 준다", async () => {
  const f = await fixture({ tokenStatus: 400, tokenError: "invalid_grant" });
  await assert.rejects(runAdMobWorker(f.env, f.fetcher, NOW), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(String((error.errors[0] as Error).message), /invalid_grant.*pnpm auth/);
    // 오류 메시지에 비밀값을 넣지 않는다.
    assert.doesNotMatch(error.errors.map(String).join(" "), /refresh-yeobee|client-secret/);
    return true;
  });
  assert.deepEqual(f.rows(), []);
});

test("refreshAccessToken은 토큰 응답이 이상하면 오류 코드만 던진다", async () => {
  const fetcher = (async () => Response.json({}, { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(refreshAccessToken("id", "secret", "token", fetcher), /HTTP 200 unknown/);
});

test("DRY_RUN이면 Discord로 보내지 않고 D1에 쓰지 않는다", async () => {
  const f = await fixture({ dryRun: true });
  const logs: string[] = [];
  const original = console.log;
  console.log = (message: string) => { logs.push(message); };
  try {
    assert.deepEqual(await runAdMobWorker(f.env, f.fetcher, NOW), { 여비: "dry-run", 반다라트: "dry-run" });
  } finally {
    console.log = original;
  }
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.rows(), []);
  assert.match(logs[0]!, /\[DRY_RUN\] AdMob 여비 2026-11-25/);
});

test("ACCOUNTS 설정을 검증한다", () => {
  const base = { name: "a", publisherId: "pub-1", refreshTokenSecret: "A_TOKEN", webhookSecret: "A_HOOK" };
  assert.equal(parseWorkerAccounts(JSON.stringify([base]))[0]!.reportType, "mediation");
  assert.throws(() => parseWorkerAccounts("[]"), /하나 이상/);
  assert.throws(() => parseWorkerAccounts(JSON.stringify([{ ...base, webhookSecret: "a-hook" }])), /비밀값 이름/);
  assert.throws(() => parseWorkerAccounts(JSON.stringify([base, { ...base, name: "b" }])), /중복/);
  assert.throws(() => parseWorkerAccounts(JSON.stringify([{ ...base, publisherId: "1" }])), /pub-/);
});
