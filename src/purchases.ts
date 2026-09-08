import { Hono } from 'hono';
import {
  ApiError,
  normalizeDay,
  optionalDay,
  optionalText,
  requireNumber,
  round3,
  type AppEnv,
} from './types';

export const purchases = new Hono<AppEnv>();

type PurchaseStatus = 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

interface PurchaseOrderRow {
  id: number;
  supplier_id: number | null;
  supplier_name: string | null;
  order_no: string | null;
  status: PurchaseStatus;
  ordered_day: string | null;
  expected_day: string | null;
  received_day: string | null;
  note: string | null;
  created_at: string;
  line_count: number;
  ordered_total: number;
  received_total: number;
}

function toPurchaseOrderDto(r: PurchaseOrderRow) {
  return {
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    orderNo: r.order_no,
    status: r.status,
    orderedDay: r.ordered_day,
    expectedDay: r.expected_day,
    receivedDay: r.received_day,
    note: r.note,
    createdAt: r.created_at,
    lineCount: r.line_count,
    orderedTotal: round3(r.ordered_total),
    receivedTotal: round3(r.received_total),
  };
}

interface PurchaseLineRow {
  id: number;
  item_id: number;
  item_name: string;
  unit: string;
  pack_size: number | null;
  pack_unit: string | null;
  ordered_qty: number;
  received_qty: number;
  unit_price: number | null;
  note: string | null;
}

function toPurchaseLineDto(r: PurchaseLineRow) {
  return {
    id: r.id,
    itemId: r.item_id,
    itemName: r.item_name,
    unit: r.unit,
    packSize: r.pack_size,
    packUnit: r.pack_unit,
    orderedQty: round3(r.ordered_qty),
    receivedQty: round3(r.received_qty),
    remainingQty: round3(Math.max(0, r.ordered_qty - r.received_qty)),
    unitPrice: r.unit_price,
    note: r.note,
  };
}

const ORDER_SELECT = `
  select po.id, po.supplier_id, s.name as supplier_name, po.order_no, po.status,
         po.ordered_day, po.expected_day, po.received_day, po.note, po.created_at,
         (select count(*) from purchase_order_lines l where l.purchase_order_id = po.id) as line_count,
         (select coalesce(sum(l.ordered_qty), 0) from purchase_order_lines l where l.purchase_order_id = po.id) as ordered_total,
         (select coalesce(sum(l.received_qty), 0) from purchase_order_lines l where l.purchase_order_id = po.id) as received_total
  from purchase_orders po
  left join suppliers s on s.id = po.supplier_id and s.user_id = po.user_id
`;

purchases.get('/', async (c) => {
  const status = c.req.query('status')?.trim();
  const where = ['po.user_id = ?'];
  const binds: unknown[] = [c.var.userId];
  if (status) {
    where.push('po.status = ?');
    binds.push(status);
  }
  const sql = `${ORDER_SELECT} where ${where.join(' and ')} order by po.created_at desc, po.id desc limit 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<PurchaseOrderRow>();
  return c.json(results.map(toPurchaseOrderDto));
});

purchases.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [po, linesRes] = await Promise.all([
    c.env.DB.prepare(`${ORDER_SELECT} where po.id = ? and po.user_id = ?`).bind(id, c.var.userId).first<PurchaseOrderRow>(),
    c.env.DB.prepare(
      `select l.id, l.item_id, i.name as item_name, i.unit, i.pack_size, i.pack_unit,
              l.ordered_qty, l.received_qty, l.unit_price, l.note
       from purchase_order_lines l join items i on i.id = l.item_id
       where l.purchase_order_id = ? and l.user_id = ?
       order by l.id`,
    ).bind(id, c.var.userId).all<PurchaseLineRow>(),
  ]);
  if (!po) throw new ApiError(404, '采购单不存在');
  return c.json({ ...toPurchaseOrderDto(po), lines: linesRes.results.map(toPurchaseLineDto) });
});

const MAX_LINES = 200;

/** 新建采购单：先记「订了什么」，到货时再逐项对货记账，两件事分开做不会互相卡住。 */
purchases.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const supplierId =
    body.supplierId === undefined || body.supplierId === null || body.supplierId === ''
      ? null
      : requireNumber(body.supplierId, '供应商', { min: 1 });
  const orderNo = optionalText(body.orderNo, 40);
  const expectedDay = optionalDay(body.expectedDay);
  const note = optionalText(body.note, 255);

  const rawLines = body.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new ApiError(400, '请至少添加一项货品');
  if (rawLines.length > MAX_LINES) throw new ApiError(400, `一次最多添加 ${MAX_LINES} 项`);

  if (supplierId) {
    const supplier = await c.env.DB.prepare('select id from suppliers where id = ? and user_id = ? and archived = 0')
      .bind(supplierId, c.var.userId)
      .first<{ id: number }>();
    if (!supplier) throw new ApiError(404, '供应商不存在');
  }

  const lines: { itemId: number; orderedQty: number; unitPrice: number | null; note: string | null }[] = [];
  const seen = new Set<number>();
  for (const raw of rawLines) {
    const r = raw as Record<string, unknown>;
    const itemId = requireNumber(r.itemId, '货品', { min: 1 });
    if (seen.has(itemId)) throw new ApiError(400, '同一件货品重复添加了');
    seen.add(itemId);
    const orderedQty = requireNumber(r.orderedQty, '订购数量', { min: 0.001 });
    const unitPrice =
      r.unitPrice === undefined || r.unitPrice === null || r.unitPrice === ''
        ? null
        : requireNumber(r.unitPrice, '单价', { min: 0 });
    lines.push({ itemId, orderedQty, unitPrice, note: optionalText(r.note, 120) });
  }

  const ids = [...seen];
  const placeholders = ids.map(() => '?').join(',');
  const { results: owned } = await c.env.DB.prepare(
    `select id from items where user_id = ? and archived = 0 and id in (${placeholders})`,
  ).bind(c.var.userId, ...ids).all<{ id: number }>();
  if (owned.length !== ids.length) throw new ApiError(404, '有货品不存在或已下架，请刷新后重试');

  const orderedDay = normalizeDay(undefined);
  const poInsert = await c.env.DB.prepare(
    `insert into purchase_orders (user_id, supplier_id, order_no, status, ordered_day, expected_day, note)
     values (?, ?, ?, 'ORDERED', ?, ?, ?)`,
  ).bind(c.var.userId, supplierId, orderNo, orderedDay, expectedDay, note).run();
  const poId = Number(poInsert.meta.last_row_id);

  const statements = lines.map((l) =>
    c.env.DB.prepare(
      `insert into purchase_order_lines (user_id, purchase_order_id, item_id, ordered_qty, unit_price, note)
       values (?, ?, ?, ?, ?, ?)`,
    ).bind(c.var.userId, poId, l.itemId, l.orderedQty, l.unitPrice, l.note),
  );
  statements.push(
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary)
       values (?, 'purchase_order', ?, 'CREATE', ?)`,
    ).bind(c.var.userId, poId, `新建采购单，共 ${lines.length} 项`),
  );
  await c.env.DB.batch(statements);

  return c.json({ id: poId }, 201);
});

/** 改预计到货日 / 备注，或者取消整张单。收过货的单不能再取消，账已经落地了。 */
purchases.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();
  const own = await c.env.DB.prepare('select status from purchase_orders where id = ? and user_id = ?')
    .bind(id, c.var.userId)
    .first<{ status: PurchaseStatus }>();
  if (!own) throw new ApiError(404, '采购单不存在');

  if (body.status === 'CANCELLED') {
    if (own.status === 'PARTIAL' || own.status === 'RECEIVED') {
      throw new ApiError(400, '已经对货入库过的采购单不能取消');
    }
    if (own.status === 'CANCELLED') return c.json({ ok: true });
    await c.env.DB.batch([
      c.env.DB.prepare(`update purchase_orders set status = 'CANCELLED', updated_at = datetime('now') where id = ? and user_id = ?`).bind(
        id,
        c.var.userId,
      ),
      c.env.DB.prepare(
        `insert into audit_events (user_id, entity_type, entity_id, action, summary)
         values (?, 'purchase_order', ?, 'CANCEL', '取消采购单')`,
      ).bind(c.var.userId, id),
    ]);
    return c.json({ ok: true });
  }

  const expectedDay = optionalDay(body.expectedDay);
  const note = optionalText(body.note, 255);
  const res = await c.env.DB.prepare(
    `update purchase_orders set expected_day = ?, note = ?, updated_at = datetime('now') where id = ? and user_id = ?`,
  ).bind(expectedDay, note, id, c.var.userId).run();
  if (res.meta.changes === 0) throw new ApiError(404, '采购单不存在');
  return c.json({ ok: true });
});

/**
 * 对货记账：供应商送货来了，逐项核对实收数量和订购数量的差异，确认后一次性
 * 记入库存流水（kind=IN）、累加采购明细的已收数量，并按「是不是全部到齐」把
 * 采购单状态推进到部分到货或已完成。
 *
 * 一张单可以分几趟送货、分几次提交——每次只对当次实际到手的数量记账，
 * 已收数量是累加的，不会因为后收的一趟把前面记过的账冲掉。
 */
purchases.post('/:id/receive', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const rawLines = body.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new ApiError(400, '还没有填任何实收数量');
  if (rawLines.length > MAX_LINES) throw new ApiError(400, `一次最多提交 ${MAX_LINES} 项`);

  const day = normalizeDay(body.day);
  const operator = optionalText(body.operator, 40);
  const requestId = optionalText(body.requestId, 60);

  const po = await c.env.DB.prepare(
    `select id, supplier_id, order_no, status from purchase_orders where id = ? and user_id = ?`,
  ).bind(id, c.var.userId).first<{ id: number; supplier_id: number | null; order_no: string | null; status: PurchaseStatus }>();
  if (!po) throw new ApiError(404, '采购单不存在');
  if (po.status === 'CANCELLED') throw new ApiError(400, '这张采购单已经取消了');
  if (po.status === 'RECEIVED') throw new ApiError(400, '这张采购单已经全部到货了');

  // 同一项填两次会让第二次的累加基于错误的中间态，直接拒掉而不是猜哪次算数
  const received = new Map<number, number>();
  for (const raw of rawLines) {
    const r = raw as Record<string, unknown>;
    const lineId = requireNumber(r.lineId, '采购明细', { min: 1 });
    const qty = requireNumber(r.receivedQty, '实收数量', { min: 0.001 });
    if (received.has(lineId)) throw new ApiError(400, '同一项重复提交了两次');
    received.set(lineId, qty);
  }

  const lineIds = [...received.keys()];
  const placeholders = lineIds.map(() => '?').join(',');
  const { results: lines } = await c.env.DB.prepare(
    `select l.id, l.item_id, i.name as item_name, i.unit, l.ordered_qty, l.received_qty, l.unit_price
     from purchase_order_lines l join items i on i.id = l.item_id
     where l.purchase_order_id = ? and l.user_id = ? and l.id in (${placeholders})`,
  ).bind(id, c.var.userId, ...lineIds).all<{
    id: number;
    item_id: number;
    item_name: string;
    unit: string;
    ordered_qty: number;
    received_qty: number;
    unit_price: number | null;
  }>();
  if (lines.length !== lineIds.length) throw new ApiError(404, '有采购明细不存在，请刷新后重试');

  // 手机上点了提交没等到响应就重试，或者手抖点两下，不该把同一趟收货记两遍
  if (requestId) {
    const dup = await c.env.DB.prepare(
      'select id from stock_moves where user_id = ? and request_id = ?',
    ).bind(c.var.userId, `${requestId}:${lineIds[0]}`).first<{ id: number }>();
    if (dup) throw new ApiError(409, '这趟收货已经提交过了');
  }

  const referenceNo = po.order_no ? `采购单 ${po.order_no}` : `采购单 #${po.id}`;
  const statements = [];
  let overCount = 0;
  for (const line of lines) {
    const qty = round3(received.get(line.id)!);
    const remaining = round3(line.ordered_qty - line.received_qty);
    if (qty - remaining > 0.0005) overCount++;
    statements.push(
      c.env.DB.prepare(
        `insert into stock_moves
           (user_id, item_id, kind, qty, unit_price, note, operator, day, request_id, reference_no, supplier_id, location_id)
         values (?, ?, 'IN', ?, ?, '对货入库', ?, ?, ?, ?, ?,
                 (select default_location_id from items where id = ? and user_id = ?))`,
      ).bind(
        c.var.userId, line.item_id, qty, line.unit_price, operator, day,
        requestId ? `${requestId}:${line.id}` : null, referenceNo, po.supplier_id,
        line.item_id, c.var.userId,
      ),
    );
    statements.push(
      c.env.DB.prepare(
        `update purchase_order_lines set received_qty = received_qty + ?, updated_at = datetime('now')
         where id = ? and user_id = ?`,
      ).bind(qty, line.id, c.var.userId),
    );
  }
  await c.env.DB.batch(statements);

  const totals = await c.env.DB.prepare(
    `select coalesce(sum(ordered_qty), 0) as ordered, coalesce(sum(received_qty), 0) as received
     from purchase_order_lines where purchase_order_id = ? and user_id = ?`,
  ).bind(id, c.var.userId).first<{ ordered: number; received: number }>();

  const fullyReceived = round3((totals?.received ?? 0) - (totals?.ordered ?? 0)) >= -0.0005;
  const newStatus: PurchaseStatus = fullyReceived ? 'RECEIVED' : 'PARTIAL';
  await c.env.DB.batch([
    c.env.DB.prepare(
      `update purchase_orders set status = ?, received_day = case when ? = 1 then ? else received_day end, updated_at = datetime('now')
       where id = ? and user_id = ?`,
    ).bind(newStatus, fullyReceived ? 1 : 0, day, id, c.var.userId),
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary)
       values (?, 'purchase_order', ?, 'RECEIVE', ?)`,
    ).bind(c.var.userId, id, `对货入库 ${lines.length} 项${fullyReceived ? '，已全部到货' : '，部分到货'}`),
  ]);

  return c.json(
    {
      ok: true,
      status: newStatus,
      over: overCount > 0,
      items: lines.map((line) => ({
        id: line.item_id,
        name: line.item_name,
        unit: line.unit,
        receivedQty: round3(received.get(line.id)!),
      })),
    },
    201,
  );
});
