export type StockStatus = 'OUT' | 'LOW' | 'OK';
export type MoveKind = 'IN' | 'OUT' | 'CHECK';

export interface Item {
  id: number;
  name: string;
  category: string;
  unit: string;
  minStock: number;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
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
  }) {
    return request<{ ok: true; itemName: string; unit: string; stock: number; status: StockStatus }>('/moves', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, day: today() }),
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
