import { reorderPointOf, type ItemUsage } from './usage';

export interface Env {
  DB: D1Database;
  /** 注册邀请码，用 `wrangler secret put INVITE_CODE` 设置，不进代码库。没配置则注册关闭。 */
  INVITE_CODE?: string;
}

/** 鉴权中间件把当前登录用户放进 c.var.userId，业务查询一律按它过滤 */
export type AppEnv = {
  Bindings: Env;
  Variables: { userId: number };
};

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
  weekly_target: number;
  lead_time_days: number;
  location_name: string | null;
  last_price: number | null;
  has_image: number;
  note: string | null;
  stock: number;
}

/** 再订货点的依据：按实测消耗算出来的，还是退回到人工填的兜底阈值 */
export type ReorderBasis = 'USAGE' | 'MIN_STOCK';

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
  /** 兜底阈值：只在还算不出消耗速度时用来判断告警 */
  minStock: number;
  /** 每周补货后希望达到的基本单位库存；0 表示不加入补货计划 */
  weeklyTarget: number;
  /** 从下单到送到要几天 */
  leadTimeDays: number;
  /** 实测日均消耗；null 表示盘点次数还不够，算不出来 */
  dailyUse: number | null;
  /** 按现在的速度还能撑几天；dailyUse 为空时也为空 */
  daysLeft: number | null;
  /** 低于这个数就该下单了 */
  reorderPoint: number;
  reorderBasis: ReorderBasis;
  /** 默认存放仓位名称 */
  locationName: string | null;
  lastPrice: number | null;
  hasImage: boolean;
  note: string | null;
  stock: number;
  status: StockStatus;
}

/**
 * 库存告警两个来源：已经用光（<=0），或者已经跌到再订货点——
 * 即"现在不下单，货还没到就会断"。再订货点为 0 表示这件东西不用盯着。
 */
export function statusOf(stock: number, reorderPoint: number): StockStatus {
  if (stock <= 0) return 'OUT';
  if (reorderPoint > 0 && stock <= reorderPoint) return 'LOW';
  return 'OK';
}

export function toItemDto(row: ItemRow, usage?: ItemUsage): ItemDto {
  const stock = round3(row.stock ?? 0);
  const { point, basis } = reorderPointOf(usage, row.lead_time_days, row.min_stock);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    packSize: row.pack_size,
    packUnit: row.pack_unit,
    minStock: row.min_stock,
    weeklyTarget: row.weekly_target,
    leadTimeDays: row.lead_time_days,
    dailyUse: usage ? usage.dailyUse : null,
    daysLeft: usage && usage.dailyUse > 0 ? Math.floor(stock / usage.dailyUse) : null,
    reorderPoint: point,
    reorderBasis: basis,
    locationName: row.location_name,
    lastPrice: row.last_price,
    hasImage: row.has_image === 1,
    note: row.note,
    stock,
    status: statusOf(stock, point),
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
