import type { OAuth2Client } from "google-auth-library";
import type { ReportType } from "./config.js";
import type { CalendarDate } from "./date.js";

export interface AccountInfo {
  publisherId: string;
  reportingTimeZone: string;
  currencyCode: string;
}

export interface AppRevenue {
  appId: string;
  appName: string;
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
  constructor(private readonly auth: OAuth2Client) {}

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
    const report = reportType === "mediation" ? "mediationReport" : "networkReport";
    const url = `https://admob.googleapis.com/v1/accounts/${encodeURIComponent(publisherId)}/${report}:generate`;
    const response = await this.auth.request<ReportEnvelope[]>({
      url,
      method: "POST",
      data: {
        reportSpec: {
          dateRange: { startDate: date, endDate: date },
          dimensions: ["APP"],
          metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS"],
          localizationSettings: { currencyCode, languageCode: "ko-KR" },
        },
      },
    });
    return parseReport(response.data);
  }
}

export function parseReport(envelopes: ReportEnvelope[]): AppRevenue[] {
  return envelopes.flatMap((envelope) => {
    const row = envelope.row;
    if (!row) return [];
    const app = row.dimensionValues?.APP;
    const earnings = row.metricValues?.ESTIMATED_EARNINGS;
    const impressions = row.metricValues?.IMPRESSIONS;
    return [{
      appId: app?.value ?? "unknown",
      appName: app?.displayLabel ?? app?.value ?? "알 수 없는 앱",
      earningsMicros: metricNumber(earnings, "micros"),
      impressions: metricNumber(impressions, "integer"),
    }];
  });
}

function metricNumber(value: MetricValue | undefined, kind: "micros" | "integer"): number {
  if (!value) return 0;
  const raw = kind === "micros"
    ? value.microsValue ?? value.micros_value ?? value.decimalValue ?? value.decimal_value
    : value.integerValue ?? value.integer_value;
  const parsed = Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
