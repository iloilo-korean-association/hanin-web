import { z } from "zod";

import { zAmount0, zOptText, zText } from "./common";
import { zServiceCategory, zServiceStatus } from "./enums";

/**
 * 한인회 서비스 입력 검증.
 *
 * ★ 이 내용은 공개 페이지(/services)에 **그대로** 나간다.
 *   담당 창구(contactName)는 직책 위주로 적는다 — 개인 실명이 공개 화면에 상시 노출된다.
 *   연락처는 모르면 비워 둔다. 지어낸 번호는 긴급 상황에서 사람을 해친다.
 */

/** 정렬순서 등 0 이상의 정수. 쉼표·공백이 섞여 와도 받는다. */
const zSortOrder = z
  .union([z.string(), z.number()])
  .transform((v) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
  })
  .refine((n) => Number.isInteger(n) && n >= 0 && n <= 9999, "정렬순서는 0~9999 사이의 정수여야 합니다.");

export const serviceInputSchema = z.object({
  title: zText(80, "서비스명"),
  category: zServiceCategory,
  description: zOptText(500),
  howToApply: zOptText(500),
  contactName: zOptText(60),
  contactPhone: zOptText(40),
  /** 이용료 (정수 페소). 0 = 무료. */
  fee: zAmount0,
  status: zServiceStatus,
  isPublic: z.boolean(),
  sortOrder: zSortOrder,
  note: zOptText(300),
});
export type ServiceInput = z.infer<typeof serviceInputSchema>;

/** 서비스ID SV01 */
export const zServiceId = z.string().trim().regex(/^SV\d{2,}$/, "서비스ID는 SV01 형식입니다.");
