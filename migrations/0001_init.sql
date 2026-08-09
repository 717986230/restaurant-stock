-- 货品档案
create table items (
    id         integer primary key autoincrement,
    name       text    not null unique,
    category   text    not null default '其他',
    unit       text    not null default '箱',
    min_stock  real    not null default 0,  -- 低库存阈值：结存 <= 该值时列表标红
    last_price real,                        -- 最近一次进价
    has_image  integer not null default 0,  -- 是否已上传图片，避免列表查询去碰 blob 表
    note       text,
    archived   integer not null default 0,
    created_at text    not null default (datetime('now'))
);

-- 出入库流水。qty 为有符号数量：入库为正，出库为负，盘点为差额。
-- 结存 = 该货品所有流水 qty 之和 —— 不缓存当前库存，账永远对得上。
create table stock_moves (
    id          integer primary key autoincrement,
    item_id     integer not null references items (id) on delete cascade,
    kind        text    not null check (kind in ('IN', 'OUT', 'CHECK')),
    qty         real    not null,
    unit_price  real,                       -- 仅入库时记录
    counted_qty real,                       -- 仅盘点时记录：盘后实际数量
    note        text,
    operator    text,
    day         text    not null,           -- 门店本地日期 YYYY-MM-DD，避免时区把当日流水切错
    created_at  text    not null default (datetime('now'))
);

-- 货品图片单独存表，列表查询不会把二进制一起拖出来
create table item_images (
    item_id    integer primary key references items (id) on delete cascade,
    mime       text    not null,
    bytes      blob    not null,
    updated_at text    not null default (datetime('now'))
);

create index idx_moves_item on stock_moves (item_id, id desc);
create index idx_moves_day on stock_moves (day desc, id desc);
create index idx_items_active on items (archived, category, name);
