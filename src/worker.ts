import { AdMobClient, type AdMobAuth } from "./admob.js";
import { dateKey, previousDate } from "./date.js";
import { formatMessage } from "./notifier.js";
import { collectNotification } from "./report.js";
import { parseReportSettings, type ReportSettings } from "./settings.js";

// 로컬 `pnpm once`(src/run.ts)를 Cloudflare Worker Cron Trigger와 D1로 옮긴 것이다.
// 상태 파일 대신 D1 admob_sends에 계정·날짜별 전송 기록을 남긴다. 한 Worker가 ACCOUNTS의 계정을 차례로 처리한다.
// fetch 핸들러가 없어 Cron 말고는 실행할 방법이 없다(workers_dev도 끈다).

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

interface Database {
  prepare(sql: string): Statement;
}

export interface AdMobWorkerEnv {
  DB: Database;
  /**
   * 비밀값. 공개 저장소에 게시자 ID를 올리지 않으려고 vars가 아니라 비밀값으로 둔다.
   * JSON 배열. 계정마다 보고서 설정과, refresh token·Discord 웹훅이 든 비밀값의 이름을 적는다.
   * 예: [{"name":"여비","publisherId":"pub-1","reportType":"mediation","cumulativeStartDate":"2026-08-04",
   *       "payoutTarget":100,"refreshTokenSecret":"YEOBEE_REFRESH_TOKEN","webhookSecret":"YEOBEE_WEBHOOK_URL"}]
   */
  ACCOUNTS: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  /** "true"면 Discord로 보내지 않고 메시지를 로그로만 남기며 D1에 쓰지 않는다. 로컬 확인용이다. */
  DRY_RUN?: string;
  [secret: string]: unknown;
}

export interface WorkerAccount extends ReportSettings {
  name: string;
  refreshTokenSecret: string;
  webhookSecret: string;
}

export type AccountOutcome = "sent" | "already-sent" | "dry-run";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 15_000;
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

export function parseWorkerAccounts(raw: string): WorkerAccount[] {
  let accounts: unknown;
  try {
    accounts = JSON.parse(raw);
  } catch {
    // JSON.parse 오류 메시지에는 원문 조각(게시자 ID)이 들어가 로그에 남는다. 원래 오류를 버린다.
    throw new Error("ACCOUNTS가 올바른 JSON이 아닙니다.");
  }
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("ACCOUNTS에는 계정이 하나 이상 필요합니다.");
  const parsed = accounts.map((value, index) => {
    const account = (value ?? {}) as Record<string, unknown>;
    if (typeof account.name !== "string" || !account.name.trim()) {
      throw new Error(`ACCOUNTS[${index}].name이 필요합니다.`);
    }
    for (const key of ["refreshTokenSecret", "webhookSecret"] as const) {
      const name = account[key];
      if (typeof name !== "string" || !SECRET_NAME.test(name)) {
        throw new Error(`ACCOUNTS[${index}].${key}는 대문자 비밀값 이름이어야 합니다.`);
      }
    }
    return {
      ...parseReportSettings(account),
      name: account.name,
      refreshTokenSecret: account.refreshTokenSecret as string,
      webhookSecret: account.webhookSecret as string,
    };
  });
  if (new Set(parsed.map((account) => account.publisherId)).size !== parsed.length) {
    throw new Error("ACCOUNTS에 같은 publisherId가 중복되었습니다.");
  }
  if (new Set(parsed.map((account) => account.name)).size !== parsed.length) {
    throw new Error("ACCOUNTS에 같은 name이 중복되었습니다.");
  }
  return parsed;
}

// workerd에서 fetch를 객체 필드에 담아 `this.fetcher()`로 부르면 Illegal invocation이 난다. 화살표 함수로 감싼다.
const globalFetch: typeof fetch = (input, init) => fetch(input, init);

export async function runAdMobWorker(
  env: AdMobWorkerEnv,
  fetcher: typeof fetch = globalFetch,
  now: Date = new Date(),
): Promise<Record<string, AccountOutcome>> {
  if (!env.DB || !env.OAUTH_CLIENT_ID || !env.OAUTH_CLIENT_SECRET) {
    throw new Error("AdMob Worker 설정(DB, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET)이 빠졌습니다.");
  }
  const accounts = parseWorkerAccounts(env.ACCOUNTS);
  const outcomes: Record<string, AccountOutcome> = {};
  const errors: unknown[] = [];
  // 계정 하나의 실패가 다른 계정 알림을 막지 않도록 계정별로 처리하고, 실패는 끝에서 모아 던진다.
  for (const account of accounts) {
    try {
      outcomes[account.name] = await runAccount(env, account, fetcher, now);
    } catch (error) {
      errors.push(new Error(`${account.name}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `AdMob 알림 실패 ${errors.length}건 (${JSON.stringify(outcomes)})`);
  }
  return outcomes;
}

async function runAccount(
  env: AdMobWorkerEnv,
  account: WorkerAccount,
  fetcher: typeof fetch,
  now: Date,
): Promise<AccountOutcome> {
  const refreshToken = env[account.refreshTokenSecret];
  const webhookUrl = env[account.webhookSecret];
  if (typeof refreshToken !== "string" || !refreshToken) throw new Error(`비밀값 ${account.refreshTokenSecret}가 없습니다.`);
  if (typeof webhookUrl !== "string" || !webhookUrl) throw new Error(`비밀값 ${account.webhookSecret}가 없습니다.`);
  // SENDING으로 선점한 뒤 URL 오류가 나면 게시되지 않았는데도 행이 남아 그날 알림이 영영 빠진다. 먼저 검증한다.
  const discordUrl = discordWebhookUrl(webhookUrl, account.webhookSecret);
  const dryRun = env.DRY_RUN === "true";

  const accessToken = await refreshAccessToken(env.OAUTH_CLIENT_ID, env.OAUTH_CLIENT_SECRET, refreshToken, fetcher);
  const client = new AdMobClient(new AccessTokenAuth(accessToken, fetcher));
  const info = await client.getAccount(account.publisherId);
  // 날짜는 실행 환경이 아니라 AdMob 계정의 보고 시간대를 따른다(로컬 CLI와 같다).
  const date = previousDate(now, info.reportingTimeZone);
  const key = dateKey(date);

  const existing = await env.DB.prepare(
    "SELECT state FROM admob_sends WHERE publisher_id = ? AND report_date = ?",
  ).bind(account.publisherId, key).first<{ state: string }>();
  if (existing) {
    if (existing.state === "SENDING") {
      // 이전 실행이 전송 도중 끊겼다. 게시됐을 수도 있어 다시 보내지 않는다(중복보다 누락을 택한다).
      console.warn(`AdMob ${account.name} ${key}: 전송 확인 안 됨(SENDING). 다시 보내지 않습니다.`);
    }
    return "already-sent";
  }

  // 보고서 조회가 실패하면 D1에 아무것도 쓰지 않으므로 같은 날 다음 Cron(wrangler.jsonc의 재시도 시각)이 다시 시도한다.
  const notification = await collectNotification(account, client, info, date);
  const content = formatMessage(notification);
  if (dryRun) {
    console.log(`[DRY_RUN] AdMob ${account.name} ${key} 메시지:\n${content}`);
    return "dry-run";
  }

  // 같은 날짜를 동시에 처리하는 실행(Cron 재시도 등)이 있어도 INSERT OR IGNORE는 하나만 성공한다.
  // 보내기 전에 SENDING으로 기록해, 전송 후 기록 전에 실행이 끊겨도 다음 실행이 다시 보내지 않는다.
  const claimed = await env.DB.prepare(
    "INSERT OR IGNORE INTO admob_sends (publisher_id, report_date, state, updated_at) VALUES (?, ?, 'SENDING', ?)",
  ).bind(account.publisherId, key, Date.now()).run();
  if (claimed.meta.changes === 0) return "already-sent";

  try {
    await sendDiscord(discordUrl, content, fetcher);
  } catch (error) {
    // Discord가 4xx로 거절한 것이 확실할 때만 기록을 지워 같은 날 다음 Cron에서 다시 보낸다.
    // 타임아웃·네트워크 오류·5xx는 실제로 게시됐을 수 있어 SENDING을 남긴다.
    if (error instanceof DiscordRejected) {
      try {
        await env.DB.prepare(
          "DELETE FROM admob_sends WHERE publisher_id = ? AND report_date = ? AND state = 'SENDING'",
        ).bind(account.publisherId, key).run();
      } catch (deleteError) {
        console.error("AdMob SENDING 삭제 실패", deleteError instanceof Error ? deleteError.message : "unknown");
      }
    }
    throw error;
  }
  await env.DB.prepare(
    "UPDATE admob_sends SET state = 'SENT', updated_at = ? WHERE publisher_id = ? AND report_date = ?",
  ).bind(Date.now(), account.publisherId, key).run();
  return "sent";
}

/** Google OAuth refresh token으로 access token을 받는다. google-auth-library 없이 토큰 엔드포인트를 직접 호출한다. */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetcher: typeof fetch = globalFetch,
): Promise<string> {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: unknown; error?: unknown };
  if (!response.ok || typeof body.access_token !== "string") {
    // 오류에 토큰 값을 넣지 않는다. 오류 코드만 남긴다.
    const code = typeof body.error === "string" ? body.error : "unknown";
    if (code === "invalid_grant") {
      throw new Error("Google refresh token이 만료되었거나 취소되었습니다(invalid_grant). 로컬에서 `pnpm auth`로 다시 발급한 뒤 Worker 비밀값을 다시 등록하세요.");
    }
    throw new Error(`Google 토큰 발급 실패: HTTP ${response.status} ${code}`);
  }
  return body.access_token;
}

class AccessTokenAuth implements AdMobAuth {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch,
  ) {}

  async request<T>(options: { url: string; method?: "POST"; data?: Record<string, unknown> }): Promise<{ data: T }> {
    const url = new URL(options.url);
    if (url.protocol !== "https:" || url.hostname !== "admob.googleapis.com") throw new Error("Invalid AdMob endpoint");
    const response = await this.fetcher(url, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        accept: "application/json",
        ...(options.data ? { "content-type": "application/json" } : {}),
      },
      body: options.data ? JSON.stringify(options.data) : null,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      // 경로에는 게시자 ID가 들어 있어 작업 이름만 남긴다.
      const operation = url.pathname.endsWith(":generate") ? "report:generate" : "accounts.get";
      throw new Error(`AdMob API 실패: HTTP ${response.status} ${operation}`);
    }
    return { data: await response.json() as T };
  }
}

const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

/** 웹훅 URL을 검증한다. 오류에는 URL(웹훅 토큰 포함) 대신 비밀값 이름만 넣는다. */
function discordWebhookUrl(raw: string, secretName: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`비밀값 ${secretName}가 올바른 URL이 아닙니다.`);
  }
  if (url.protocol !== "https:" || !DISCORD_HOSTS.has(url.hostname) || !url.pathname.startsWith("/api/webhooks/")) {
    throw new Error(`비밀값 ${secretName}가 Discord 웹훅 URL이 아닙니다.`);
  }
  url.searchParams.set("wait", "true");
  return url;
}

async function sendDiscord(url: URL, content: string, fetcher: typeof fetch): Promise<void> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel();
  if (response.status >= 400 && response.status < 500) throw new DiscordRejected(response.status);
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
}

/** Discord가 요청을 받고 4xx로 거절했다. 메시지는 게시되지 않았다. */
export class DiscordRejected extends Error {
  constructor(status: number) {
    super(`Discord HTTP ${status}`);
  }
}

async function runCron(env: AdMobWorkerEnv): Promise<void> {
  try {
    const outcomes = await runAdMobWorker(env);
    console.log(`AdMob cron ${JSON.stringify(outcomes)}`);
  } catch (error) {
    const details = error instanceof AggregateError
      ? error.errors.map((item) => item instanceof Error ? item.message : String(item)).join("; ")
      : "";
    console.error("AdMob cron failed", error instanceof Error ? error.message : "unknown", details);
    throw error;
  }
}

export default {
  // waitUntil 대신 await해서 실패가 Cron 실행 결과(outcome)에 드러나게 한다.
  async scheduled(_controller: unknown, env: AdMobWorkerEnv) {
    await runCron(env);
  },
};
