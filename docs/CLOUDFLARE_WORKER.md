# Cloudflare Worker 운영

로컬 launchd(`pnpm once`) 대신 Cloudflare Worker Cron Trigger가 매일 AdMob 전날 수익을 Discord로 보낸다. Mac을 꺼도 알림이 온다.

```text
Cron 00:10 UTC (09:10 KST)
  └─ admob-revenue-ping Worker (src/worker.ts)
       ├─ 계정마다: refresh token → oauth2.googleapis.com/token → access token
       ├─ AdMob API: 계정 정보(보고 시간대) → 어제·최근 7일·누적 보고서
       ├─ D1 admob_sends: (게시자 ID, 날짜) 행이 있으면 건너뜀
       └─ Discord 웹훅 (계정별 채널)
```

| 항목 | 값 |
| --- | --- |
| Worker | `admob-revenue-ping` (`wrangler.jsonc`, `workers_dev: false`, fetch 핸들러 없음) |
| Cron | `10 0 * * *` (UTC). 무료 플랜 계정당 Cron Trigger 5개 중 1개 |
| D1 | `admob-revenue-ping`, 테이블 `admob_sends` (`migrations/`) |
| 계정 | 여비, 반다라트. 같은 OAuth 클라이언트, 계정별 refresh token과 Discord 웹훅 |

## 비밀값

공개 저장소라 게시자 ID도 `vars`가 아니라 비밀값 `ACCOUNTS`에 둔다.

| 비밀값 | 내용 | 원본 |
| --- | --- | --- |
| `ACCOUNTS` | 계정 설정 JSON 배열 (아래) | `.data/worker-accounts.json` |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | 데스크톱 OAuth 클라이언트 | `.data/oauth-client.json` |
| `YEOBEE_REFRESH_TOKEN` | 여비 AdMob refresh token | `.data/oauth-token.json` |
| `BANDALART_REFRESH_TOKEN` | 반다라트 AdMob refresh token | `~/Documents/Codex/BandalartAlerts/oauth-admob-token.json` |
| `YEOBEE_WEBHOOK_URL` | 여비 Discord 웹훅 | `.env`의 `DISCORD_WEBHOOK_URL` |
| `BANDALART_WEBHOOK_URL` | 반다라트 Discord 웹훅 | `~/Documents/Codex/BandalartAlerts/admob.env`의 `BANDALART_ADMOB_WEBHOOK_URL` |

`.data/worker-accounts.json` (Git 제외). 값은 각 계정의 기존 `config.json`과 같게 둔다.

```json
[
  {
    "name": "여비",
    "publisherId": "pub-…",
    "reportType": "mediation",
    "cumulativeStartDate": "2026-08-04",
    "payoutTarget": 100,
    "refreshTokenSecret": "YEOBEE_REFRESH_TOKEN",
    "webhookSecret": "YEOBEE_WEBHOOK_URL"
  },
  {
    "name": "반다라트",
    "publisherId": "pub-…",
    "reportType": "mediation",
    "cumulativeStartDate": "2026-01-01",
    "payoutTarget": 100,
    "refreshTokenSecret": "BANDALART_REFRESH_TOKEN",
    "webhookSecret": "BANDALART_WEBHOOK_URL"
  }
]
```

지급을 받아 `cumulativeStartDate`를 바꾸거나 `payoutTarget`을 바꿀 때는 이 파일을 고치고 `ACCOUNTS`만 다시 등록한다. 재배포는 필요 없다.

등록은 저장소 루트(`/Users/medi/admob-revenue-ping`)에서 한다. 값은 stdin으로 넘겨 화면과 셸 기록에 남기지 않는다. 끝 줄바꿈이 들어가지 않게 `jq -j`와 `tr -d '\n'`을 쓴다.

```bash
B=~/Documents/Codex/BandalartAlerts
npx wrangler secret put ACCOUNTS < .data/worker-accounts.json
jq -j .installed.client_id .data/oauth-client.json | npx wrangler secret put OAUTH_CLIENT_ID
jq -j .installed.client_secret .data/oauth-client.json | npx wrangler secret put OAUTH_CLIENT_SECRET
jq -j .refresh_token .data/oauth-token.json | npx wrangler secret put YEOBEE_REFRESH_TOKEN
jq -j .refresh_token "$B/oauth-admob-token.json" | npx wrangler secret put BANDALART_REFRESH_TOKEN
sed -n 's/^DISCORD_WEBHOOK_URL=//p' .env | tr -d '\n' | npx wrangler secret put YEOBEE_WEBHOOK_URL
sed -n 's/^BANDALART_ADMOB_WEBHOOK_URL=//p' "$B/admob.env" | tr -d '\n' | npx wrangler secret put BANDALART_WEBHOOK_URL
```

## 처음 배포 순서

중복 알림은 Worker와 launchd가 같은 날짜를 함께 보낼 때 생긴다. launchd는 D1을 모르므로 **첫 Cron(00:10 UTC) 전에 launchd를 끈다.**

1. D1 생성: `npx wrangler d1 create admob-revenue-ping` → 나온 `database_id`를 `wrangler.jsonc`에 넣는다.
2. 마이그레이션: `npx wrangler d1 migrations apply admob-revenue-ping --remote`
3. 로컬이 이미 보낸 날짜를 D1에 넣는다. 수동 실행이 그 날짜를 다시 보내지 않게 한다. 날짜는 `.data/state.json`과 `BandalartAlerts/state/admob.json`의 `lastSentDate`.
   ```bash
   npx wrangler d1 execute admob-revenue-ping --remote --command \
     "INSERT OR IGNORE INTO admob_sends VALUES ('pub-여비', '2026-11-24', 'SENT', 0), ('pub-반다라트', '2026-11-24', 'SENT', 0)"
   ```
4. 비밀값 등록 (위 절)
5. 배포: `npx wrangler deploy`
6. launchd 중지 (아래)

## 확인

실제 Discord 전송 없이 Worker 런타임(workerd)에서 실제 AdMob API로 메시지를 만들어 본다. 로컬 D1만 쓰고, `DRY_RUN=true`이면 Discord로 보내지 않고 D1에도 쓰지 않는다.

1. 저장소 밖(예: `/tmp`)에 `dev.vars`를 만든다. 위 비밀값과 같은 키에 `DRY_RUN=true`를 더하고, 만일을 위해 웹훅 두 개는 `https://discord.com/api/webhooks/0/dry-run`으로 둔다. `ACCOUNTS`는 JSON이라 작은따옴표로 감싼다(`ACCOUNTS='[...]'`).
2. 실행:
   ```bash
   npx wrangler d1 migrations apply admob-revenue-ping --local --persist-to /tmp/admob-state
   npx wrangler dev --test-scheduled --env-file /tmp/dev.vars --persist-to /tmp/admob-state --port 8799
   curl "http://localhost:8799/__scheduled?cron=10+0+*+*+*"
   ```
3. 로그에 `[DRY_RUN] AdMob 여비 …` 메시지 두 개와 `AdMob cron {"여비":"dry-run","반다라트":"dry-run"}`가 나오면 정상이다. 확인 후 `dev.vars`를 지운다.

배포 후 상태:

```bash
npx wrangler tail admob-revenue-ping            # Cron 실행 로그 (실행 시각에 켜 둔다)
npx wrangler d1 execute admob-revenue-ping --remote --command "SELECT * FROM admob_sends ORDER BY report_date DESC LIMIT 6"
```

Cloudflare 대시보드 Workers > admob-revenue-ping > Logs에서도 Cron 결과를 볼 수 있다.

## 중복·누락 규칙

- 보고서 조회까지 끝낸 뒤, 보내기 직전에 `INSERT OR IGNORE`로 `SENDING` 행을 만든다. 행을 만든 실행만 보낸다. 같은 날짜를 동시에 처리하는 실행이 있어도 한 번만 간다.
- Discord가 받으면 `SENT`로 바꾼다.
- Discord가 4xx로 거절하면 행을 지운다. 다음 실행(수동 포함)이 다시 보낸다.
- 타임아웃·네트워크 오류·5xx면 `SENDING`을 남긴다. 실제로 게시됐을 수 있어 다시 보내지 않는다. 채널에 알림이 없으면 아래 "수동 재전송"으로 보낸다.
- 토큰·AdMob 조회가 실패하면 행을 만들지 않는다. Cron은 하루 한 번이라 그날 알림은 빠진다. 로그에서 원인을 보고 수동 재전송한다.
- 한 계정이 실패해도 다른 계정은 보낸다.

### 수동 재전송

`SENDING`이 남았는데 채널에 알림이 없을 때, 또는 조회 실패로 빠진 날:

```bash
npx wrangler d1 execute admob-revenue-ping --remote --command \
  "DELETE FROM admob_sends WHERE publisher_id = 'pub-…' AND report_date = '2026-11-25' AND state = 'SENDING'"
```

Worker에는 수동 실행 경로가 없다. 같은 날 안이라면 로컬에서 `pnpm once`(여비) 또는 반다라트 env로 `node --env-file=… --import tsx src/cli.ts once`를 한 번 실행한다. 로컬 상태 파일은 D1과 따로이므로 로컬 실행은 D1에 기록되지 않는다. 다음 날 Worker는 다음 날짜를 보내므로 겹치지 않는다.

## refresh token 만료

- 현재 두 토큰은 2026-09-04, 2026-09-28에 발급되어 2026-11-25에도 동작한다. 토큰 응답에 `refresh_token_expires_in`이 없다. OAuth 동의 화면이 "테스트" 상태였다면 7일 뒤 만료됐을 것이므로 프로덕션 상태로 본다.
- 그래도 사용자가 Google 계정에서 접근을 취소하거나, 클라이언트 비밀번호를 바꾸거나, 6개월 동안 쓰지 않으면 만료된다. 이때 로그에 `invalid_grant … pnpm auth`가 찍힌다.
- 다시 발급: 해당 계정 설정으로 `pnpm auth`를 실행한 뒤 해당 `*_REFRESH_TOKEN` 비밀값만 다시 등록한다.

## launchd 중지

```bash
launchctl bootout gui/$(id -u)/com.mps-jihun-lee.admob-revenue-ping
launchctl bootout gui/$(id -u)/com.easyhooon.bandalart.admob-revenue-ping
mkdir -p ~/Library/LaunchAgents/disabled
mv ~/Library/LaunchAgents/com.mps-jihun-lee.admob-revenue-ping.plist ~/Library/LaunchAgents/disabled/
mv ~/Library/LaunchAgents/com.easyhooon.bandalart.admob-revenue-ping.plist ~/Library/LaunchAgents/disabled/
```

## 로컬로 되돌리기

1. Worker Cron 끄기: `wrangler.jsonc`의 `"crons"`를 `[]`로 바꾸고 `npx wrangler deploy` (또는 `npx wrangler delete admob-revenue-ping`).
2. plist를 `~/Library/LaunchAgents/`로 되돌린다.
3. **bootstrap 전에** 로컬 상태 파일의 `lastSentDate`를 Worker가 마지막으로 보낸 날짜(D1 `SENT` 최신 행)로 맞춘다. plist에 `RunAtLoad`가 켜져 있어 bootstrap 즉시 실행되고, 상태 파일이 뒤처져 있으면 Worker가 이미 보낸 날짜를 다시 보낸다.
4. `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<plist>`

로컬 CLI(`pnpm once`, `pnpm auth`)는 Worker 추가 후에도 그대로 동작한다.
