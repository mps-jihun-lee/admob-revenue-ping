import type { AccountInfo, AdMobClient } from "./admob.js";
import { addDays, type CalendarDate } from "./date.js";
import type { RevenueNotification } from "./notifier.js";
import type { ReportSettings } from "./settings.js";

// 하루치 알림 내용을 모은다. 로컬 CLI(run.ts)와 Worker(worker.ts)가 함께 쓰므로 Node API를 import하지 않는다.

export type ReportClient = Pick<AdMobClient, "getDailyRevenue" | "getRangeRevenue" | "getCumulativeRevenue">;

export async function collectNotification(
  settings: ReportSettings,
  client: ReportClient,
  account: Pick<AccountInfo, "currencyCode">,
  date: CalendarDate,
): Promise<RevenueNotification> {
  const weeklyStartDate = addDays(date, -6);
  const [apps, weeklyApps, cumulativeEarningsMicros] = await Promise.all([
    client.getDailyRevenue(
      settings.publisherId,
      settings.reportType,
      date,
      account.currencyCode,
    ),
    client.getRangeRevenue(
      settings.publisherId,
      settings.reportType,
      weeklyStartDate,
      date,
      account.currencyCode,
    ),
    client.getCumulativeRevenue(
      settings.publisherId,
      settings.reportType,
      settings.cumulativeStartDate,
      date,
      account.currencyCode,
    ),
  ]);
  return {
    date,
    currencyCode: account.currencyCode,
    apps,
    weeklyStartDate,
    weeklyApps,
    cumulativeStartDate: settings.cumulativeStartDate,
    cumulativeEarningsMicros,
    payoutTargetMicros: settings.payoutTarget * 1_000_000,
  };
}
