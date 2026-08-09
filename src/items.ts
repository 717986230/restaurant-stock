import { Hono } from 'hono';
import {
  ApiError,
  optionalText,
  requireNumber,
  requireText,
  toItemDto,
  type Env,
  type ItemRow,
} from './types';

export const items = new Hono<{ Bindings: Env }>();

const ITEM_SELECT = `
  select i.id, i.name, i.category, i.unit, i.min_stock, i.last_price, i.has_image, i.note,
         coalesce((select sum(m.qty) from stock_moves m where m.item_id = i.id), 0) as stock
  from items i
`;

/** 列表：支持关键字、分类筛选，以及"只看告警"。告警判断依赖结存，只能在取出后过滤。 */
items.get('/', async (c) => {
  const q = c.req.query('q')?.trim();
  const category = c.req.query('category')?.trim();
  const onlyLow = c.req.query('low') === '1';

  const where: string[] = ['i.archived = 0'];
  const binds: unknown[] = [];
  if (q) {
    where.push('i.name like ?');
    binds.push(`%${q}%`);
  }
  if (category) {
    where.push('i.category = ?');
    binds.push(category);
  }

  const sql = `${ITEM_SELECT} where ${where.join(' and ')} order by i.category, i.name`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<ItemRow>();

  let list = results.map(toItemDto);
  if (onlyLow) list = list.filter((it) => it.status !== 'OK');
  return c.json(list);
});

items.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'select distinct category from items where archived = 0 order by category',
  ).all<{ category: string }>();
  return c.json(results.map((r) => r.category));
});

items.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(`${ITEM_SELECT} where i.id = ?`).bind(id).first<ItemRow>();
  if (!row) throw new ApiError(404, '货品不存在');
  return c.json(toItemDto(row));
});

items.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const name = requireText(body.name, '货品名称', 80);
  const category = optionalText(body.category, 40) ?? '其他';
  const unit = optionalText(body.unit, 16) ?? '斤';
  const minStock = body.minStock === undefined ? 0 : requireNumber(body.minStock, '低库存阈值', { min: 0 });
  const note = optionalText(body.note, 255);

  const existing = await c.env.DB.prepare('select id, archived from items where name = ?')
    .bind(name)
    .first<{ id: number; archived: number }>();
  if (existing) {
    if (existing.archived === 0) throw new ApiError(409, `「${name}」已经存在了`);
    // 之前删掉过同名货品：复用这条记录，历史流水也就跟着回来了
    await c.env.DB.prepare(
      'update items set archived = 0, category = ?, unit = ?, min_stock = ?, note = ? where id = ?',
    )
      .bind(category, unit, minStock, note, existing.id)
      .run();
    return c.json({ id: existing.id, restored: true }, 201);
  }

  const res = await c.env.DB.prepare(
    'insert into items (name, category, unit, min_stock, note) values (?, ?, ?, ?, ?)',
  )
    .bind(name, category, unit, minStock, note)
    .run();
  return c.json({ id: res.meta.last_row_id, restored: false }, 201);
});

items.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();
  const name = requireText(body.name, '货品名称', 80);
  const category = optionalText(body.category, 40) ?? '其他';
  const unit = optionalText(body.unit, 16) ?? '斤';
  const minStock = requireNumber(body.minStock ?? 0, '低库存阈值', { min: 0 });
  const note = optionalText(body.note, 255);

  const clash = await c.env.DB.prepare('select id from items where name = ? and id <> ?')
    .bind(name, id)
    .first<{ id: number }>();
  if (clash) throw new ApiError(409, `「${name}」已经存在了`);

  const res = await c.env.DB.prepare(
    'update items set name = ?, category = ?, unit = ?, min_stock = ?, note = ? where id = ? and archived = 0',
  )
    .bind(name, category, unit, minStock, note, id)
    .run();
  if (res.meta.changes === 0) throw new ApiError(404, '货品不存在');
  return c.json({ ok: true });
});

/** 软删除：流水是账，不能因为下架一个货品就凭空消失 */
items.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const res = await c.env.DB.prepare('update items set archived = 1 where id = ?').bind(id).run();
  if (res.meta.changes === 0) throw new ApiError(404, '货品不存在');
  return c.json({ ok: true });
});

items.get('/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('select mime, bytes, updated_at from item_images where item_id = ?')
    .bind(id)
    .first<{ mime: string; bytes: ArrayBuffer | number[]; updated_at: string }>();
  if (!row) throw new ApiError(404, '还没有图片');

  const body = row.bytes instanceof ArrayBuffer ? row.bytes : new Uint8Array(row.bytes as number[]);
  return new Response(body, {
    headers: {
      'content-type': row.mime,
      // 换图后前端请求的 URL 会带上新的 t 参数，所以这里可以放心长缓存
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

const MAX_IMAGE_BYTES = 1_500_000;

items.post('/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  const item = await c.env.DB.prepare('select id from items where id = ? and archived = 0')
    .bind(id)
    .first<{ id: number }>();
  if (!item) throw new ApiError(404, '货品不存在');

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, '没有收到图片文件');
  if (!file.type.startsWith('image/')) throw new ApiError(400, '只能上传图片');
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, '图片太大了，请重新拍一张');

  const bytes = await file.arrayBuffer();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into item_images (item_id, mime, bytes, updated_at) values (?, ?, ?, datetime('now'))
       on conflict (item_id) do update set mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at`,
    ).bind(id, file.type, bytes),
    c.env.DB.prepare('update items set has_image = 1 where id = ?').bind(id),
  ]);

  return c.json({ ok: true, url: `/api/items/${id}/image?t=${Date.now()}` });
});

items.delete('/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('delete from item_images where item_id = ?').bind(id),
    c.env.DB.prepare('update items set has_image = 0 where id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});
