import { readFile } from "node:fs/promises";
import { parseReportSettings, type ReportSettings } from "./settings.js";

export type { ReportType } from "./settings.js";

export interface Config extends ReportSettings {
  oauthClientFile: string;
  oauthTokenFile: string;
  stateFile: string;
  discordWebhookEnv: string;
}

export async function loadConfig(path: string): Promise<Config> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  return {
    ...parseReportSettings(raw),
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
