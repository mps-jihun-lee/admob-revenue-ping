import assert from "node:assert/strict";
import test from "node:test";
import { dateKey, previousDate } from "../src/date.js";

test("AdMob 계정 시간대를 기준으로 전날을 계산한다", () => {
  const now = new Date("2026-09-04T00:30:00.000Z");

  assert.equal(dateKey(previousDate(now, "Asia/Seoul")), "2026-09-03");
  assert.equal(dateKey(previousDate(now, "America/Los_Angeles")), "2026-09-02");
});

test("월 경계를 넘어가는 전날을 계산한다", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");

  assert.deepEqual(previousDate(now, "UTC"), { year: 2026, month: 2, day: 28 });
});
