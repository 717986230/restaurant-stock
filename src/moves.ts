import { Hono } from 'hono';
import {
  ApiError,
  normalizeDay,
  optionalText,
  requireNumber,
  round3,
  statusOf,
  type AppEnv,
  type MoveKind,
} from './types';
import { loadUsage, reorderPointOf } from './usage';

export const moves = new Hono<AppEnv>();

interface MoveRow {
  id: number;
  item_id: number;
  item_name: string;
  unit: string;
  kind: MoveKind;
  qty: number;
  unit_price: number | null;
  counted_qty: number | null;
  note: string | null;
  operator: string | null;
  day: string;
  created_at: string;
}

function toMoveDto(r: MoveRow) {
  return {
    id: r.id,
    itemId: r.item_id,
    itemName: r.item_name,
    unit: r.unit,
    kind: r.kind,
    qty: round3(r.qty),
    unitPrice: r.unit_price,
    countedQty: r.counted_qty,
    note: r.note,
    operator: r.operator,
    day: r.day,
    createdAt: r.created_at,
  };
}

async function currentStock(db: D1Database, userId: number, itemId: number): Promise<number> {
  const row = await db
    .prepare('select coalesce(sum(qty), 0) as stock from stock_moves where user_id = ? and item_id = ?')
    .bind(userId, itemId)
    .first<{ stock: number }>();
  return round3(row?.stock ?? 0);
}

const MOVE_SELECT = `
  select m.id, m.item_id, i.name as item_name, i.unit, m.kind, m.qty, m.unit_price,
         m.counted_qty, m.note, m.operator, m.day, m.created_at
  from stock_moves m join items i on i.id = m.item_id
`;

moves.get('/', async (c) => {
  const itemId = c.req.query('itemId');
  const day = c.req.query('day');
  const requestedLimit = Number(c.req.query('limit') ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 500) : 100;

  const where: string[] = ['m.user_id = ?'];
  const binds: unknown[] = [c.var.userId];
  if (itemId) {
    where.push('m.item_id = ?');
    binds.push(Number(itemId));
  }
  if (day) {
    where.push('m.day = ?');
    binds.push(day);
  }

  const sql = `${MOVE_SELECT} where ${where.join(' and ')} order by m.id desc limit ?`;
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds, limit)
    .all<MoveRow>();
  return c.json(results.map(toMoveDto));
});

/**
 * 记一笔出入库。
 * IN    入库，qty 存正数；带进价时顺手更新货品的最近进价
 * OUT   出库/领用，qty 存负数
 * CHECK 盘点，前端报"实际数出来多少"，服务端算出差额存进去
 */
moves.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const itemId = requireNumber(body.itemId, '货品', { min: 1 });
  const kind = body.kind as MoveKind;
  if (kind !== 'IN' && kind !== 'OUT' && kind !== 'CHECK') throw new ApiError(400, '未知的操作类型');

  const item = await c.env.DB.prepare(
    'select id, name, unit, min_stock, lead_time_days from items where id = ? and user_id = ? and archived = 0',
  )
    .bind(itemId, c.var.userId)
    .first<{ id: number; name: string; unit: string; min_stock: number; lead_time_days: number }>();
  if (!item) throw new ApiError(404, '货品不存在');

  // 状态要跟库存列表用同一把尺子：那边标红用的是按消耗算出来的再订货点，
  // 这里直接拿 min_stock 判的话，同一件货在弹窗里显示"正常"、回到列表却是红的。
  const usage = await loadUsage(c.env.DB, c.var.userId);
  const { point: reorderPoint } = reorderPointOf(usage.get(itemId), item.lead_time_days, item.min_stock);

  const day = normalizeDay(body.day);
  const note = optionalText(body.note, 255);
  const operator = optionalText(body.operator, 40);
  const requestId = optionalText(body.requestId, 80);
  const referenceNo = optionalText(body.referenceNo, 80);

  if (requestId) {
    const duplicate = await c.env.DB.prepare(
      'select id from stock_moves where user_id = ? and request_id = ?',
    ).bind(c.var.userId, requestId).first<{ id: number }>();
    if (duplicate) {
      const stock = await currentStock(c.env.DB, c.var.userId, itemId);
      return c.json({
        ok: true,
        duplicate: true,
        itemName: item.name,
        unit: item.unit,
        stock,
        status: statusOf(stock, reorderPoint),
      });
    }
  }

  let qty: number;
  let unitPrice: number | null = null;
  let countedQty: number | null = null;

  if (kind === 'CHECK') {
    countedQty = requireNumber(body.countedQty, '实际数量', { min: 0 });
    qty = round3(countedQty - (await currentStock(c.env.DB, c.var.userId, itemId)));
  } else {
    const raw = requireNumber(body.qty, '数量', { min: 0.001 });
    qty = kind === 'IN' ? round3(raw) : round3(-raw);
    if (kind === 'IN' && body.unitPrice !== undefined && body.unitPrice !== null && body.unitPrice !== '') {
      unitPrice = requireNumber(body.unitPrice, '进价', { min: 0 });
    }
  }

  const statements = [
    c.env.DB.prepare(
      `insert into stock_moves
         (user_id, item_id, kind, qty, unit_price, counted_qty, note, operator, day,
          request_id, reference_no, location_id, supplier_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               (select default_location_id from items where id = ? and user_id = ?),
               (select default_supplier_id from items where id = ? and user_id = ?))`,
    ).bind(
      c.var.userId, itemId, kind, qty, unitPrice, countedQty, note, operator, day,
      requestId, referenceNo, itemId, c.var.userId, itemId, c.var.userId,
    ),
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary, metadata_json)
       values (?, 'stock_move', null, ?, ?, json_object('itemId', ?, 'qty', ?, 'day', ?))`,
    ).bind(c.var.userId, kind, item.name, itemId, qty, day),
  ];
  if (unitPrice !== null) {
    statements.push(
      c.env.DB.prepare("update items set last_price = ?, updated_at = datetime('now') where id = ? and user_id = ?")
        .bind(unitPrice, itemId, c.var.userId),
    );
  }
  await c.env.DB.batch(statements);

  const stock = await currentStock(c.env.DB, c.var.userId, itemId);
  return c.json(
    {
      ok: true,
      itemName: item.name,
      unit: item.unit,
      stock,
      status: statusOf(stock, reorderPoint),
    },
    201,
  );
});

/** 撤销误操作。流水删掉后结存自动回到删之前的样子，不需要再补一笔冲销。 */
moves.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const move = await c.env.DB.prepare(
    `select m.item_id, m.kind, m.qty, m.day, i.name as item_name
     from stock_moves m join items i on i.id = m.item_id
     where m.id = ? and m.user_id = ?`,
  ).bind(id, c.var.userId).first<{ item_id: number; kind: MoveKind; qty: number; day: string; item_name: string }>();
  if (!move) throw new ApiError(404, '这条记录不存在');
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare('delete from stock_moves where id = ? and user_id = ?').bind(id, c.var.userId),
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary, metadata_json)
       values (?, 'stock_move', ?, 'DELETE', ?, json_object('itemId', ?, 'kind', ?, 'qty', ?, 'day', ?))`,
    ).bind(c.var.userId, id, move.item_name, move.item_id, move.kind, move.qty, move.day),
  ]);
  if (res.meta.changes === 0) throw new ApiError(404, '这条记录不存在');
  return c.json({ ok: true });
});

/** 一次盘点最多提交这么多项。48 项的店离上限还远，留着是防止有人构造超大请求。 */
const MAX_STOCKTAKE_ITEMS = 500;

/**
 * 整场盘点一次提交。
 *
 * 之前是每盘一项发一个请求：48 项就是 48 次往返，后厨的手机信号一断就会盘到一半。
 * 而"盘到一半"比"没盘"更糟——日均消耗是拿两次盘点当锚点算的，
 * 半场盘点会让一部分货品的锚点停在旧日期上，推出来的消耗速度直接失真。
 *
 * 现在整场放进一个 D1 batch，同一个事务里要么全进要么全不进。
 */
moves.post('/stocktake', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const rows = body.items;
  if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, '还没有填任何实际数量');
  if (rows.length > MAX_STOCKTAKE_ITEMS) throw new ApiError(400, `一次最多提交 ${MAX_STOCKTAKE_ITEMS} 项`);

  const day = normalizeDay(body.day);
  const note = optionalText(body.note, 255) ?? '盘点';
  const operator = optionalText(body.operator, 40);
  const requestId = optionalText(body.requestId, 60);

  // 同一件货品填两次会让后一次的差额基于错误的账面数，直接拒掉而不是猜哪次算数
  const counted = new Map<number, number>();
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const itemId = requireNumber(r.itemId, '货品', { min: 1 });
    const qty = requireNumber(r.countedQty, '实际数量', { min: 0 });
    if (counted.has(itemId)) throw new ApiError(400, '同一件货品重复提交了两次');
    counted.set(itemId, qty);
  }

  const ids = [...counted.keys()];

  // 手机上点了提交没等到响应就重试，或者手抖点两下，不该把一整场盘点记两遍。
  // 每行用「本场 id:货品 id」做键，落在 stock_moves 已有的唯一索引上。
  if (requestId) {
    const dup = await c.env.DB.prepare(
      'select id from stock_moves where user_id = ? and request_id = ?',
    ).bind(c.var.userId, `${requestId}:${ids[0]}`).first<{ id: number }>();
    if (dup) throw new ApiError(409, '这场盘点已经提交过了');
  }

  const placeholders = ids.map(() => '?').join(',');

  // 一次问清楚：这些货品是不是都属于当前用户，以及各自现在的账面数
  const { results } = await c.env.DB.prepare(
    `select i.id, i.name, i.unit, i.min_stock, i.lead_time_days,
            coalesce((select sum(m.qty) from stock_moves m where m.item_id = i.id), 0) as stock
     from items i
     where i.user_id = ? and i.archived = 0 and i.id in (${placeholders})`,
  )
    .bind(c.var.userId, ...ids)
    .all<{ id: number; name: string; unit: string; min_stock: number; lead_time_days: number; stock: number }>();

  if (results.length !== ids.length) throw new ApiError(404, '有货品已经被下架或不存在，请刷新后重试');

  const statements = [];
  let changed = 0;
  for (const item of results) {
    const actual = counted.get(item.id)!;
    const delta = round3(actual - round3(item.stock ?? 0));
    if (Math.abs(delta) > 0.0005) changed++;
    statements.push(
      c.env.DB.prepare(
        `insert into stock_moves (user_id, item_id, kind, qty, counted_qty, note, operator, day, request_id)
         values (?, ?, 'CHECK', ?, ?, ?, ?, ?, ?)`,
      ).bind(c.var.userId, item.id, delta, actual, note, operator, day, requestId ? `${requestId}:${item.id}` : null),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary)
       values (?, 'stocktake', null, 'CHECK', ?)`,
    ).bind(c.var.userId, `盘点 ${results.length} 项，其中 ${changed} 项与账面不符`),
  );

  await c.env.DB.batch(statements);

  return c.json(
    {
      ok: true,
      day,
      counted: results.length,
      changed,
      items: results.map((item) => {
        const stock = counted.get(item.id)!;
        return { id: item.id, name: item.name, unit: item.unit, stock };
      }),
    },
    201,
  );
});
