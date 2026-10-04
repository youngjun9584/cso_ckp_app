/**
 * zod 검증 헬퍼. 실패 시 AppError(VALIDATION_FAILED) + error.fields(필드 → 한국어 메시지)로 변환한다.
 *
 *   const body = parseInput(Schema, request.body);          // 본문
 *   const q = parseInput(QuerySchema, request.query);        // 쿼리
 * 필드별 문구는 스키마에서 직접 지정하는 것을 권장한다: z.string({ error: '거래처명을 입력해 주세요.' }).min(1, '거래처명을 입력해 주세요.')
 * 지정하지 않은 경우 koreanErrorMap 의 기본 한국어 문구가 쓰인다.
 */
import { z } from 'zod';
import { AppError } from './errors.js';

type Issue = z.core.$ZodRawIssue;

function sizeUnit(origin: unknown): string {
  switch (origin) {
    case 'string':
      return '자';
    case 'array':
    case 'set':
      return '개';
    case 'file':
      return '바이트';
    default:
      return '';
  }
}

/** zod 기본 오류 문구를 자연스러운 한국어로 바꾼다. */
export const koreanErrorMap = (issue: Issue): string => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined || issue.input === null) return '필수 입력 항목입니다.';
      return '입력 형식이 올바르지 않습니다.';
    case 'too_small': {
      const unit = sizeUnit(issue.origin);
      if (issue.origin === 'string' && Number(issue.minimum) === 1) return '필수 입력 항목입니다.';
      if (unit) return `${String(issue.minimum)}${unit} 이상 입력해 주세요.`;
      return `${String(issue.minimum)} 이상이어야 합니다.`;
    }
    case 'too_big': {
      const unit = sizeUnit(issue.origin);
      if (unit) return `${String(issue.maximum)}${unit} 이하로 입력해 주세요.`;
      return `${String(issue.maximum)} 이하여야 합니다.`;
    }
    case 'invalid_format':
      return '형식이 올바르지 않습니다.';
    case 'invalid_value':
      return '허용되지 않는 값입니다.';
    case 'not_multiple_of':
      return '허용되지 않는 값입니다.';
    case 'unrecognized_keys':
      return '알 수 없는 항목이 포함되어 있습니다.';
    default:
      return '입력한 내용을 확인해 주세요.';
  }
};

/** zod 오류 → fields 맵 (같은 필드는 첫 메시지만). 경로가 없으면 '_' 키 */
export function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function validationError(error: z.ZodError, message?: string): AppError {
  const fields = zodFields(error);
  const keys = Object.keys(fields);
  const first = keys.length > 0 ? fields[keys[0] as string] : undefined;
  const msg = message ?? (keys.length === 1 && first ? first : '입력한 내용을 확인해 주세요.');
  const { _: general, ...rest } = fields;
  void general;
  return new AppError('VALIDATION_FAILED', msg, { fields: rest });
}

/** 스키마로 검증하고 결과를 반환한다. 실패하면 AppError(VALIDATION_FAILED) 를 던진다. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown, message?: string): z.output<S> {
  const result = schema.safeParse(input, { error: koreanErrorMap });
  if (!result.success) throw validationError(result.error, message);
  return result.data;
}

// ───────────── 자주 쓰는 스키마 조각 ─────────────

/** 페이지네이션 쿼리: page(1부터), pageSize(기본 30, 최대 100) */
export const pagingQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export type PagingQuery = z.output<typeof pagingQuery>;

/** 검색어: 앞뒤 공백 제거, 빈 문자열은 undefined, 최대 100자 */
export const searchText = z
  .string()
  .max(100, '검색어는 100자 이하로 입력해 주세요.')
  .optional()
  .transform((v) => {
    const t = v?.trim();
    return t ? t : undefined;
  });

/** 선택 입력 문자열: trim 후 빈 값이면 null */
export function optionalText(max: number, tooLongMessage?: string) {
  return z
    .string()
    .nullish()
    .transform((v, ctx) => {
      const t = v?.trim() ?? '';
      if (t.length > max) {
        ctx.addIssue({ code: 'custom', message: tooLongMessage ?? `${max}자 이하로 입력해 주세요.` });
        return z.NEVER;
      }
      return t === '' ? null : t;
    });
}

/** LIKE/ILIKE 패턴용 이스케이프(% _ \) — SQL 에서는 `ILIKE '%' || $1 || '%' ESCAPE '\'` 와 함께 사용 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 페이지 계산 헬퍼 */
export function pageOffset(p: PagingQuery): { limit: number; offset: number } {
  return { limit: p.pageSize, offset: (p.page - 1) * p.pageSize };
}

export function paged<T>(items: T[], p: PagingQuery, total: number) {
  return { items, page: p.page, pageSize: p.pageSize, total, hasMore: p.page * p.pageSize < total };
}
