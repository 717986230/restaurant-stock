import { ref } from 'vue';

export type StockStatus = 'OUT' | 'LOW' | 'OK';
export type MoveKind = 'IN' | 'OUT' | 'CHECK';

export interface Item {
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
  /** 每周补货后希望达到的基本单位库存；0 表示不加入补货计划 */
  weeklyTarget: number;
  /** 默认存放仓位名称 */
  locationName: string | null;
  lastPrice: number | null;
  hasImage: boolean;
  note: string | null;
  stock: number;
  status: StockStatus;
}

export interface Move {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  kind: MoveKind;
  qty: number;
  unitPrice: number | null;
  countedQty: number | null;
  note: string | null;
  operator: string | null;
  day: string;
  createdAt: string;
}

export interface Summary {
  day: string;
  items: number;
  low: number;
  out: number;
  alerts: number;
  todayIn: number;
  todayOut: number;
  todayCheck: number;
}

export interface User {
  id: number;
  username: string;
  displayName: string;
  currency: string;
}

/** null 表示没登录，App 会盖上登录页；任何一个接口 401 都会把它清掉 */
export const currentUser = ref<User | null>(null);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    if (res.status === 401 && path !== '/login' && path !== '/register') currentUser.value = null;
    let message = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // 后端没返回 JSON，就用上面的兜底文案
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** 门店本地日期。用它而不是 UTC，否则晚上 8 点之后记的账会算到明天。 */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const api = {
  me() {
    return request<{ ok: boolean; user?: User }>('/me');
  },
  register(username: string, key: string, invite: string) {
    return request<{ ok: true; user: User; seeded: number }>('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, key, invite }),
    });
  },
  login(username: string, key: string) {
    return request<{ ok: true; user: User }>('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, key }),
    });
  },
  logout() {
    return request<{ ok: true }>('/logout', { method: 'POST' });
  },
  items(params: { q?: string; category?: string; low?: boolean } = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category) qs.set('category', params.category);
    if (params.low) qs.set('low', '1');
    return request<Item[]>(`/items?${qs}`);
  },
  item(id: number) {
    return request<Item>(`/items/${id}`);
  },
  categories() {
    return request<string[]>('/items/categories');
  },
  locations() {
    return request<string[]>('/items/locations');
  },
  createItem(body: Partial<Item>) {
    return request<{ id: number; restored: boolean }>('/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  updateItem(id: number, body: Partial<Item>) {
    return request<{ ok: true }>(`/items/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  deleteItem(id: number) {
    return request<{ ok: true }>(`/items/${id}`, { method: 'DELETE' });
  },
  bulkDeleteItems(ids: number[]) {
    return request<{ ok: true; archived: number; skipped: number }>('/items/bulk-archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  },
  async uploadImage(id: number, file: Blob) {
    const form = new FormData();
    form.append('file', file, 'photo.jpg');
    return request<{ ok: true; url: string }>(`/items/${id}/image`, { method: 'POST', body: form });
  },
  deleteImage(id: number) {
    return request<{ ok: true }>(`/items/${id}/image`, { method: 'DELETE' });
  },
  moves(params: { itemId?: number; day?: string; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.itemId) qs.set('itemId', String(params.itemId));
    if (params.day) qs.set('day', params.day);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<Move[]>(`/moves?${qs}`);
  },
  createMove(body: {
    itemId: number;
    kind: MoveKind;
    qty?: number;
    countedQty?: number;
    unitPrice?: number | null;
    note?: string | null;
    operator?: string | null;
    requestId?: string;
    referenceNo?: string | null;
  }) {
    return request<{ ok: true; itemName: string; unit: string; stock: number; status: StockStatus }>('/moves', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...body, day: today() }),
    });
  },
  deleteMove(id: number) {
    return request<{ ok: true }>(`/moves/${id}`, { method: 'DELETE' });
  },
  summary() {
    return request<Summary>(`/summary?day=${today()}`);
  },
};

export function imageUrl(item: Pick<Item, 'id' | 'hasImage'>): string | null {
  return item.hasImage ? `/api/items/${item.id}/image` : null;
}

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
export function fmt(n: number): string {
  return NUMBER_FORMAT.format(n);
}

const MONEY_FORMATS = new Map<string, Intl.NumberFormat>();
export function money(n: number): string {
  const currency = currentUser.value?.currency ?? 'EUR';
  let formatter = MONEY_FORMATS.get(currency);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency });
    } catch {
      formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'EUR' });
    }
    MONEY_FORMATS.set(currency, formatter);
  }
  return formatter.format(n);
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

type PackItem = Pick<Item, 'unit' | 'packSize' | 'packUnit'>;

/**
 * 把总瓶数折成「3 箱 5 瓶」。库存永远按瓶存，箱只在显示和录入时换算，
 * 所以拆箱零卖之后不会冒出「0.21 箱」这种没法点货的数。
 */
export function packText(qty: number, item: PackItem): string {
  if (!item.packSize || qty <= 0) return '';
  const boxes = Math.floor(qty / item.packSize);
  const rest = round3(qty - boxes * item.packSize);
  if (!boxes) return '';
  return rest ? `${fmt(boxes)} ${item.packUnit} ${fmt(rest)} ${item.unit}` : `${fmt(boxes)} ${item.packUnit}`;
}

/** 「1 箱 = 24 瓶」这行说明文字 */
export function packSpec(item: PackItem): string {
  return item.packSize ? `1 ${item.packUnit} = ${fmt(item.packSize)} ${item.unit}` : '';
}
