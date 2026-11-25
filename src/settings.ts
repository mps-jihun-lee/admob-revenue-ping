import type { CalendarDate } from "./date.js";

// 로컬 CLI(config.ts)와 Cloudflare Worker(worker.ts)가 함께 쓰는 보고서 설정 검증.
// Worker 번들에 들어가므로 Node API를 import하지 않는다.

export type ReportType = "mediation" | "network";

export interface ReportSettings {
  publisherId: string;
  reportType: ReportType;
  cumulativeStartDate: CalendarDate;
  payoutTarget: number;
}

export function parseReportSettings(raw: Record<string, unknown>): ReportSettings {
  if (typeof raw.publisherId !== "string" || !/^pub-\d+$/.test(raw.publisherId)) {
    throw new Error("publisherId는 pub-로 시작하는 AdMob 게시자 ID여야 합니다.");
  }

  const reportType = raw.reportType ?? "mediation";
  if (reportType !== "mediation" && reportType !== "network") {
    throw new Error("reportType은 mediation 또는 network여야 합니다.");
  }

  return {
    publisherId: raw.publisherId,
    reportType,
    cumulativeStartDate: dateSetting(raw, "cumulativeStartDate", "2018-01-01"),
    payoutTarget: positiveNumberSetting(raw, "payoutTarget", 100),
  };
}

function dateSetting(
  raw: Record<string, unknown>,
  key: string,
  fallback: string,
): CalendarDate {
  const value = raw[key] ?? fallback;
  if (typeof value !== "string") {
    throw new Error(`${key}는 YYYY-MM-DD 형식이어야 합니다.`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`${key}는 YYYY-MM-DD 형식이어야 합니다.`);
  }
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const parsed = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    parsed.getUTCFullYear() !== date.year
    || parsed.getUTCMonth() + 1 !== date.month
    || parsed.getUTCDate() !== date.day
  ) {
    throw new Error(`${key}가 올바른 날짜가 아닙니다.`);
  }
  return date;
}

function positiveNumberSetting(
  raw: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = raw[key] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${key}는 0보다 큰 숫자여야 합니다.`);
  }
  return value;
}
