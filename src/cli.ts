import { AdMobClient } from "./admob.js";
import { loadConfig } from "./config.js";
import { authorize, authorizedClient } from "./oauth.js";
import { DiscordNotifier, formatMessage } from "./notifier.js";
import { runOnce } from "./run.js";

const command = process.argv[2] ?? "once";
const configPath = process.env.ADMOB_REVENUE_PING_CONFIG ?? "config.json";

if (command === "demo") {
  console.log(formatMessage({
    date: { year: 2026, month: 9, day: 3 },
    currencyCode: "KRW",
    cumulativeStartDate: { year: 2026, month: 1, day: 1 },
    cumulativeEarningsMicros: 72_430_000_000,
    payoutTargetMicros: 100_000_000_000,
    apps: [
      { appId: "demo-1", appName: "앱 A", platform: "Android", earningsMicros: 8_210_000_000, impressions: 12_300 },
      { appId: "demo-2", appName: "앱 B", platform: "iOS", earningsMicros: 4_220_000_000, impressions: 6_120 },
    ],
  }));
} else if (command === "auth") {
  const config = await loadConfig(configPath);
  await authorize(config.oauthClientFile, config.oauthTokenFile);
} else if (command === "once") {
  const config = await loadConfig(configPath);
  const webhookUrl = process.env[config.discordWebhookEnv];
  if (!webhookUrl) {
    throw new Error(`Discord 웹훅 환경 변수 ${config.discordWebhookEnv}가 필요합니다.`);
  }
  const auth = await authorizedClient(config.oauthClientFile, config.oauthTokenFile);
  const result = await runOnce(
    config,
    new AdMobClient(auth),
    new DiscordNotifier(webhookUrl),
    { force: process.argv.includes("--force") },
  );
  console.log(result.sent
    ? `${result.date} 앱 ${result.appCount}개의 수익 알림을 전송했습니다.`
    : `${result.date} 알림은 이미 전송되어 건너뜁니다.`);
} else {
  throw new Error(`알 수 없는 명령: ${command}`);
}
