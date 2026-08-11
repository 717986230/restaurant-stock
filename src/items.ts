import { Hono } from 'hono';
import {
  ApiError,
  optionalText,
  requireNumber,
  requireText,
  toItemDto,
  type AppEnv,
  type ItemRow,
} from './types';
import { DEFAULT_LEAD_TIME_DAYS, loadUsage } from './usage';

export const items = new Hono<AppEnv>();

const ITEM_SELECT = `
  select i.id, i.name, i.category, i.unit, i.pack_size, i.pack_unit,
         i.min_stock, i.weekly_target, i.lead_time_days, i.last_price, i.has_image, i.note,
         (select l.name from storage_locations l where l.id = i.default_location_id and l.user_id = i.user_id) as location_name,
         coalesce((select sum(m.qty) from stock_moves m where m.item_id = i.id), 0) as stock
  from items i
`;

/** 整箱规格：两个字段要么都填，要么都不填，半套配置会让前端换算算不出来 */
function readPack(body: Record<string, unknown>): { size: number | null; unit: string | null } {
  const rawSize = body.packSize;
  if (rawSize === undefined || rawSize === null || rawSize === '') return { size: null, unit: null };
  const size = requireNumber(rawSize, '每箱数量', { min: 0.001 });
  return { size, unit: optionalText(body.packUnit, 16) ?? '箱' };
}

/** 输入新仓位名时就地创建；唯一键保证同一账号不会出现两个同名仓位。 */
async function ensureLocation(db: D1Database, userId: number, rawName: unknown): Promise<number> {
  const name = optionalText(rawName, 40) ?? '主仓';
  await db.prepare(
    `insert into storage_locations (user_id, name, note)
     values (?, ?, null)
     on conflict (user_id, name) do update set archived = 0, updated_at = datetime('now')`,
  ).bind(userId, name).run();
  const row = await db.prepare(
    'select id from storage_locations where user_id = ? and name = ? and archived = 0',
  ).bind(userId, name).first<{ id: number }>();
  if (!row) throw new ApiError(500, '保存货品位置失败');
  return row.id;
}

/** 列表：支持关键字、分类筛选，以及"只看告警"。告警判断依赖结存，只能在取出后过滤。 */
items.get('/', async (c) => {
  const q = c.req.query('q')?.trim();
  const category = c.req.query('category')?.trim();
  const onlyLow = c.req.query('low') === '1';

  const where: string[] = ['i.user_id = ?', 'i.archived = 0'];
  const binds: unknown[] = [c.var.userId];
  if (q) {
    where.push('i.name like ?');
    binds.push(`%${q}%`);
  }
  if (category) {
    where.push('i.category = ?');
    binds.push(category);
  }

  const sql = `${ITEM_SELECT} where ${where.join(' and ')} order by i.category, i.name`;
  const [{ results }, usage] = await Promise.all([
    c.env.DB.prepare(sql).bind(...binds).all<ItemRow>(),
    loadUsage(c.env.DB, c.var.userId),
  ]);

  let list = results.map((row) => toItemDto(row, usage.get(row.id)));
  if (onlyLow) list = list.filter((it) => it.status !== 'OK');
  return c.json(list);
});

items.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'select distinct category from items where user_id = ? and archived = 0 order by category',
  )
    .bind(c.var.userId)
    .all<{ category: string }>();
  return c.json(results.map((r) => r.category));
});

items.get('/locations', async (c) => {
  const { results } = await c.env.DB.prepare(
    'select name from storage_locations where user_id = ? and archived = 0 order by name',
  ).bind(c.var.userId).all<{ name: string }>();
  return c.json(results.map((row) => row.name));
});

/** 批量下架：库存流水和图片仍保留，重新添加同名货品时可以恢复。 */
items.post('/bulk-archive', async (c) => {
  const body: { ids?: unknown } = await c.req.json<{ ids?: unknown }>().catch(() => ({}));
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    throw new ApiError(400, '请至少选择一个货品');
  }
  if (body.ids.length > 100) throw new ApiError(400, '一次最多下架 100 个货品');

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const raw of body.ids) {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
      throw new ApiError(400, '货品编号格式不正确');
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      ids.push(raw);
    }
  }

  const placeholders = ids.map(() => '?').join(',');
  const binds = [c.var.userId, ...ids];
  const [, archived] = await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary)
       select user_id, 'item', id, 'ARCHIVE', name
       from items where user_id = ? and archived = 0 and id in (${placeholders})`,
    ).bind(...binds),
    c.env.DB.prepare(
      `update items set archived = 1, archived_at = datetime('now'), updated_at = datetime('now')
       where user_id = ? and archived = 0 and id in (${placeholders})`,
    ).bind(...binds),
  ]);

  const count = archived.meta.changes ?? 0;
  return c.json({ ok: true, archived: count, skipped: ids.length - count });
});

items.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [row, usage] = await Promise.all([
    c.env.DB.prepare(`${ITEM_SELECT} where i.id = ? and i.user_id = ?`).bind(id, c.var.userId).first<ItemRow>(),
    loadUsage(c.env.DB, c.var.userId),
  ]);
  if (!row) throw new ApiError(404, '货品不存在');
  return c.json(toItemDto(row, usage.get(row.id)));
});

items.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const name = requireText(body.name, '货品名称', 80);
  const category = optionalText(body.category, 40) ?? '其他';
  const unit = optionalText(body.unit, 16) ?? '箱';
  const minStock = body.minStock === undefined ? 0 : requireNumber(body.minStock, '低库存阈值', { min: 0 });
  // 旧版客户端还没有 weeklyTarget；沿用旧算法作为初始值，避免升级后清单突然为空。
  const weeklyTarget = body.weeklyTarget === undefined
    ? minStock * 2
    : requireNumber(body.weeklyTarget, '每周计划库存', { min: 0 });
  const leadTimeDays = body.leadTimeDays === undefined
    ? DEFAULT_LEAD_TIME_DAYS
    : requireNumber(body.leadTimeDays, '送货天数', { min: 0, max: 60 });
  const note = optionalText(body.note, 255);
  const pack = readPack(body);

  const existing = await c.env.DB.prepare('select id, archived from items where user_id = ? and name = ?')
    .bind(c.var.userId, name)
    .first<{ id: number; archived: number }>();
  if (existing) {
    if (existing.archived === 0) throw new ApiError(409, `「${name}」已经存在了`);
    const locationId = await ensureLocation(c.env.DB, c.var.userId, body.locationName);
    // 之前删掉过同名货品：复用这条记录，历史流水也就跟着回来了
    await c.env.DB.batch([
      c.env.DB.prepare(
      `update items set archived = 0, category = ?, unit = ?, pack_size = ?, pack_unit = ?,
                        min_stock = ?, weekly_target = ?, lead_time_days = ?, default_location_id = ?, note = ?,
                        archived_at = null, updated_at = datetime('now')
        where id = ? and user_id = ?`,
      ).bind(category, unit, pack.size, pack.unit, minStock, weeklyTarget, leadTimeDays, locationId, note, existing.id, c.var.userId),
      c.env.DB.prepare(
        `insert into audit_events (user_id, entity_type, entity_id, action, summary)
         values (?, 'item', ?, 'RESTORE', ?)`,
      ).bind(c.var.userId, existing.id, name),
    ]);
    return c.json({ id: existing.id, restored: true }, 201);
  }

  const locationId = await ensureLocation(c.env.DB, c.var.userId, body.locationName);
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into items
         (user_id, name, category, unit, pack_size, pack_unit, min_stock, weekly_target, lead_time_days, note, default_location_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(c.var.userId, name, category, unit, pack.size, pack.unit, minStock, weeklyTarget, leadTimeDays, note, locationId),
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary)
       select ?, 'item', id, 'CREATE', ? from items where user_id = ? and name = ?`,
    ).bind(c.var.userId, name, c.var.userId, name),
  ]);
  const id = Number(res.meta.last_row_id);
  return c.json({ id, restored: false }, 201);
});

items.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();
  const name = requireText(body.name, '货品名称', 80);
  const category = optionalText(body.category, 40) ?? '其他';
  const unit = optionalText(body.unit, 16) ?? '箱';
  const minStock = requireNumber(body.minStock ?? 0, '低库存阈值', { min: 0 });
  // null 只用于 SQL 的“保持原值”；显式提交 0 仍表示从补货计划中移除。
  const weeklyTarget = body.weeklyTarget === undefined
    ? null
    : requireNumber(body.weeklyTarget, '每周计划库存', { min: 0 });
  const leadTimeDays = body.leadTimeDays === undefined
    ? null
    : requireNumber(body.leadTimeDays, '送货天数', { min: 0, max: 60 });
  const note = optionalText(body.note, 255);
  const pack = readPack(body);

  const [clash, own] = await Promise.all([
    c.env.DB.prepare('select id from items where user_id = ? and name = ? and id <> ?')
      .bind(c.var.userId, name, id).first<{ id: number }>(),
    c.env.DB.prepare('select id from items where id = ? and user_id = ? and archived = 0')
      .bind(id, c.var.userId).first<{ id: number }>(),
  ]);
  if (clash) throw new ApiError(409, `「${name}」已经存在了`);
  if (!own) throw new ApiError(404, '货品不存在');
  const locationId = body.locationName === undefined
    ? null
    : await ensureLocation(c.env.DB, c.var.userId, body.locationName);

  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(
      `update items set name = ?, category = ?, unit = ?, pack_size = ?, pack_unit = ?,
                        min_stock = ?, weekly_target = coalesce(?, weekly_target),
                        lead_time_days = coalesce(?, lead_time_days),
                        default_location_id = coalesce(?, default_location_id), note = ?, updated_at = datetime('now')
       where id = ? and user_id = ? and archived = 0`,
    ).bind(name, category, unit, pack.size, pack.unit, minStock, weeklyTarget, leadTimeDays, locationId, note, id, c.var.userId),
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary)
       select ?, 'item', id, 'UPDATE', ? from items where id = ? and user_id = ? and archived = 0`,
    ).bind(c.var.userId, name, id, c.var.userId),
  ]);
  if (res.meta.changes === 0) throw new ApiError(404, '货品不存在');
  return c.json({ ok: true });
});

/** 软删除：流水是账，不能因为下架一个货品就凭空消失 */
items.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const item = await c.env.DB.prepare('select name from items where id = ? and user_id = ? and archived = 0')
    .bind(id, c.var.userId)
    .first<{ name: string }>();
  if (!item) throw new ApiError(404, '货品不存在');
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(
      "update items set archived = 1, archived_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?",
    ).bind(id, c.var.userId),
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary)
       values (?, 'item', ?, 'ARCHIVE', ?)`,
    ).bind(c.var.userId, id, item.name),
  ]);
  if (res.meta.changes === 0) throw new ApiError(404, '货品不存在');
  return c.json({ ok: true });
});

items.get('/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    `select im.mime, im.bytes, im.updated_at from item_images im
     join items i on i.id = im.item_id
     where im.item_id = ? and i.user_id = ?`,
  )
    .bind(id, c.var.userId)
    .first<{ mime: string; bytes: ArrayBuffer | number[]; updated_at: string }>();
  if (!row) throw new ApiError(404, '还没有图片');

  const body = row.bytes instanceof ArrayBuffer ? row.bytes : new Uint8Array(row.bytes as number[]);
  return new Response(body, {
    headers: {
      'content-type': row.mime,
      // 换图后前端请求的 URL 会带上新的 t 参数，所以这里可以放心长缓存
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
});

const MAX_IMAGE_BYTES = 1_500_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

items.post('/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  const item = await c.env.DB.prepare('select id from items where id = ? and user_id = ? and archived = 0')
    .bind(id, c.var.userId)
    .first<{ id: number }>();
  if (!item) throw new ApiError(404, '货品不存在');

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, '没有收到图片文件');
  if (!IMAGE_TYPES.has(file.type)) throw new ApiError(400, '只支持 JPG、PNG 或 WebP 图片');
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, '图片太大了，请重新拍一张');

  const bytes = await file.arrayBuffer();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into item_images (item_id, mime, bytes, updated_at) values (?, ?, ?, datetime('now'))
       on conflict (item_id) do update set mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at`,
    ).bind(id, file.type, bytes),
    c.env.DB.prepare("update items set has_image = 1, updated_at = datetime('now') where id = ? and user_id = ?").bind(id, c.var.userId),
  ]);

  return c.json({ ok: true, url: `/api/items/${id}/image?t=${Date.now()}` });
});

items.delete('/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  const own = await c.env.DB.prepare('select id from items where id = ? and user_id = ?')
    .bind(id, c.var.userId)
    .first<{ id: number }>();
  if (!own) throw new ApiError(404, '货品不存在');
  await c.env.DB.batch([
    c.env.DB.prepare('delete from item_images where item_id = ?').bind(id),
    c.env.DB.prepare("update items set has_image = 0, updated_at = datetime('now') where id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});
