import assert from "node:assert/strict";
import test from "node:test";
import { parseReport, parseTotalEarnings } from "../src/admob.js";

test("스트리밍 보고서에서 앱별 수익과 노출수를 읽는다", () => {
  const result = parseReport([
    { header: {} },
    {
      row: {
        dimensionValues: {
          APP: { value: "ca-app-pub-1~1", displayLabel: "오늘의 앱" },
          PLATFORM: { value: "Android", displayLabel: "Android" },
        },
        metricValues: {
          ESTIMATED_EARNINGS: { microsValue: "6500000" },
          IMPRESSIONS: { integerValue: "1234" },
        },
      },
    },
    { footer: { matchingRowCount: "1" } },
  ]);

  assert.deepEqual(result, [{
    appId: "ca-app-pub-1~1",
    appName: "오늘의 앱",
    platform: "Android",
    earningsMicros: 6_500_000,
    impressions: 1_234,
  }]);
});

test("행이 없는 보고서는 수익 0건으로 처리한다", () => {
  assert.deepEqual(parseReport([{ header: {} }, { footer: {} }]), []);
});

test("전체 기간 보고서에서 누적 수익을 읽는다", () => {
  const result = parseTotalEarnings([
    { header: {} },
    { row: { metricValues: { ESTIMATED_EARNINGS: { microsValue: "72430000" } } } },
    { footer: {} },
  ]);

  assert.equal(result, 72_430_000);
});
