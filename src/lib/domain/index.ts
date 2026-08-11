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
export * from "./conflict";
export * from "./approval";
export * from "./ledger";
export * from "./memberPayments";
export * from "./settings";
export * from "./mail";
