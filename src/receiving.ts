import { Hono } from 'hono';
import { ApiError, normalizeDay, optionalDay, optionalText, requireNumber, requireText, round3, type AppEnv } from './types';

export const receiving = new Hono<AppEnv>();

// llama-3.2-11b-vision 走的是 image/prompt 那套老入参，而且要先发一次 "agree"
// 接受 Meta 许可才能用；换成原生多模态的 Scout，标准 messages + image_url 入参。
const VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

const RECOGNIZE_PROMPT = `你在识别一张中文餐馆供应商送货时留下的纸质对货单（可能是手写或打印的送货单/对账单）。
仔细看图片里的表格或清单，把每一行货品整理成 JSON，只输出 JSON 本身，不要输出任何解释文字或代码块标记。

严格按这个格式输出：
{
  "supplierName": "供应商名称，看不出来就填 null",
  "day": "单据上的日期，格式 YYYY-MM-DD，看不出来就填 null",
  "lines": [
    { "itemName": "货品名称", "qty": 数字或null, "unit": "单位比如箱/瓶/包，看不出来就填 null", "unitPrice": 单价数字或null, "amount": 这一行金额数字或null }
  ]
}

数字字段认不清就填 null，不要瞎编数字。lines 按单据从上到下的顺序排列，看不清的字也要尽量按最像的字填，不要跳过整行。`;

interface DraftLine {
  itemName: string;
  qty: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
}

/** AI 有时候会在 JSON 前后加几句话或代码块标记，这里只取第一个花括号包住的部分 */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new ApiError(502, 'AI 没认出表格，请重试一次或手动填写');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ApiError(502, 'AI 识别结果解析失败，请重试一次或手动填写');
  }
}

function asNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return round3(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return round3(Number(v));
  return null;
}

function asTextOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null;
}

/** 模型只收 data URI 形式的图（文档明确写了 HTTP URL 不认），分段转是因为
 *  一次性展开十万个字节做 fromCharCode 会把调用栈撑爆 */
function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function toDraftLines(raw: unknown): DraftLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: DraftLine[] = [];
  for (const r of raw.slice(0, 200)) {
    const row = r as Record<string, unknown>;
    const itemName = asTextOrNull(row.itemName);
    if (!itemName) continue;
    lines.push({
      itemName,
      qty: asNumberOrNull(row.qty),
      unit: asTextOrNull(row.unit),
      unitPrice: asNumberOrNull(row.unitPrice),
      amount: asNumberOrNull(row.amount),
    });
  }
  return lines;
}

interface SlipRow {
  id: number;
  slip_day: string;
  supplier_name: string | null;
  total_amount: number | null;
  note: string | null;
  settled_at: string | null;
  created_at: string;
  line_count: number;
  image_count: number;
}

function toSlipDto(r: SlipRow) {
  return {
    id: r.id,
    slipDay: r.slip_day,
    supplierName: r.supplier_name,
    totalAmount: r.total_amount == null ? null : round3(r.total_amount),
    note: r.note,
    settled: r.settled_at !== null,
    settledAt: r.settled_at,
    createdAt: r.created_at,
    lineCount: r.line_count,
    imageCount: r.image_count,
  };
}

const SLIP_SELECT = `
  select s.id, s.slip_day, s.supplier_name, s.total_amount, s.note, s.settled_at, s.created_at,
         (select count(*) from receiving_slip_lines l where l.slip_id = s.id) as line_count,
         (select count(*) from receiving_slip_images im where im.slip_id = s.id) as image_count
  from receiving_slips s
`;

receiving.get('/slips', async (c) => {
  const settled = c.req.query('settled');
  const where = ['s.user_id = ?'];
  const binds: unknown[] = [c.var.userId];
  if (settled === '0') where.push('s.settled_at is null');
  else if (settled === '1') where.push('s.settled_at is not null');

  const sql = `${SLIP_SELECT} where ${where.join(' and ')} order by s.slip_day desc, s.id desc limit 300`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<SlipRow>();
  return c.json(results.map(toSlipDto));
});

interface LineRow {
  id: number;
  item_name: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number | null;
  note: string | null;
}

interface ImageRow {
  id: number;
  kind: 'SLIP' | 'GOODS';
}

receiving.get('/slips/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [slip, linesRes, imagesRes] = await Promise.all([
    c.env.DB.prepare(`${SLIP_SELECT} where s.id = ? and s.user_id = ?`).bind(id, c.var.userId).first<SlipRow>(),
    c.env.DB.prepare(
      `select id, item_name, qty, unit, unit_price, amount, note from receiving_slip_lines
       where slip_id = ? and user_id = ? order by line_no`,
    ).bind(id, c.var.userId).all<LineRow>(),
    c.env.DB.prepare(`select id, kind from receiving_slip_images where slip_id = ? and user_id = ? order by id`)
      .bind(id, c.var.userId)
      .all<ImageRow>(),
  ]);
  if (!slip) throw new ApiError(404, '对货单不存在');
  return c.json({
    ...toSlipDto(slip),
    lines: linesRes.results.map((l) => ({
      id: l.id,
      itemName: l.item_name,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unit_price,
      amount: l.amount,
      note: l.note,
    })),
    images: imagesRes.results.map((im) => ({ id: im.id, kind: im.kind, url: `/api/receiving/slips/${id}/images/${im.id}` })),
  });
});

receiving.post('/slips', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const day = normalizeDay(body.day);
  const supplierName = optionalText(body.supplierName, 60);
  const note = optionalText(body.note, 255);

  const res = await c.env.DB.prepare(
    `insert into receiving_slips (user_id, slip_day, supplier_name, note) values (?, ?, ?, ?)`,
  ).bind(c.var.userId, day, supplierName, note).run();
  return c.json({ id: Number(res.meta.last_row_id) }, 201);
});

async function requireOpenSlip(db: D1Database, userId: number, id: number): Promise<void> {
  const slip = await db.prepare('select settled_at from receiving_slips where id = ? and user_id = ?')
    .bind(id, userId)
    .first<{ settled_at: string | null }>();
  if (!slip) throw new ApiError(404, '对货单不存在');
  if (slip.settled_at !== null) throw new ApiError(400, '这张对货单已经结账，不能再修改');
}

const MAX_LINES = 200;

/** 保存表格：整单的明细一次性替换，跟盘点/收货一个思路——半页表格没意义 */
receiving.put('/slips/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await requireOpenSlip(c.env.DB, c.var.userId, id);

  const body = await c.req.json<Record<string, unknown>>();
  const day = body.day === undefined ? null : normalizeDay(body.day);
  const supplierNameProvided = Object.prototype.hasOwnProperty.call(body, 'supplierName');
  const noteProvided = Object.prototype.hasOwnProperty.call(body, 'note');

  const rawLines = body.lines;
  let lines: { itemName: string; qty: number | null; unit: string | null; unitPrice: number | null; amount: number | null; note: string | null }[] | null = null;
  if (rawLines !== undefined) {
    if (!Array.isArray(rawLines)) throw new ApiError(400, '货品明细格式不对');
    if (rawLines.length > MAX_LINES) throw new ApiError(400, `一次最多 ${MAX_LINES} 项`);
    lines = rawLines.map((raw) => {
      const r = raw as Record<string, unknown>;
      const itemName = requireText(r.itemName, '货品名称', 80);
      const qty = r.qty === undefined || r.qty === null || r.qty === '' ? null : requireNumber(r.qty, '数量', { min: 0 });
      const unit = optionalText(r.unit, 16);
      const unitPrice = r.unitPrice === undefined || r.unitPrice === null || r.unitPrice === '' ? null : requireNumber(r.unitPrice, '单价', { min: 0 });
      const amount = r.amount === undefined || r.amount === null || r.amount === ''
        ? qty !== null && unitPrice !== null ? round3(qty * unitPrice) : null
        : requireNumber(r.amount, '金额', { min: 0 });
      return { itemName, qty, unit, unitPrice, amount, note: optionalText(r.note, 120) };
    });
  }

  const statements = [];
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const setBinds: unknown[] = [];
  if (day !== null) {
    sets.push('slip_day = ?');
    setBinds.push(day);
  }
  if (supplierNameProvided) {
    sets.push('supplier_name = ?');
    setBinds.push(optionalText(body.supplierName, 60));
  }
  if (noteProvided) {
    sets.push('note = ?');
    setBinds.push(optionalText(body.note, 255));
  }
  if (lines !== null) {
    const total = round3(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0));
    sets.push('total_amount = ?');
    setBinds.push(lines.length ? total : null);
  }
  statements.push(
    c.env.DB.prepare(`update receiving_slips set ${sets.join(', ')} where id = ? and user_id = ?`).bind(...setBinds, id, c.var.userId),
  );
  if (lines !== null) {
    statements.push(c.env.DB.prepare('delete from receiving_slip_lines where slip_id = ? and user_id = ?').bind(id, c.var.userId));
    lines.forEach((l, i) => {
      statements.push(
        c.env.DB.prepare(
          `insert into receiving_slip_lines (user_id, slip_id, line_no, item_name, qty, unit, unit_price, amount, note)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(c.var.userId, id, i + 1, l.itemName, l.qty, l.unit, l.unitPrice, l.amount, l.note),
      );
    });
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

receiving.delete('/slips/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await requireOpenSlip(c.env.DB, c.var.userId, id);
  await c.env.DB.prepare('delete from receiving_slips where id = ? and user_id = ?').bind(id, c.var.userId).run();
  return c.json({ ok: true });
});

const MAX_IMAGE_BYTES = 1_500_000;
const MAX_IMAGES_PER_SLIP = 8;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

receiving.post('/slips/:id/images', async (c) => {
  const id = Number(c.req.param('id'));
  await requireOpenSlip(c.env.DB, c.var.userId, id);

  const form = await c.req.formData();
  const file = form.get('file');
  const kind = form.get('kind');
  if (kind !== 'SLIP' && kind !== 'GOODS') throw new ApiError(400, '照片类型不对');
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, '没有收到图片文件');
  if (!IMAGE_TYPES.has(file.type)) throw new ApiError(400, '只支持 JPG、PNG 或 WebP 图片');
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, '图片太大了，请重新拍一张');

  const count = await c.env.DB.prepare('select count(*) as n from receiving_slip_images where slip_id = ? and user_id = ?')
    .bind(id, c.var.userId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_IMAGES_PER_SLIP) throw new ApiError(400, `一张对货单最多传 ${MAX_IMAGES_PER_SLIP} 张照片`);

  const bytes = await file.arrayBuffer();
  const res = await c.env.DB.prepare(
    `insert into receiving_slip_images (user_id, slip_id, kind, mime, bytes) values (?, ?, ?, ?, ?)`,
  ).bind(c.var.userId, id, kind, file.type, bytes).run();
  const imageId = Number(res.meta.last_row_id);
  return c.json({ id: imageId, kind, url: `/api/receiving/slips/${id}/images/${imageId}` }, 201);
});

receiving.get('/slips/:id/images/:imageId', async (c) => {
  const id = Number(c.req.param('id'));
  const imageId = Number(c.req.param('imageId'));
  const row = await c.env.DB.prepare(
    `select im.mime, im.bytes from receiving_slip_images im
     join receiving_slips s on s.id = im.slip_id
     where im.id = ? and im.slip_id = ? and s.user_id = ?`,
  ).bind(imageId, id, c.var.userId).first<{ mime: string; bytes: ArrayBuffer | number[] }>();
  if (!row) throw new ApiError(404, '照片不存在');
  const body = row.bytes instanceof ArrayBuffer ? row.bytes : new Uint8Array(row.bytes as number[]);
  return new Response(body, {
    headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=31536000, immutable' },
  });
});

receiving.delete('/slips/:id/images/:imageId', async (c) => {
  const id = Number(c.req.param('id'));
  const imageId = Number(c.req.param('imageId'));
  await requireOpenSlip(c.env.DB, c.var.userId, id);
  const res = await c.env.DB.prepare('delete from receiving_slip_images where id = ? and slip_id = ? and user_id = ?')
    .bind(imageId, id, c.var.userId)
    .run();
  if (res.meta.changes === 0) throw new ApiError(404, '照片不存在');
  return c.json({ ok: true });
});

/**
 * AI 识别：只读操作，不落库。识别结果先回给前端在表格里核对/修改，
 * 用户确认后再走 PUT /slips/:id 保存——AI 认错字总会有，不能直接当账。
 *
 * 一张对货单可能拍了好几张照片（单据太长、分几页），这里一次性把传入的
 * 所有照片都识别一遍再按顺序拼成一张表；某一张照片认失败不拖累其他几张，
 * 只在返回里报个数，前端提示"有几张没认出来"。
 */
receiving.post('/slips/:id/recognize', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const rawIds = Array.isArray(body.imageIds) ? body.imageIds : body.imageId !== undefined ? [body.imageId] : [];
  if (rawIds.length === 0) throw new ApiError(400, '请至少选一张照片');
  if (rawIds.length > MAX_IMAGES_PER_SLIP) throw new ApiError(400, `一次最多识别 ${MAX_IMAGES_PER_SLIP} 张`);
  const imageIds = rawIds.map((v) => requireNumber(v, '照片', { min: 1 }));

  const placeholders = imageIds.map(() => '?').join(',');
  const { results: rows } = await c.env.DB.prepare(
    `select im.id, im.mime, im.bytes from receiving_slip_images im
     join receiving_slips s on s.id = im.slip_id
     where im.slip_id = ? and s.user_id = ? and im.kind = 'SLIP' and im.id in (${placeholders})`,
  ).bind(id, c.var.userId, ...imageIds).all<{ id: number; mime: string; bytes: ArrayBuffer | number[] }>();
  if (rows.length !== imageIds.length) throw new ApiError(404, '有照片不存在');
  const byId = new Map(rows.map((r) => [r.id, r]));

  let supplierName: string | null = null;
  let day: string | null = null;
  const lines: DraftLine[] = [];
  let failedCount = 0;
  let lastError = '';
  for (const imageId of imageIds) {
    const row = byId.get(imageId)!;
    const bytes = row.bytes instanceof ArrayBuffer ? new Uint8Array(row.bytes) : new Uint8Array(row.bytes as number[]);
    try {
      const result = await c.env.AI.run(VISION_MODEL, {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: RECOGNIZE_PROMPT },
              { type: 'image_url', image_url: { url: toDataUrl(bytes, row.mime) } },
            ],
          },
        ],
        max_tokens: 2048,
      });
      const text = (result as { response?: string }).response ?? '';
      const parsed = extractJson(text) as Record<string, unknown>;
      if (!supplierName) supplierName = asTextOrNull(parsed.supplierName);
      if (!day) day = optionalDay(parsed.day);
      lines.push(...toDraftLines(parsed.lines));
    } catch (err) {
      failedCount++;
      // 全靠"AI 识别暂时不可用"这一句排查过一次，什么都查不出来，所以把真实原因留在日志里
      lastError = err instanceof Error ? err.message : String(err);
      console.error('recognize failed', { slipId: id, imageId, error: lastError });
    }
  }

  if (failedCount === imageIds.length) {
    throw new ApiError(502, `AI 识别暂时不可用（${lastError.slice(0, 120)}），请重试一次或手动填写`);
  }
  return c.json({ supplierName, day, lines, recognizedCount: imageIds.length - failedCount, failedCount });
});

receiving.get('/settlement/status', async (c) => {
  // 结账只会结「slip_day <= 选定日期」的单子，所以这里的待结账张数也得按同一个
  // 日期算。不然页面显示"待结账 3 张"、点下去却告诉你这段时间一张都没有。
  const toDay = normalizeDay(c.req.query('toDay'));
  const [last, pending] = await Promise.all([
    c.env.DB.prepare('select max(to_day) as day from settlements where user_id = ?').bind(c.var.userId).first<{ day: string | null }>(),
    c.env.DB.prepare(
      `select count(*) as n, coalesce(sum(total_amount), 0) as total
       from receiving_slips where user_id = ? and settled_at is null and slip_day <= ?`,
    ).bind(c.var.userId, toDay).first<{ n: number; total: number }>(),
  ]);
  return c.json({
    lastSettledDay: last?.day ?? null,
    pendingCount: pending?.n ?? 0,
    pendingTotal: round3(pending?.total ?? 0),
  });
});

receiving.get('/settlements', async (c) => {
  const { results } = await c.env.DB.prepare(
    `select id, from_day, to_day, slip_count, total_amount, created_at
     from settlements where user_id = ? order by to_day desc, id desc limit 100`,
  ).bind(c.var.userId).all<{ id: number; from_day: string | null; to_day: string; slip_count: number; total_amount: number; created_at: string }>();
  return c.json(
    results.map((r) => ({
      id: r.id,
      fromDay: r.from_day,
      toDay: r.to_day,
      slipCount: r.slip_count,
      totalAmount: round3(r.total_amount),
      createdAt: r.created_at,
    })),
  );
});

/** 结账：把「to_day 之前、还没结过账」的对货单一次性打包结清，settled_at 一写上就不会再被下一次结账选中 */
receiving.post('/settlements', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const toDay = normalizeDay(body.toDay);

  const lastSettled = await c.env.DB.prepare('select max(to_day) as day from settlements where user_id = ?')
    .bind(c.var.userId)
    .first<{ day: string | null }>();
  const fromDay = lastSettled?.day ?? null;

  const { results: pending } = await c.env.DB.prepare(
    `select id, total_amount from receiving_slips
     where user_id = ? and settled_at is null and slip_day <= ?`,
  ).bind(c.var.userId, toDay).all<{ id: number; total_amount: number | null }>();

  if (!pending.length) throw new ApiError(400, '这段时间没有还没结账的对货单');

  const total = round3(pending.reduce((sum, r) => sum + (r.total_amount ?? 0), 0));
  const settlementInsert = await c.env.DB.prepare(
    `insert into settlements (user_id, from_day, to_day, slip_count, total_amount) values (?, ?, ?, ?, ?)`,
  ).bind(c.var.userId, fromDay, toDay, pending.length, total).run();
  const settlementId = Number(settlementInsert.meta.last_row_id);

  const ids = pending.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  await c.env.DB.prepare(
    `update receiving_slips set settlement_id = ?, settled_at = datetime('now'), updated_at = datetime('now')
     where user_id = ? and id in (${placeholders})`,
  ).bind(settlementId, c.var.userId, ...ids).run();

  return c.json({ id: settlementId, fromDay, toDay, slipCount: pending.length, totalAmount: total }, 201);
});

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

receiving.get('/settlements/:id/export.csv', async (c) => {
  const id = Number(c.req.param('id'));
  const settlement = await c.env.DB.prepare('select to_day from settlements where id = ? and user_id = ?')
    .bind(id, c.var.userId)
    .first<{ to_day: string }>();
  if (!settlement) throw new ApiError(404, '结账记录不存在');

  // 左连接：明细还没填的对货单也要出现在账单里。之前用内连接，
  // 一张只拍了照片没填表格的单子会整张从导出里消失，账面上凭空少一笔。
  const { results } = await c.env.DB.prepare(
    `select s.slip_day, s.supplier_name, s.note as slip_note,
            l.item_name, l.qty, l.unit, l.unit_price, l.amount, l.note as line_note
     from receiving_slips s
     left join receiving_slip_lines l on l.slip_id = s.id and l.user_id = s.user_id
     where s.settlement_id = ? and s.user_id = ?
     order by s.slip_day, s.id, l.line_no`,
  ).bind(id, c.var.userId).all<{
    slip_day: string;
    supplier_name: string | null;
    slip_note: string | null;
    item_name: string | null;
    qty: number | null;
    unit: string | null;
    unit_price: number | null;
    amount: number | null;
    line_note: string | null;
  }>();

  const header = ['日期', '供应商', '货品', '数量', '单位', '单价', '金额', '单据备注', '明细备注'];
  const lines = results.map((r) =>
    [
      r.slip_day,
      r.supplier_name ?? '',
      r.item_name ?? '（这张单还没填货品明细）',
      r.qty ?? '',
      r.unit ?? '',
      r.unit_price ?? '',
      r.amount ?? '',
      r.slip_note ?? '',
      r.line_note ?? '',
    ]
      .map(csvCell)
      .join(','),
  );

  // 会计要的是「这段时间一共多少钱」，让他自己在 Excel 里拉一遍 sum 不合适
  const total = round3(results.reduce((sum, r) => sum + (r.amount ?? 0), 0));
  const totalRow = ['合计', '', '', '', '', '', total, '', ''].map(csvCell).join(',');

  const body = '﻿' + [header.join(','), ...lines, totalRow].join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="settlement-${settlement.to_day}.csv"`,
    },
  });
});
