/**
 * 도메인 로직 — 불변식·계산·판정.
 *
 *   import { evaluateTxState, buildPublicLedger, evaluateConflict } from "@/lib/domain";
 *
 * 이 폴더의 함수는 (nextReceiptNo · isFyClosed · assertFyOpen · loadSettings 를 뺀) 전부
 * **순수 함수**다. DB 를 모르고, 행 배열만 받아 계산한다. 그래서 테스트할 수 있다.
 *
 * 원본은 02_노코드MVP/AppsScript/ 의 12개 .gs 다. 이미 실전에서 검증된 로직이므로
 * 새로 발명하지 말고 여기 옮겨 온 것을 쓴다.
 */
export * from "./money";
export * from "./normalize";
export * from "./invariants";
// 직접 입력 장부(/officer/book)의 배지·감사큐 규칙.
// invariants.ts 의 evaluateTxState 와 **일부러 다른 규칙**이다 — 이유는 파일 머리말 참조.
export * from "./direct-entry";
export * from "./conflict";
export * from "./approval";
export * from "./ledger";
export * from "./memberPayments";
export * from "./memberCard";
export * from "./settings";
export * from "./mail";
// 장부 임포트 반영 규칙(L3). 파서(importXlsx.ts)는 exceljs 를 끌고 오므로 여기 넣지 않는다 —
// 필요한 곳에서 "@/lib/domain/importXlsx" 로 직접 가져간다.
export * from "./importMapping";
