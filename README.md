# AdMob Revenue Ping

AdMob의 전날 예상 수익과 전체 누적 예상 수익을 집계해 Discord로 보내는 작은 일일 알리미입니다.

```text
AdMob Reporting API ──> 전날 앱별 수익 집계 ──> Discord
                                  └──────> .data/state.json
```

## 알림 예시

```text
💰 AdMob 일일 수익 — 9월 3일

전체 예상 수익: ₩12,430
• 앱 A: ₩8,210
• 앱 B: ₩4,220

노출수: 18,420
eCPM: ₩675

📈 누적 예상 수익 (2026-01-01~2026-09-03)
₩72,430 / ₩100,000 (72.4%)
진행률: ███████░░░
지급 목표까지 ₩27,570 남음
```

날짜는 실행 환경이 아니라 **AdMob 계정의 보고 시간대**를 따릅니다. 같은 날짜는 한 번만 보내며, Discord 전송에 실패하면 다음 실행에서 재시도합니다.

## 준비물

- Node.js 22 이상
- pnpm
- AdMob 게시자 ID (`pub-...`)
- Discord 웹훅 URL
- Google OAuth 데스크톱 클라이언트 JSON

## 1. 설치

```bash
pnpm install
cp config.example.json config.json
cp .env.example .env
mkdir -p .data
```

`config.json`의 `publisherId`를 자신의 AdMob 게시자 ID로 바꿉니다. 게시자 ID는 AdMob의 **설정 > 계정 정보**에서 확인할 수 있습니다. `cumulativeStartDate`는 누적 예상 수익을 계산할 시작일이며, 아직 지급받은 적이 없다면 기본값을 그대로 사용할 수 있습니다. 지급 후에는 마지막 지급 다음 날로 변경하세요. `payoutTarget`은 AdMob 계정 통화 기준 목표 금액입니다.

`.env`에는 Discord 채널의 **채널 설정 > 연동 > 웹후크**에서 만든 URL을 넣습니다.

```dotenv
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## 2. AdMob API와 OAuth 설정

1. [Google Cloud Console](https://console.cloud.google.com/apis/library/admob.googleapis.com)에서 프로젝트를 만들거나 선택하고 **AdMob API**를 활성화합니다.
2. OAuth 동의 화면을 구성합니다. 테스트 상태라면 자신의 Google 계정을 테스트 사용자에 추가합니다.
3. **API 및 서비스 > 사용자 인증 정보 > 사용자 인증 정보 만들기 > OAuth 클라이언트 ID**에서 `데스크톱 앱`을 선택합니다.
4. JSON을 내려받아 `.data/oauth-client.json`으로 저장합니다.
5. 아래 명령을 실행하고 출력된 주소를 브라우저에서 열어 AdMob 계정으로 승인합니다.

```bash
pnpm auth
```

성공하면 refresh token이 `.data/oauth-token.json`에 저장됩니다. `.data`, `.env`, `config.json`은 Git에서 제외되며 공개 저장소에 올리면 안 됩니다.

> 장기간 자동 실행할 때 OAuth 동의 화면이 `테스트` 상태이면 refresh token이 만료될 수 있습니다. 개인용이어도 자동화가 안정적으로 유지되도록 앱 게시 상태와 Google OAuth 정책을 확인하세요.

## 3. 실행

메시지 모양만 확인:

```bash
pnpm demo
```

실제 전날 수익을 한 번 조회해 전송:

```bash
pnpm once
```

이미 보낸 날짜를 의도적으로 다시 보내려면:

```bash
pnpm once -- --force
```

기본 `reportType`은 `mediation`이며 AdMob 네트워크와 미디에이션 실적을 집계합니다. AdMob Network 보고서만 사용하려면 `config.json`에서 `reportType`을 `network`로 바꿉니다.

## 4. 매일 자동 실행

AdMob 통계는 반영에 몇 시간이 걸릴 수 있으므로 아침 9시 이후 실행을 권장합니다. `crontab -e`에 다음 형태로 등록하세요. `pnpm`과 저장소 경로는 `command -v pnpm`, `pwd`로 확인한 실제 절대 경로로 바꿔야 합니다.

```cron
10 9 * * * cd /absolute/path/to/admob-revenue-ping && /absolute/path/to/pnpm once >> .data/cron.log 2>&1
```

cron의 시간대는 실행 서버 설정을 따르지만, 조회 대상 날짜는 AdMob 계정 시간대를 기준으로 자동 계산합니다.

## 설정

```json
{
  "publisherId": "pub-1234567890123456",
  "reportType": "mediation",
  "oauthClientFile": ".data/oauth-client.json",
  "oauthTokenFile": ".data/oauth-token.json",
  "stateFile": ".data/state.json",
  "discordWebhookEnv": "DISCORD_WEBHOOK_URL",
  "cumulativeStartDate": "2018-01-01",
  "payoutTarget": 100
}
```

다른 설정 파일은 환경 변수로 지정할 수 있습니다.

```bash
ADMOB_REVENUE_PING_CONFIG=/absolute/path/to/config.json pnpm once
```

## 검증

```bash
pnpm check
```

## 주의사항

- 일일·누적 알림 금액은 `ESTIMATED_EARNINGS`이며 실제 지급 잔액이 아닙니다. 무효 활동 조정 등으로 월말 확정액과 달라질 수 있습니다.
- OAuth 토큰, 클라이언트 JSON, Discord 웹훅을 커밋하지 마세요.
- AdMob API 응답에 앱 행이 없으면 수익과 노출수 0으로 알립니다.

## License

MIT
