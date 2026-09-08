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
  /** 兜底阈值：只在还算不出消耗速度时用来判断告警 */
  minStock: number;
  /** 每周补货后希望达到的基本单位库存；0 表示不加入补货计划 */
  weeklyTarget: number;
  /** 从下单到送到要几天 */
  leadTimeDays: number;
  /** 实测日均消耗；null 表示盘点次数还不够，算不出来 */
  dailyUse: number | null;
  /** 按现在的速度还能撑几天 */
  daysLeft: number | null;
  /** 低于这个数就该下单了 */
  reorderPoint: number;
  reorderBasis: 'USAGE' | 'MIN_STOCK';
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
  /** 最近一次盘点的日期；null 表示从没盘过 */
  lastCheckDay: string | null;
  daysSinceCheck: number | null;
  needCheck: boolean;
  /** 已攒够数据、能算出消耗速度的货品数 */
  trackedItems: number;
}

export interface User {
  id: number;
  username: string;
  displayName: string;
  currency: string;
}

export interface Supplier {
  id: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
}

export type PurchaseStatus = 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrder {
  id: number;
  supplierId: number | null;
  supplierName: string | null;
  orderNo: string | null;
  status: PurchaseStatus;
  orderedDay: string | null;
  expectedDay: string | null;
  receivedDay: string | null;
  note: string | null;
  createdAt: string;
  lineCount: number;
  orderedTotal: number;
  receivedTotal: number;
}

export interface PurchaseOrderLine {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  packSize: number | null;
  packUnit: string | null;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  unitPrice: number | null;
  note: string | null;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: PurchaseOrderLine[];
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
  /** 整场盘点一次提交：一个请求、一个事务，不会盘到一半 */
  submitStocktake(items: { itemId: number; countedQty: number }[], requestId: string) {
    return request<{ ok: true; day: string; counted: number; changed: number }>('/moves/stocktake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, requestId, day: today(), note: '盘点' }),
    });
  },
  deleteMove(id: number) {
    return request<{ ok: true }>(`/moves/${id}`, { method: 'DELETE' });
  },
  summary() {
    return request<Summary>(`/summary?day=${today()}`);
  },
  suppliers() {
    return request<Supplier[]>('/suppliers');
  },
  createSupplier(body: Partial<Supplier>) {
    return request<{ id: number }>('/suppliers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  updateSupplier(id: number, body: Partial<Supplier>) {
    return request<{ ok: true }>(`/suppliers/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  archiveSupplier(id: number) {
    return request<{ ok: true }>(`/suppliers/${id}`, { method: 'DELETE' });
  },
  purchases(status?: PurchaseStatus | '') {
    const qs = status ? `?status=${status}` : '';
    return request<PurchaseOrder[]>(`/purchases${qs}`);
  },
  purchase(id: number) {
    return request<PurchaseOrderDetail>(`/purchases/${id}`);
  },
  createPurchase(body: {
    supplierId?: number | null;
    orderNo?: string | null;
    expectedDay?: string | null;
    note?: string | null;
    lines: { itemId: number; orderedQty: number; unitPrice?: number | null; note?: string | null }[];
  }) {
    return request<{ id: number }>('/purchases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  updatePurchase(id: number, body: { expectedDay?: string | null; note?: string | null }) {
    return request<{ ok: true }>(`/purchases/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  cancelPurchase(id: number) {
    return request<{ ok: true }>(`/purchases/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' }),
    });
  },
  /** 对货记账：核对实收数量后一次性提交，记库存流水并推进采购单状态 */
  receivePurchase(id: number, lines: { lineId: number; receivedQty: number }[], requestId: string) {
    return request<{ ok: true; status: PurchaseStatus; over: boolean; items: { id: number; name: string; unit: string; receivedQty: number }[] }>(
      `/purchases/${id}/receive`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines, requestId, day: today() }),
      },
    );
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
