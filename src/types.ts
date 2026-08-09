export interface Env {
  DB: D1Database;
  /** 6 位登录 PIN，用 `wrangler secret put APP_PIN` 设置，不进代码库 */
  APP_PIN?: string;
}

export type MoveKind = 'IN' | 'OUT' | 'CHECK';

/** 库存健康度，前端据此决定是否标红 */
export type StockStatus = 'OUT' | 'LOW' | 'OK';

export interface ItemRow {
  id: number;
  name: string;
  category: string;
  unit: string;
  pack_size: number | null;
  pack_unit: string | null;
  min_stock: number;
  last_price: number | null;
  has_image: number;
  note: string | null;
  stock: number;
}

export interface ItemDto {
  id: number;
  name: string;
  category: string;
  /** 基本单位（瓶 / 听 / 箱…），库存和流水一律以它计数 */
  unit: string;
  /** 一个大单位等于多少个基本单位，如 1 箱 = 24 瓶；null 表示不换算 */
  packSize: number | null;
  /** 大单位名，如「箱」 */
  packUnit: string | null;
  minStock: number;
  lastPrice: number | null;
  hasImage: boolean;
  note: string | null;
  stock: number;
  status: StockStatus;
}

/**
 * 库存告警只有两个来源：已经用光（<=0），或者已经跌到自己设的阈值。
 * 阈值为 0 表示这件东西不需要盯着，就只在真用光时报警。
 */
export function statusOf(stock: number, minStock: number): StockStatus {
  if (stock <= 0) return 'OUT';
  if (minStock > 0 && stock <= minStock) return 'LOW';
  return 'OK';
}

export function toItemDto(row: ItemRow): ItemDto {
  const stock = round3(row.stock ?? 0);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    packSize: row.pack_size,
    packUnit: row.pack_unit,
    minStock: row.min_stock,
    lastPrice: row.last_price,
    hasImage: row.has_image === 1,
    note: row.note,
    stock,
    status: statusOf(stock, row.min_stock),
  };
}

/** 浮点求和会攒出 0.30000000000000004 这种尾巴，落到页面上很难看 */
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function requireNumber(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new ApiError(400, `${field} 必须是数字`);
  }
  if (opts.min !== undefined && n < opts.min) throw new ApiError(400, `${field} 不能小于 ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new ApiError(400, `${field} 不能大于 ${opts.max}`);
  return n;
}

export function requireText(value: unknown, field: string, maxLen: number): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new ApiError(400, `${field} 不能为空`);
  if (s.length > maxLen) throw new ApiError(400, `${field} 不能超过 ${maxLen} 个字`);
  return s;
}

export function optionalText(value: unknown, maxLen: number): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  return s.slice(0, maxLen);
}

/** 门店本地日期由前端给，服务端只做格式校验，避免 UTC 把当日流水切到昨天 */
export function normalizeDay(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}
