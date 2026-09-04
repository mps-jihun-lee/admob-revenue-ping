import { readFile } from "node:fs/promises";

export type ReportType = "mediation" | "network";

export interface Config {
  publisherId: string;
  reportType: ReportType;
  oauthClientFile: string;
  oauthTokenFile: string;
  stateFile: string;
  discordWebhookEnv: string;
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
  };
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
