-- admob-revenue-ping Worker(src/worker.ts)가 쓰는 전송 기록. 계정·보고 날짜마다 한 행이다.
-- state: SENDING(보내기 직전 기록. 전송 결과를 모름) → SENT(Discord가 받음).
-- 행이 있으면 그 날짜는 다시 보내지 않는다. Discord가 4xx로 거절했을 때만 행을 지운다.
CREATE TABLE admob_sends (
  publisher_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('SENDING', 'SENT')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (publisher_id, report_date)
);
