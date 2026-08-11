// 这里不从 types.ts 引任何东西：types.ts 反过来要用本文件的 reorderPointOf，
// 互相 import 会绕成一个圈，日后有人调整加载顺序就会踩到未初始化的坑。
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/**
 * 从盘点记录反推每天用掉多少。
 *
 * 关键在于不需要老板逐笔记出库：任意一段时间里
 *     消耗 = 期间入库 + 期初结存 − 期末结存
 * 而「期初/期末结存」只有在盘点那一刻才是可信的实数，
 * 所以窗口两端都锚在盘点上（counted_qty 就是当时数出来的实际数量）。
 *
 * 用最早和最近两次盘点之间的整段来平均，而不是只看最近两次——
 * 餐馆一周里工作日和周末的用量差很多，样本太短会算出忽高忽低的速度。
 */
export interface ItemUsage {
  /** 日均消耗，基本单位/天 */
  dailyUse: number;
  /** 参与计算的天数，用来判断这个估计有多可信 */
  days: number;
}

const LOOKBACK_DAYS = 90;
/** 少于这么多天的样本不敢用来推速度，宁可显示"还在攒数据" */
const MIN_SPAN_DAYS = 3;

export async function loadUsage(db: D1Database, userId: number): Promise<Map<number, ItemUsage>> {
  const { results } = await db
    .prepare(
      `with checks as (
         select item_id, counted_qty, day,
                row_number() over (partition by item_id order by id asc)  as rn_asc,
                row_number() over (partition by item_id order by id desc) as rn_desc
         from stock_moves
         where user_id = ?1 and kind = 'CHECK' and counted_qty is not null
           and day >= date('now', '-${LOOKBACK_DAYS} day')
       ),
       first_check as (select item_id, counted_qty, day from checks where rn_asc = 1),
       last_check  as (select item_id, counted_qty, day from checks where rn_desc = 1),
       received as (
         select m.item_id, sum(m.qty) as qty_in
         from stock_moves m
         join first_check f on f.item_id = m.item_id
         join last_check  l on l.item_id = m.item_id
         where m.user_id = ?1 and m.kind = 'IN' and m.day > f.day and m.day <= l.day
         group by m.item_id
       )
       select f.item_id,
              cast(julianday(l.day) - julianday(f.day) as real) as days,
              coalesce(r.qty_in, 0) + f.counted_qty - l.counted_qty as used
       from first_check f
       join last_check l on l.item_id = f.item_id
       left join received r on r.item_id = f.item_id
       where julianday(l.day) - julianday(f.day) >= ${MIN_SPAN_DAYS}`,
    )
    .bind(userId)
    .all<{ item_id: number; days: number; used: number }>();

  const map = new Map<number, ItemUsage>();
  for (const row of results) {
    // used 可能是负数：盘点盘出比账面多（之前漏记了入库）。这种情况推不出消耗速度，跳过。
    if (!(row.days > 0) || !(row.used > 0)) continue;
    map.set(row.item_id, { dailyUse: round3(row.used / row.days), days: row.days });
  }
  return map;
}

/** 送货路上这几天也在卖，所以再留一点余量，免得货到之前就断了 */
export const SAFETY_DAYS = 2;

export function reorderPointOf(usage: ItemUsage | undefined, leadTimeDays: number, minStock: number) {
  if (!usage) {
    // 还没有两次盘点，退回老板手填的阈值
    return { point: minStock, basis: 'MIN_STOCK' as const };
  }
  return {
    point: round3(usage.dailyUse * (leadTimeDays + SAFETY_DAYS)),
    basis: 'USAGE' as const,
  };
}

/** 新货品的默认送货天数：本地供应商多半隔天到 */
export const DEFAULT_LEAD_TIME_DAYS = 2;
