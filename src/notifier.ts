import type { AppRevenue } from "./admob.js";
import { dateKey, type CalendarDate } from "./date.js";

export interface RevenueNotification {
  date: CalendarDate;
  currencyCode: string;
  apps: AppRevenue[];
  cumulativeStartDate: CalendarDate;
  cumulativeEarningsMicros: number;
  payoutTargetMicros: number;
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
  const {
    date,
    currencyCode,
    apps,
    cumulativeStartDate,
    cumulativeEarningsMicros,
    payoutTargetMicros,
  } = notification;
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
  const goalRatio = cumulativeEarningsMicros / payoutTargetMicros;
  const goalPercent = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(goalRatio * 100);
  const filledBlocks = Math.round(Math.min(1, Math.max(0, goalRatio)) * 10);
  const progressBar = `${"█".repeat(filledBlocks)}${"░".repeat(10 - filledBlocks)}`;
  const remainingMicros = Math.max(0, payoutTargetMicros - cumulativeEarningsMicros);
  const sorted = [...apps].sort((a, b) => b.earningsMicros - a.earningsMicros);
  const number = new Intl.NumberFormat("ko-KR");
  const platformNames = ["Android", "iOS"];
  const platformSummaries = platformNames.map((platform) => {
    const platformApps = sorted.filter((app) => normalizePlatform(app.platform) === platform);
    return {
      platform,
      apps: platformApps,
      earningsMicros: platformApps.reduce((sum, app) => sum + app.earningsMicros, 0),
      impressions: platformApps.reduce((sum, app) => sum + app.impressions, 0),
    };
  });
  const android = platformSummaries[0]!;
  const ios = platformSummaries[1]!;
  const otherApps = sorted.filter((app) => !platformNames.includes(normalizePlatform(app.platform)));
  const lines = [
    `💰 **AdMob 일일 수익 — ${date.month}월 ${date.day}일**`,
    "",
    "🌐 **통합**",
    `예상 수익: **${money(totalMicros)}**`,
    `노출수: ${number.format(totalImpressions)}회`,
    `eCPM: ${money(eCpmMicros)}`,
    "",
    "📊 **플랫폼 비교**",
    ...platformSummaries.map((summary) => (
      `${platformIcon(summary.platform)} ${summary.platform}: **${money(summary.earningsMicros)}** · 노출 ${number.format(summary.impressions)}회`
    )),
    comparisonLine("수익", android.earningsMicros, ios.earningsMicros, money),
    comparisonLine("노출", android.impressions, ios.impressions, (value) => `${number.format(value)}회`),
    "",
    "📱 **앱별 상세**",
    ...platformSummaries.flatMap((summary) => [
      `**${platformIcon(summary.platform)} ${summary.platform}**`,
      ...(summary.apps.length === 0
        ? ["• 수익 데이터 없음"]
        : summary.apps.map((app) => (
          `• ${app.appName}: ${money(app.earningsMicros)} · 노출 ${number.format(app.impressions)}회`
        ))),
    ]),
    ...otherApps.map((app) => (
      `• ${app.appName} (${app.platform}): ${money(app.earningsMicros)} · 노출 ${number.format(app.impressions)}회`
    )),
    "",
    `📈 **누적 예상 수익 (${dateKey(cumulativeStartDate)}~${dateKey(date)})**`,
    `**${money(cumulativeEarningsMicros)} / ${money(payoutTargetMicros)} (${goalPercent}%)**`,
    `진행률: ${progressBar}`,
    remainingMicros > 0
      ? `지급 목표까지 ${money(remainingMicros)} 남음`
      : "지급 목표 달성 🎉",
    "_보고서의 누적 예상 수익 기준이며, 월말 확정액·실제 지급 잔액과 다를 수 있습니다._",
  ];
  return lines.join("\n");
}

function normalizePlatform(platform: string): string {
  if (platform.toLowerCase() === "android") return "Android";
  if (platform.toLowerCase() === "ios") return "iOS";
  return platform;
}

function platformIcon(platform: string): string {
  return platform === "Android" ? "🤖" : platform === "iOS" ? "🍎" : "📱";
}

function comparisonLine(
  label: string,
  androidValue: number,
  iosValue: number,
  formatDifference: (value: number) => string,
): string {
  if (androidValue === iosValue) return `${label}: 동률`;
  const winner = androidValue > iosValue ? "Android" : "iOS";
  const difference = Math.abs(androidValue - iosValue);
  return `${label} 우세: ${platformIcon(winner)} ${winner} (+${formatDifference(difference)})`;
}
