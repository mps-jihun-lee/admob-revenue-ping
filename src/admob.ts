import type { CalendarDate } from "./date.js";
import type { ReportType } from "./settings.js";

// 로컬 CLI는 google-auth-library의 OAuth2Client를, Worker는 fetch 기반 구현(worker.ts)을 넘긴다.
// Worker 번들에 Node API가 들어가지 않도록 이 파일은 google-auth-library를 import하지 않는다.
export interface AdMobAuth {
  request<T>(options: { url: string; method?: "POST"; data?: Record<string, unknown> }): Promise<{ data: T }>;
}

export interface AccountInfo {
  publisherId: string;
  reportingTimeZone: string;
  currencyCode: string;
}

export interface AppRevenue {
  appId: string;
  appName: string;
  platform: string;
  earningsMicros: number;
  impressions: number;
}

interface ReportEnvelope {
  header?: unknown;
  row?: {
    dimensionValues?: Record<string, { value?: string; displayLabel?: string }>;
    metricValues?: Record<string, MetricValue>;
  };
  footer?: unknown;
}

interface MetricValue {
  microsValue?: string | number;
  micros_value?: string | number;
  decimalValue?: string | number;
  decimal_value?: string | number;
  integerValue?: string | number;
  integer_value?: string | number;
}

export class AdMobClient {
  constructor(private readonly auth: AdMobAuth) {}

  async getAccount(publisherId: string): Promise<AccountInfo> {
    const url = `https://admob.googleapis.com/v1/accounts/${encodeURIComponent(publisherId)}`;
    const response = await this.auth.request<AccountInfo>({ url });
    return response.data;
  }

  async getDailyRevenue(
    publisherId: string,
    reportType: ReportType,
    date: CalendarDate,
    currencyCode: string,
  ): Promise<AppRevenue[]> {
    return this.getRangeRevenue(publisherId, reportType, date, date, currencyCode);
  }

  async getRangeRevenue(
    publisherId: string,
    reportType: ReportType,
    startDate: CalendarDate,
    endDate: CalendarDate,
    currencyCode: string,
  ): Promise<AppRevenue[]> {
    const report = reportType === "mediation" ? "mediationReport" : "networkReport";
    const url = `https://admob.googleapis.com/v1/accounts/${encodeURIComponent(publisherId)}/${report}:generate`;
    const response = await this.auth.request<ReportEnvelope[]>({
      url,
      method: "POST",
      data: {
        reportSpec: {
          dateRange: { startDate, endDate },
          dimensions: ["APP", "PLATFORM"],
          metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS"],
          localizationSettings: { currencyCode, languageCode: "ko-KR" },
        },
      },
    });
    return parseReport(response.data);
  }

  async getCumulativeRevenue(
    publisherId: string,
    reportType: ReportType,
    startDate: CalendarDate,
    endDate: CalendarDate,
    currencyCode: string,
  ): Promise<number> {
    const report = reportType === "mediation" ? "mediationReport" : "networkReport";
    const url = `https://admob.googleapis.com/v1/accounts/${encodeURIComponent(publisherId)}/${report}:generate`;
    const response = await this.auth.request<ReportEnvelope[]>({
      url,
      method: "POST",
      data: {
        reportSpec: {
          dateRange: { startDate, endDate },
          metrics: ["ESTIMATED_EARNINGS"],
          localizationSettings: { currencyCode, languageCode: "ko-KR" },
        },
      },
    });
    return parseTotalEarnings(response.data);
  }
}

export function parseReport(envelopes: ReportEnvelope[]): AppRevenue[] {
  return envelopes.flatMap((envelope) => {
    const row = envelope.row;
    if (!row) return [];
    const app = row.dimensionValues?.APP;
    const platform = row.dimensionValues?.PLATFORM;
    const earnings = row.metricValues?.ESTIMATED_EARNINGS;
    const impressions = row.metricValues?.IMPRESSIONS;
    return [{
      appId: app?.value ?? "unknown",
      appName: app?.displayLabel ?? app?.value ?? "알 수 없는 앱",
      platform: platform?.displayLabel ?? platform?.value ?? "알 수 없는 플랫폼",
      earningsMicros: metricNumber(earnings, "micros"),
      impressions: metricNumber(impressions, "integer"),
    }];
  });
}

export function parseTotalEarnings(envelopes: ReportEnvelope[]): number {
  return envelopes.reduce((total, envelope) => {
    const earnings = envelope.row?.metricValues?.ESTIMATED_EARNINGS;
    return total + metricNumber(earnings, "micros");
  }, 0);
}

function metricNumber(value: MetricValue | undefined, kind: "micros" | "integer"): number {
  if (!value) return 0;
  const raw = kind === "micros"
    ? value.microsValue ?? value.micros_value ?? value.decimalValue ?? value.decimal_value
    : value.integerValue ?? value.integer_value;
  const parsed = Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
