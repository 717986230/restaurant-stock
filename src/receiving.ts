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
  "invoiceNo": "单据编号，看不出来就填 null",
  "day": "单据上的日期，格式 YYYY-MM-DD，看不出来就填 null",
  "netAmount": 不含税净额数字或null,
  "taxAmount": 税额合计数字或null,
  "grossAmount": 含税总计数字或null,
  "lines": [
    { "itemName": "货品名称", "qty": 数字或null, "unit": "单位比如箱/瓶/包，看不出来就填 null", "unitPrice": 单价数字或null, "amount": 这一行金额数字或null }
  ]
}

单据编号找这些字样后面的那串号：Rechnung / Rechnungs-Nr / Beleg-Nr / Invoice / 发票号 / 单号。
注意别跟客户号（Kunden-Nr）、货号（Art.-Nr）搞混，那些不是单据编号。

三个金额对应单据底部的汇总栏，德语单据通常是这三行：
  Netto / Nettobetrag        → netAmount   不含税净额
  MwSt / Summe MwSt / USt    → taxAmount   税额合计
  Gesamtbetrag / Brutto      → grossAmount 含税总计，也就是实际要付的钱
只有一个总额、看不出税额的单据，就把那个数填进 grossAmount，另外两个填 null。
金额一律填数字，别带货币符号和千位分隔符（1.234,56 这种要写成 1234.56）。

数字字段认不清就填 null，不要瞎编数字。lines 按单据从上到下的顺序排列，看不清的字也要尽量按最像的字填，不要跳过整行。`;

interface DraftLine {
  itemName: string;
  qty: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
}

/** 一段返回内容可能是纯字符串，也可能是 [{type:'text',text:'…'}] 这样的块数组 */
function pickText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value : null;
  if (Array.isArray(value)) {
    const joined = value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          const t = (part as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .join('');
    return joined.trim() ? joined : null;
  }
  if (value && typeof value === 'object' && 'text' in value) {
    const t = (value as { text?: unknown }).text;
    return typeof t === 'string' && t.trim() ? t : null;
  }
  return null;
}

/**
 * 各家模型的返回壳子不一样：文档上写 response 是字符串，实际可能是内容块数组，
 * 换成 OpenAI 兼容端点又变成 choices[0].message.content。挨个试，
 * 一个都对不上就把真实结构报出来——别再让"识别不可用"这一句把原因吞掉。
 */
function textOf(result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const choices = r.choices;
  const firstChoice =
    Array.isArray(choices) && choices[0] && typeof choices[0] === 'object'
      ? (choices[0] as { message?: { content?: unknown } }).message?.content
      : undefined;

  for (const candidate of [r.response, firstChoice, r.output_text]) {
    const text = pickText(candidate);
    if (text) return text;
  }
  throw new Error(`看不懂模型返回结构: ${JSON.stringify(result).slice(0, 200)}`);
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
  invoice_no: string | null;
  net_amount: number | null;
  tax_amount: number | null;
  gross_amount: number | null;
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
    invoiceNo: r.invoice_no,
    netAmount: r.net_amount == null ? null : round3(r.net_amount),
    taxAmount: r.tax_amount == null ? null : round3(r.tax_amount),
    grossAmount: r.gross_amount == null ? null : round3(r.gross_amount),
    /** 进结账的就是这个数：单据上印了含税总额就用它，没印才退回明细之和 */
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
  select s.id, s.slip_day, s.supplier_name, s.invoice_no,
         s.net_amount, s.tax_amount, s.gross_amount, s.total_amount,
         s.note, s.settled_at, s.created_at,
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

/**
 * 同一张发票录两遍，会计那边就多付一笔。编号是单据自带的唯一标识，
 * 拿它拦最省事。
 *
 * 按供应商分组比对而不是全账号比对：小供应商的手写单编号常常就是
 * 「001」「002」，跨供应商撞号是正常现象，全局查重会把好单也拦下来。
 * 供应商没填时退回全账号比对——宁可多问一句，也好过把重复的单放进去。
 */
async function assertInvoiceNoUnused(
  db: D1Database,
  userId: number,
  slipId: number,
  invoiceNo: string,
  supplierName: string | null,
): Promise<void> {
  const sql = supplierName
    ? `select id, slip_day, supplier_name from receiving_slips
       where user_id = ? and invoice_no = ? and id <> ? and supplier_name = ? limit 1`
    : `select id, slip_day, supplier_name from receiving_slips
       where user_id = ? and invoice_no = ? and id <> ? limit 1`;
  const binds = supplierName ? [userId, invoiceNo, slipId, supplierName] : [userId, invoiceNo, slipId];
  const clash = await db.prepare(sql).bind(...binds).first<{ id: number; slip_day: string; supplier_name: string | null }>();
  if (clash) {
    throw new ApiError(
      409,
      `单据编号「${invoiceNo}」已经录过了：${clash.slip_day}${clash.supplier_name ? ` · ${clash.supplier_name}` : ''}（第 ${clash.id} 号对货单）。同一张单不要录两遍。`,
    );
  }
}

/** 金额可以留空（手写单常常只有个总数），但填了就必须是合法的非负数 */
function optionalAmount(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  return requireNumber(value, field, { min: 0 });
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
  const invoiceNoProvided = Object.prototype.hasOwnProperty.call(body, 'invoiceNo');
  const invoiceNo = invoiceNoProvided ? optionalText(body.invoiceNo, 60) : null;

  const netAmount = optionalAmount(body.netAmount, '净额');
  const taxAmount = optionalAmount(body.taxAmount, '税额');
  const grossAmount = optionalAmount(body.grossAmount, '实付总额');

  if (invoiceNo) {
    // 供应商用这次要存的值来判，不是库里的旧值——同一次提交里改了供应商又填了
    // 编号时，得按改完之后的组合去查重
    const supplierForCheck = supplierNameProvided
      ? optionalText(body.supplierName, 60)
      : (await c.env.DB.prepare('select supplier_name from receiving_slips where id = ? and user_id = ?')
          .bind(id, c.var.userId)
          .first<{ supplier_name: string | null }>())?.supplier_name ?? null;
    await assertInvoiceNoUnused(c.env.DB, c.var.userId, id, invoiceNo, supplierForCheck);
  }

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
  if (invoiceNoProvided) {
    sets.push('invoice_no = ?');
    setBinds.push(invoiceNo);
  }
  sets.push('net_amount = ?', 'tax_amount = ?', 'gross_amount = ?');
  setBinds.push(netAmount, taxAmount, grossAmount);

  // 进结账的金额：单据上印了含税总额就照它付，没印才退回明细之和。
  // 明细那一列在欧洲发票上是净额，直接拿来当总额会漏掉整个税额。
  const lineTotal = lines === null ? null : lines.length ? round3(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0)) : null;
  if (grossAmount !== null || lines !== null) {
    sets.push('total_amount = ?');
    setBinds.push(grossAmount ?? lineTotal);
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
  let invoiceNo: string | null = null;
  let day: string | null = null;
  let netAmount: number | null = null;
  let taxAmount: number | null = null;
  let grossAmount: number | null = null;
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
      const parsed = extractJson(textOf(result)) as Record<string, unknown>;
      // 单据分几张拍时，编号和汇总栏只会出现在其中一张上，所以取第一个认出来的
      if (!supplierName) supplierName = asTextOrNull(parsed.supplierName);
      if (!invoiceNo) invoiceNo = asTextOrNull(parsed.invoiceNo);
      if (!day) day = optionalDay(parsed.day);
      if (netAmount === null) netAmount = asNumberOrNull(parsed.netAmount);
      if (taxAmount === null) taxAmount = asNumberOrNull(parsed.taxAmount);
      if (grossAmount === null) grossAmount = asNumberOrNull(parsed.grossAmount);
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
  return c.json({
    supplierName,
    invoiceNo,
    day,
    netAmount,
    taxAmount,
    grossAmount,
    lines,
    recognizedCount: imageIds.length - failedCount,
    failedCount,
  });
});

/**
 * 月/季/年汇总。按单据日期分组，不管结没结账——结账是付款动作，
 * 而这张表回答的是"这段时间进了多少货"，跟发票日期对得上。
 *
 * SQLite 没有日期分组函数，slip_day 是 'YYYY-MM-DD' 定长字符串，直接截。
 * 季度：月份 1-3 → Q1，(月 + 2) / 3 整除刚好落到 1/2/3/4。
 */
const PERIOD_KEY = {
  month: `substr(s.slip_day, 1, 7)`,
  quarter: `substr(s.slip_day, 1, 4) || '-Q' || ((cast(substr(s.slip_day, 6, 2) as integer) + 2) / 3)`,
  year: `substr(s.slip_day, 1, 4)`,
} as const;

type Period = keyof typeof PERIOD_KEY;

function readPeriod(raw: string | undefined): Period {
  return raw === 'quarter' || raw === 'year' ? raw : 'month';
}

/** 一张单的钱只算一次：明细行数不该影响金额合计 */
const SLIP_MONEY = `
  coalesce(sum(s.net_amount), 0)   as net,
  coalesce(sum(s.tax_amount), 0)   as tax,
  coalesce(sum(s.total_amount), 0) as paid,
  count(*)                         as slip_count
`;

receiving.get('/summary', async (c) => {
  const period = readPeriod(c.req.query('period'));
  const key = PERIOD_KEY[period];
  const focus = c.req.query('key')?.trim();

  const { results: buckets } = await c.env.DB.prepare(
    `select ${key} as period_key, ${SLIP_MONEY}
     from receiving_slips s
     where s.user_id = ?
     group by period_key
     order by period_key desc
     limit 36`,
  ).bind(c.var.userId).all<{ period_key: string; net: number; tax: number; paid: number; slip_count: number }>();

  // 环比：按 key 倒序排的，所以"上一期"就是数组里的下一个。
  // 中间整期没进货就没有那一行，这时相邻的两个 key 并不连续——
  // 与其猜，不如把上一期的 key 一起返回，页面上写清楚在跟哪一期比。
  const periods = buckets.map((b, i) => {
    const prev = buckets[i + 1];
    const paid = round3(b.paid);
    const prevPaid = prev ? round3(prev.paid) : null;
    return {
      key: b.period_key,
      slipCount: b.slip_count,
      net: round3(b.net),
      tax: round3(b.tax),
      paid,
      prevKey: prev?.period_key ?? null,
      prevPaid,
      // 上一期是 0 的话算不出百分比（除零），只报绝对差额。
      // 百分比留一位小数就够，"+306.539%" 那种精度对花钱多少没有意义
      deltaPct: prevPaid ? Math.round(((paid - prevPaid) / prevPaid) * 1000) / 10 : null,
      delta: prevPaid === null ? null : round3(paid - prevPaid),
    };
  });

  if (!focus) return c.json({ period, periods });

  const [suppliers, items] = await Promise.all([
    c.env.DB.prepare(
      `select coalesce(s.supplier_name, '（没填供应商）') as name, ${SLIP_MONEY}
       from receiving_slips s
       where s.user_id = ? and ${key} = ?
       group by name
       order by paid desc, slip_count desc
       limit 100`,
    ).bind(c.var.userId, focus).all<{ name: string; net: number; tax: number; paid: number; slip_count: number }>(),
    c.env.DB.prepare(
      `select l.item_name as name, count(*) as line_count,
              coalesce(sum(l.qty), 0) as qty, coalesce(sum(l.amount), 0) as amount
       from receiving_slip_lines l
       join receiving_slips s on s.id = l.slip_id and s.user_id = l.user_id
       where s.user_id = ? and ${key} = ?
       group by l.item_name
       order by amount desc, line_count desc
       limit 100`,
    ).bind(c.var.userId, focus).all<{ name: string; line_count: number; qty: number; amount: number }>(),
  ]);

  return c.json({
    period,
    periods,
    focus,
    bySupplier: suppliers.results.map((r) => ({
      name: r.name,
      slipCount: r.slip_count,
      net: round3(r.net),
      tax: round3(r.tax),
      paid: round3(r.paid),
    })),
    // 货品名是 AI 从单据上认的，拼写不一致的话同一种货会分成几行，页面上要说明
    byItem: items.results.map((r) => ({
      name: r.name,
      lineCount: r.line_count,
      qty: round3(r.qty),
      amount: round3(r.amount),
    })),
  });
});

receiving.get('/summary/export.csv', async (c) => {
  const period = readPeriod(c.req.query('period'));
  const key = PERIOD_KEY[period];

  const [buckets, suppliers] = await Promise.all([
    c.env.DB.prepare(
      `select ${key} as period_key, ${SLIP_MONEY}
       from receiving_slips s where s.user_id = ?
       group by period_key order by period_key desc limit 36`,
    ).bind(c.var.userId).all<{ period_key: string; net: number; tax: number; paid: number; slip_count: number }>(),
    c.env.DB.prepare(
      `select ${key} as period_key, coalesce(s.supplier_name, '（没填供应商）') as name, ${SLIP_MONEY}
       from receiving_slips s where s.user_id = ?
       group by period_key, name order by period_key desc, paid desc limit 500`,
    ).bind(c.var.userId).all<{ period_key: string; name: string; net: number; tax: number; paid: number; slip_count: number }>(),
  ]);

  const label = { month: '月度', quarter: '季度', year: '年度' }[period];
  const rows: string[] = [];
  rows.push([`${label}汇总`, '单据数', '净额', '税额', '实付'].map(csvCell).join(','));
  for (const b of buckets.results) {
    rows.push([b.period_key, b.slip_count, round3(b.net), round3(b.tax), round3(b.paid)].map(csvCell).join(','));
  }
  rows.push('');
  rows.push(['期间', '供应商', '单据数', '净额', '税额', '实付'].map(csvCell).join(','));
  for (const r of suppliers.results) {
    rows.push([r.period_key, r.name, r.slip_count, round3(r.net), round3(r.tax), round3(r.paid)].map(csvCell).join(','));
  }

  const body = '﻿' + rows.join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="summary-${period}-${normalizeDay(undefined)}.csv"`,
    },
  });
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
    `select s.id as slip_id, s.slip_day, s.supplier_name, s.invoice_no, s.note as slip_note,
            s.net_amount, s.tax_amount, s.gross_amount, s.total_amount,
            l.item_name, l.qty, l.unit, l.unit_price, l.amount, l.note as line_note
     from receiving_slips s
     left join receiving_slip_lines l on l.slip_id = s.id and l.user_id = s.user_id
     where s.settlement_id = ? and s.user_id = ?
     order by s.slip_day, s.id, l.line_no`,
  ).bind(id, c.var.userId).all<{
    slip_id: number;
    slip_day: string;
    supplier_name: string | null;
    invoice_no: string | null;
    slip_note: string | null;
    net_amount: number | null;
    tax_amount: number | null;
    gross_amount: number | null;
    total_amount: number | null;
    item_name: string | null;
    qty: number | null;
    unit: string | null;
    unit_price: number | null;
    amount: number | null;
    line_note: string | null;
  }>();

  // 明细行的金额在欧洲发票上是净额，跟「实付」不是一回事，所以两组数分开列：
  // 前面几列是这一行买了什么，后面三列是这张单整体要付多少（只在每张单的第一行写，
  // 不然一张单有 8 行明细就会把同一个总额重复 8 次，一拉 sum 就翻倍）。
  const header = [
    '日期', '供应商', '单据编号', '货品', '数量', '单位', '单价', '行金额（净）',
    '本单净额', '本单税额', '本单实付', '单据备注', '明细备注',
  ];

  const seenSlip = new Set<number>();
  const lines = results.map((r) => {
    const firstRowOfSlip = !seenSlip.has(r.slip_id);
    seenSlip.add(r.slip_id);
    return [
      r.slip_day,
      r.supplier_name ?? '',
      r.invoice_no ?? '',
      r.item_name ?? '（这张单还没填货品明细）',
      r.qty ?? '',
      r.unit ?? '',
      r.unit_price ?? '',
      r.amount ?? '',
      firstRowOfSlip ? r.net_amount ?? '' : '',
      firstRowOfSlip ? r.tax_amount ?? '' : '',
      firstRowOfSlip ? r.total_amount ?? '' : '',
      r.slip_note ?? '',
      r.line_note ?? '',
    ]
      .map(csvCell)
      .join(',');
  });

  // 会计要的是「这段时间一共付多少」，让他自己在 Excel 里拉 sum 容易拉错列。
  // 每张单只算一次，所以按 slip_id 去重后再加。
  const perSlip = new Map<number, { net: number | null; tax: number | null; paid: number | null }>();
  for (const r of results) {
    if (!perSlip.has(r.slip_id)) perSlip.set(r.slip_id, { net: r.net_amount, tax: r.tax_amount, paid: r.total_amount });
  }
  const sumOf = (pick: (v: { net: number | null; tax: number | null; paid: number | null }) => number | null) =>
    round3([...perSlip.values()].reduce((sum, v) => sum + (pick(v) ?? 0), 0));

  const totalRow = [
    '合计', '', '', `${perSlip.size} 张单`, '', '', '', '',
    sumOf((v) => v.net), sumOf((v) => v.tax), sumOf((v) => v.paid), '', '',
  ]
    .map(csvCell)
    .join(',');

  const body = '﻿' + [header.join(','), ...lines, totalRow].join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="settlement-${settlement.to_day}.csv"`,
    },
  });
});
