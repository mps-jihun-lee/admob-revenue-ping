import { readFile } from "node:fs/promises";
import type { CalendarDate } from "./date.js";

export type ReportType = "mediation" | "network";

export interface Config {
  publisherId: string;
  reportType: ReportType;
  oauthClientFile: string;
  oauthTokenFile: string;
  stateFile: string;
  discordWebhookEnv: string;
  cumulativeStartDate: CalendarDate;
  payoutTarget: number;
}

export async function loadConfig(path: string): Promise<Config> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
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
    oauthClientFile: stringSetting(raw, "oauthClientFile", ".data/oauth-client.json"),
    oauthTokenFile: stringSetting(raw, "oauthTokenFile", ".data/oauth-token.json"),
    stateFile: stringSetting(raw, "stateFile", ".data/state.json"),
    discordWebhookEnv: environmentName(raw, "discordWebhookEnv", "DISCORD_WEBHOOK_URL"),
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

function stringSetting(
  raw: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = raw[key] ?? fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key}는 비어 있지 않은 문자열이어야 합니다.`);
  }
  return value;
}

function environmentName(
  raw: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = stringSetting(raw, key, fallback);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${key}가 올바른 환경 변수 이름이 아닙니다.`);
  }
  return value;
}
