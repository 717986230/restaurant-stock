import { Hono } from 'hono';
import { registerAuthRoutes, requireAuth } from './auth';
import { items } from './items';
import { moves } from './moves';
import { ApiError, normalizeDay, round3, statusOf, toItemDto, type AppEnv, type ItemRow } from './types';

const app = new Hono<AppEnv>();

// 放在所有业务路由之前：漏掉一条路由就等于漏掉一道门
app.use('/api/*', requireAuth);
registerAuthRoutes(app);

app.route('/api/items', items);
app.route('/api/moves', moves);

/** 首页顶部那几个数字：一眼看出今天有没有事要处理 */
app.get('/api/summary', async (c) => {
  const day = normalizeDay(c.req.query('day'));

  const [itemRows, dayRows] = await Promise.all([
    c.env.DB.prepare(
      `select i.min_stock,
              coalesce((select sum(m.qty) from stock_moves m where m.item_id = i.id), 0) as stock
       from items i where i.user_id = ? and i.archived = 0`,
    ).bind(c.var.userId).all<{ min_stock: number; stock: number }>(),
    c.env.DB.prepare(
      `select kind, count(*) as n from stock_moves where user_id = ? and day = ? group by kind`,
    ).bind(c.var.userId, day).all<{ kind: string; n: number }>(),
  ]);

  let low = 0;
  let out = 0;
  for (const r of itemRows.results) {
    const s = statusOf(r.stock ?? 0, r.min_stock);
    if (s === 'OUT') out++;
    else if (s === 'LOW') low++;
  }
  const byKind = Object.fromEntries(dayRows.results.map((r) => [r.kind, r.n]));

  return c.json({
    day,
    items: itemRows.results.length,
    low,
    out,
    alerts: low + out,
    todayIn: byKind.IN ?? 0,
    todayOut: byKind.OUT ?? 0,
    todayCheck: byKind.CHECK ?? 0,
  });
});

/** 导出当前结存，微信发给会计或者自己存档 */
app.get('/api/export.csv', async (c) => {
  const { results } = await c.env.DB.prepare(
    `select i.id, i.name, i.category, i.unit, i.pack_size, i.pack_unit,
            i.min_stock, i.weekly_target, i.last_price, i.has_image, i.note,
            (select l.name from storage_locations l where l.id = i.default_location_id and l.user_id = i.user_id) as location_name,
            coalesce((select sum(m.qty) from stock_moves m where m.item_id = i.id), 0) as stock
     from items i where i.user_id = ? and i.archived = 0 order by i.category, i.name`,
  ).bind(c.var.userId).all<ItemRow>();

  const label = { OUT: '已用光', LOW: '偏低', OK: '正常' } as const;
  const header = ['分类', '货品', '存放位置', '单位', '当前结存', '折合整箱', '整箱规格', '低库存阈值', '每周计划库存', '状态', '最近进价', '备注'];
  const lines = results.map(toItemDto).map((it) =>
    [
      it.category,
      it.name,
      it.locationName ?? '',
      it.unit,
      it.stock,
      it.packSize ? packText(it.stock, it.packSize, it.packUnit!, it.unit) : '',
      it.packSize ? `1${it.packUnit} = ${it.packSize}${it.unit}` : '',
      it.minStock,
      it.weeklyTarget,
      label[it.status],
      it.lastPrice ?? '',
      it.note ?? '',
    ]
      .map(csvCell)
      .join(','),
  );

  // Excel 认 BOM 才不会把中文显示成乱码
  const body = '﻿' + [header.join(','), ...lines].join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // 文件名用门店本地日期，跟页面上显示的日期对得上
      'content-disposition': `attachment; filename="stock-${normalizeDay(c.req.query('day'))}.csv"`,
    },
  });
});

/** 把总瓶数写成「3箱5瓶」这种人能直接照着点货的形式 */
function packText(stock: number, packSize: number, packUnit: string, unit: string): string {
  if (stock <= 0) return '';
  const boxes = Math.floor(stock / packSize);
  const rest = round3(stock - boxes * packSize);
  if (!boxes) return `${rest}${unit}`;
  return rest ? `${boxes}${packUnit}${rest}${unit}` : `${boxes}${packUnit}`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: '服务器出错了，请稍后再试' }, 500);
});

app.notFound((c) => c.json({ error: '接口不存在' }, 404));

export default app;
