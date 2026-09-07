import assert from "node:assert/strict";
import test from "node:test";
import { DiscordNotifier, formatMessage } from "../src/notifier.js";

const notification = {
  date: { year: 2026, month: 9, day: 3 },
  currencyCode: "KRW",
  cumulativeStartDate: { year: 2026, month: 1, day: 1 },
  cumulativeEarningsMicros: 72_430_000_000,
  payoutTargetMicros: 100_000_000_000,
  apps: [
    { appId: "b", appName: "앱 B", earningsMicros: 4_220_000_000, impressions: 6_120 },
    { appId: "a", appName: "앱 A", earningsMicros: 8_210_000_000, impressions: 12_300 },
  ],
};

test("전체 합계와 수익순 앱 목록을 Discord 메시지로 만든다", () => {
  const message = formatMessage(notification);

  assert.match(message, /전체 예상 수익: ₩12,430/);
  assert.ok(message.indexOf("앱 A") < message.indexOf("앱 B"));
  assert.match(message, /노출수: 18,420/);
  assert.match(message, /eCPM: ₩675/);
  assert.match(message, /누적 예상 수익 \(2026-01-01~2026-09-03\)/);
  assert.match(message, /₩72,430 \/ ₩100,000 \(72\.4%\)/);
  assert.match(message, /지급 목표까지 ₩27,570 남음/);
});

test("Discord 웹훅에 content 본문을 전송한다", async () => {
  let body = "";
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    body = String(init?.body);
    return new Response(null, { status: 204 });
  };
  await new DiscordNotifier("https://example.test/webhook", fetcher).send(notification);

  assert.match(JSON.parse(body).content, /AdMob 일일 수익/);
});

test("Discord가 오류를 반환하면 전송 실패로 처리한다", async () => {
  const fetcher = async () => new Response(null, { status: 429 });
  await assert.rejects(
    new DiscordNotifier("https://example.test/webhook", fetcher).send(notification),
    /HTTP 429/,
  );
});
