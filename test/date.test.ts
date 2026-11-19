import assert from "node:assert/strict";
import test from "node:test";
import { addDays, dateKey, previousDate } from "../src/date.js";

test("AdMob 계정 시간대를 기준으로 전날을 계산한다", () => {
  const now = new Date("2026-09-04T00:30:00.000Z");

  assert.equal(dateKey(previousDate(now, "Asia/Seoul")), "2026-09-03");
  assert.equal(dateKey(previousDate(now, "America/Los_Angeles")), "2026-09-02");
});

test("월 경계를 넘어가는 전날을 계산한다", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");

  assert.deepEqual(previousDate(now, "UTC"), { year: 2026, month: 2, day: 28 });
});

test("월 경계를 넘어 날짜를 앞뒤로 이동한다", () => {
  assert.equal(dateKey(addDays({ year: 2026, month: 9, day: 3 }, -6)), "2026-08-28");
  assert.equal(dateKey(addDays({ year: 2026, month: 1, day: 3 }, -6)), "2025-12-28");
});
