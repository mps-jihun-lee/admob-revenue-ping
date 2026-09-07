import type { AdMobClient } from "./admob.js";
import type { Config } from "./config.js";
import { dateKey, previousDate } from "./date.js";
import type { Notifier } from "./notifier.js";
import { FileStateStore } from "./state-store.js";

export interface RunResult {
  date: string;
  sent: boolean;
  appCount: number;
}

export async function runOnce(
  config: Config,
  client: Pick<AdMobClient, "getAccount" | "getDailyRevenue" | "getCumulativeRevenue">,
  notifier: Notifier,
  options: { now?: Date; force?: boolean } = {},
): Promise<RunResult> {
  const account = await client.getAccount(config.publisherId);
  const date = previousDate(options.now ?? new Date(), account.reportingTimeZone);
  const key = dateKey(date);
  const store = new FileStateStore(config.stateFile);
  await store.load();

  if (!options.force && store.wasSent(key)) {
    return { date: key, sent: false, appCount: 0 };
  }

  const [apps, cumulativeEarningsMicros] = await Promise.all([
    client.getDailyRevenue(
      config.publisherId,
      config.reportType,
      date,
      account.currencyCode,
    ),
    client.getCumulativeRevenue(
      config.publisherId,
      config.reportType,
      config.cumulativeStartDate,
      date,
      account.currencyCode,
    ),
  ]);
  await notifier.send({
    date,
    currencyCode: account.currencyCode,
    apps,
    cumulativeStartDate: config.cumulativeStartDate,
    cumulativeEarningsMicros,
    payoutTargetMicros: config.payoutTarget * 1_000_000,
  });
  await store.markSent(key);
  return { date: key, sent: true, appCount: apps.length };
}
