import { Hono } from 'hono';
import { ApiError, optionalText, requireText, type AppEnv } from './types';

export const suppliers = new Hono<AppEnv>();

interface SupplierRow {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
}

function toSupplierDto(r: SupplierRow) {
  return {
    id: r.id,
    name: r.name,
    contactName: r.contact_name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    note: r.note,
  };
}

suppliers.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `select id, name, contact_name, phone, email, address, note
     from suppliers where user_id = ? and archived = 0 order by name`,
  )
    .bind(c.var.userId)
    .all<SupplierRow>();
  return c.json(results.map(toSupplierDto));
});

suppliers.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const name = requireText(body.name, '供应商名称', 60);
  const contactName = optionalText(body.contactName, 40);
  const phone = optionalText(body.phone, 30);
  const email = optionalText(body.email, 80);
  const address = optionalText(body.address, 120);
  const note = optionalText(body.note, 255);

  const existing = await c.env.DB.prepare('select id, archived from suppliers where user_id = ? and name = ?')
    .bind(c.var.userId, name)
    .first<{ id: number; archived: number }>();
  if (existing) {
    if (existing.archived === 0) throw new ApiError(409, `「${name}」已经存在了`);
    // 之前归档过同名供应商：复用这条记录，历史采购单也就跟着回来了
    await c.env.DB.batch([
      c.env.DB.prepare(
        `update suppliers set archived = 0, contact_name = ?, phone = ?, email = ?, address = ?, note = ?, updated_at = datetime('now')
         where id = ? and user_id = ?`,
      ).bind(contactName, phone, email, address, note, existing.id, c.var.userId),
      c.env.DB.prepare(
        `insert into audit_events (user_id, entity_type, entity_id, action, summary)
         values (?, 'supplier', ?, 'RESTORE', ?)`,
      ).bind(c.var.userId, existing.id, name),
    ]);
    return c.json({ id: existing.id }, 201);
  }

  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into suppliers (user_id, name, contact_name, phone, email, address, note)
       values (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(c.var.userId, name, contactName, phone, email, address, note),
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary)
       select ?, 'supplier', id, 'CREATE', ? from suppliers where user_id = ? and name = ?`,
    ).bind(c.var.userId, name, c.var.userId, name),
  ]);
  return c.json({ id: Number(res.meta.last_row_id) }, 201);
});

suppliers.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();
  const name = requireText(body.name, '供应商名称', 60);
  const contactName = optionalText(body.contactName, 40);
  const phone = optionalText(body.phone, 30);
  const email = optionalText(body.email, 80);
  const address = optionalText(body.address, 120);
  const note = optionalText(body.note, 255);

  const clash = await c.env.DB.prepare('select id from suppliers where user_id = ? and name = ? and id <> ?')
    .bind(c.var.userId, name, id)
    .first<{ id: number }>();
  if (clash) throw new ApiError(409, `「${name}」已经存在了`);

  const res = await c.env.DB.prepare(
    `update suppliers set name = ?, contact_name = ?, phone = ?, email = ?, address = ?, note = ?, updated_at = datetime('now')
     where id = ? and user_id = ? and archived = 0`,
  )
    .bind(name, contactName, phone, email, address, note, id, c.var.userId)
    .run();
  if (res.meta.changes === 0) throw new ApiError(404, '供应商不存在');
  return c.json({ ok: true });
});

/** 归档而非删除：已经下过的采购单还要能看清是找谁订的货 */
suppliers.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const supplier = await c.env.DB.prepare('select name from suppliers where id = ? and user_id = ? and archived = 0')
    .bind(id, c.var.userId)
    .first<{ name: string }>();
  if (!supplier) throw new ApiError(404, '供应商不存在');
  await c.env.DB.batch([
    c.env.DB.prepare(`update suppliers set archived = 1, updated_at = datetime('now') where id = ? and user_id = ?`).bind(
      id,
      c.var.userId,
    ),
    c.env.DB.prepare(
      `insert into audit_events (user_id, entity_type, entity_id, action, summary)
       values (?, 'supplier', ?, 'ARCHIVE', ?)`,
    ).bind(c.var.userId, id, supplier.name),
  ]);
  return c.json({ ok: true });
});
