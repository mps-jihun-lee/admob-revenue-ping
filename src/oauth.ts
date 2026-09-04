import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { OAuth2Client, type Credentials } from "google-auth-library";

const REPORT_SCOPE = "https://www.googleapis.com/auth/admob.report";
const CALLBACK_URL = "http://localhost:53682/oauth2callback";

interface ClientSecrets {
  installed?: { client_id?: string; client_secret?: string };
  web?: { client_id?: string; client_secret?: string };
}

export async function authorizedClient(
  clientFile: string,
  tokenFile: string,
): Promise<OAuth2Client> {
  const client = await oauthClient(clientFile);
  let credentials: Credentials;
  try {
    credentials = JSON.parse(await readFile(tokenFile, "utf8")) as Credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("OAuth 토큰이 없습니다. 먼저 `pnpm auth`를 실행하세요.");
    }
    throw error;
  }
  client.setCredentials(credentials);
  return client;
}

export async function authorize(clientFile: string, tokenFile: string): Promise<void> {
  const client = await oauthClient(clientFile);
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [REPORT_SCOPE],
  });

  console.log("아래 주소를 브라우저에서 열어 AdMob 접근을 승인하세요:\n");
  console.log(url);
  console.log("\n승인을 기다리는 중입니다...");

  const code = await receiveAuthorizationCode();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("refresh token을 받지 못했습니다. Google 계정 권한을 취소한 뒤 다시 시도하세요.");
  }

  await mkdir(dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  console.log(`OAuth 토큰을 ${tokenFile}에 저장했습니다.`);
}

async function oauthClient(clientFile: string): Promise<OAuth2Client> {
  const raw = JSON.parse(await readFile(clientFile, "utf8")) as ClientSecrets;
  const settings = raw.installed ?? raw.web;
  if (!settings?.client_id || !settings.client_secret) {
    throw new Error("OAuth 클라이언트 JSON에서 client_id/client_secret을 찾지 못했습니다.");
  }
  return new OAuth2Client(settings.client_id, settings.client_secret, CALLBACK_URL);
}

function receiveAuthorizationCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", CALLBACK_URL);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (url.pathname !== "/oauth2callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      if (error || !code) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end(`Authorization failed: ${error ?? "missing code"}`);
        server.close();
        reject(new Error(`OAuth 승인이 실패했습니다: ${error ?? "code 없음"}`));
        return;
      }

      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("AdMob Revenue Ping 인증이 완료되었습니다. 이 창을 닫아도 됩니다.");
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(53682, "localhost");
  });
}
