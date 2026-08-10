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
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);

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

  const item = await c.env.DB.prepare('select id, name, unit, min_stock from items where id = ? and user_id = ? and archived = 0')
    .bind(itemId, c.var.userId)
    .first<{ id: number; name: string; unit: string; min_stock: number }>();
  if (!item) throw new ApiError(404, '货品不存在');

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
        status: statusOf(stock, item.min_stock),
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
      status: statusOf(stock, item.min_stock),
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
