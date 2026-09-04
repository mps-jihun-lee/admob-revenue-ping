import type { AppRevenue } from "./admob.js";
import type { CalendarDate } from "./date.js";

export interface RevenueNotification {
  date: CalendarDate;
  currencyCode: string;
  apps: AppRevenue[];
}

export interface Notifier {
  send(notification: RevenueNotification): Promise<void>;
}

export class DiscordNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(notification: RevenueNotification): Promise<void> {
    const response = await this.fetcher(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: formatMessage(notification) }),
    });
    if (!response.ok) {
      throw new Error(`Discord 웹훅 전송 실패: HTTP ${response.status}`);
    }
  }
}

export function formatMessage(notification: RevenueNotification): string {
  const { date, currencyCode, apps } = notification;
  const totalMicros = apps.reduce((sum, app) => sum + app.earningsMicros, 0);
  const totalImpressions = apps.reduce((sum, app) => sum + app.impressions, 0);
  const eCpmMicros = totalImpressions === 0
    ? 0
    : totalMicros * 1_000 / totalImpressions;
  const formatter = new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: currencyCode === "KRW" ? 0 : 2,
  });
  const money = (micros: number): string => formatter.format(micros / 1_000_000);
  const sorted = [...apps].sort((a, b) => b.earningsMicros - a.earningsMicros);
  const lines = [
    `💰 **AdMob 일일 수익 — ${date.month}월 ${date.day}일**`,
    "",
    `**전체 예상 수익: ${money(totalMicros)}**`,
    ...sorted.map((app) => `• ${app.appName}: ${money(app.earningsMicros)}`),
    "",
    `노출수: ${new Intl.NumberFormat("ko-KR").format(totalImpressions)}`,
    `eCPM: ${money(eCpmMicros)}`,
    "_예상 수익은 월말 확정 과정에서 변경될 수 있습니다._",
  ];
  return lines.join("\n");
}
