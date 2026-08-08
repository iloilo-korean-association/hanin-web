import { PageLoading } from "@/components/ui";

/**
 * 임원 화면 로딩.
 * 현지 회선이 느리다 — "아무것도 안 보이는 1초" 는 고장으로 읽힌다.
 */
export default function Loading() {
  return <PageLoading label="임원 화면을 불러오는 중" />;
}
