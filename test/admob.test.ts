import assert from "node:assert/strict";
import test from "node:test";
import { parseReport } from "../src/admob.js";

test("스트리밍 보고서에서 앱별 수익과 노출수를 읽는다", () => {
  const result = parseReport([
    { header: {} },
    {
      row: {
        dimensionValues: {
          APP: { value: "ca-app-pub-1~1", displayLabel: "오늘의 앱" },
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
    earningsMicros: 6_500_000,
    impressions: 1_234,
  }]);
});

test("행이 없는 보고서는 수익 0건으로 처리한다", () => {
  assert.deepEqual(parseReport([{ header: {} }, { footer: {} }]), []);
});
