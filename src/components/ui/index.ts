/**
 * 디자인 시스템 barrel.
 *
 * 화면 담당자는 이 한 줄로 전부 가져다 쓴다:
 *   import { PageContainer, PageHeader, Card, CardBody, Button, formatPeso } from "@/components/ui";
 *
 * 여기에 없는 스타일이 필요하면 새 컴포넌트를 만들지 말고 먼저 물어봐라 —
 * 화면 3개가 서로 다른 버튼을 쓰기 시작하면 "제대로 된 제품" 이 아니게 된다.
 */

export { cn, type ClassValue } from "./cn";

export {
  formatPeso,
  formatAmount,
  formatSignedPeso,
  formatDate,
  formatDateKo,
  formatDateTime,
  formatPercent,
  isoDate,
  maskName,
  maskPhone,
} from "./format";

export {
  Button,
  ButtonRow,
  LinkButton,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type LinkButtonProps,
} from "./Button";

export { Card, CardBody, CardFooter, CardGrid, CardHeader } from "./Card";

export {
  Checkbox,
  Field,
  fieldAria,
  FormStack,
  Input,
  MoneyInput,
  Radio,
  RadioGroup,
  Select,
  Textarea,
  type FieldProps,
  type InputProps,
  type SelectProps,
  type TextareaProps,
} from "./Field";

export {
  Table,
  TableCardBody,
  TableScroll,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "./Table";

export { Badge, ConflictBadge, StatusBadge, type BadgeTone } from "./Badge";

export { Alert, GuardDenied, type AlertTone } from "./Alert";

export { BigStat, StatGrid, StatLine, type StatItem, type StatTone } from "./Stat";

export { EmptyState } from "./EmptyState";

export { QrCode } from "./QrCode";

export { PageLoading, SkeletonLines, Spinner } from "./Loading";

export { PageContainer, PageHeader, Stack } from "./PageHeader";

export { SiteHeader } from "./SiteHeader";
export { SiteFooter } from "./SiteFooter";
