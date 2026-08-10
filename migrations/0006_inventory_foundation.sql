-- 补齐门店库存的业务基础。全部是增量变更，不重建现有账本表，也不删除历史数据。

-- 用户和会话生命周期，便于排查账号与登录问题。
alter table users add column updated_at text;
alter table users add column last_login_at text;
update users set updated_at = created_at where updated_at is null;

alter table sessions add column user_agent text;
alter table sessions add column last_seen_at text;
update sessions set last_seen_at = created_at where last_seen_at is null;

create index idx_users_last_login on users (last_login_at desc);
create index idx_sessions_expiry_user on sessions (expires_at, user_id);
create index idx_login_guard_updated on login_guard (updated_at);

-- 每个账号对应一家门店，先把展示和本地化设置独立出来，避免继续往 users 堆字段。
create table user_settings (
    user_id           integer primary key references users (id) on delete cascade,
    store_name        text    not null default '我的门店',
    currency          text    not null default 'EUR' check (length(currency) = 3),
    timezone          text    not null default 'Europe/Vienna',
    locale            text    not null default 'zh-CN',
    low_stock_enabled integer not null default 1 check (low_stock_enabled in (0, 1)),
    created_at        text    not null default (datetime('now')),
    updated_at        text    not null default (datetime('now'))
);

insert into user_settings (user_id, store_name)
select id, display_name || '的门店' from users;

-- 供应商主数据。归档而非删除，确保采购历史能一直追溯。
create table suppliers (
    id           integer primary key autoincrement,
    user_id      integer not null references users (id) on delete cascade,
    name         text    not null,
    contact_name text,
    phone        text,
    email        text,
    address      text,
    note         text,
    archived     integer not null default 0 check (archived in (0, 1)),
    created_at   text    not null default (datetime('now')),
    updated_at   text    not null default (datetime('now')),
    unique (user_id, name)
);

create index idx_suppliers_active on suppliers (user_id, archived, name);
create unique index idx_suppliers_id_user on suppliers (id, user_id);

-- 仓位独立建模，后续可从一个主仓扩到冷库、吧台、后厨等位置。
create table storage_locations (
    id         integer primary key autoincrement,
    user_id    integer not null references users (id) on delete cascade,
    name       text    not null,
    note       text,
    archived   integer not null default 0 check (archived in (0, 1)),
    created_at text    not null default (datetime('now')),
    updated_at text    not null default (datetime('now')),
    unique (user_id, name)
);

create index idx_locations_active on storage_locations (user_id, archived, name);
create unique index idx_locations_id_user on storage_locations (id, user_id);

insert into storage_locations (user_id, name, note)
select id, '主仓', '系统默认仓位' from users;

-- 货品档案补充可检索编码和默认采购/存放信息。
alter table items add column sku text;
alter table items add column barcode text;
alter table items add column default_supplier_id integer references suppliers (id);
alter table items add column default_location_id integer references storage_locations (id);
alter table items add column updated_at text;
alter table items add column archived_at text;

update items
set updated_at = created_at,
    default_location_id = (
      select l.id from storage_locations l
      where l.user_id = items.user_id and l.name = '主仓'
    )
where updated_at is null;

create unique index idx_items_user_sku on items (user_id, sku)
where sku is not null and sku <> '';
create unique index idx_items_user_barcode on items (user_id, barcode)
where barcode is not null and barcode <> '';
create index idx_items_default_supplier on items (user_id, default_supplier_id);
create index idx_items_default_location on items (user_id, default_location_id);
create unique index idx_items_id_user on items (id, user_id);

-- 默认供应商和仓位只通过按 user_id 过滤的应用接口写入。
-- D1 远程 migration 的语句分割器不可靠地处理 CREATE TRIGGER BEGIN/END，
-- 因此这里不重复添加触发器；后续新表继续使用下面的复合外键强制租户一致性。

-- 同一货品可以有多个供应商，并保留各自货号、包装和最近采购价。
create table item_suppliers (
    user_id         integer not null references users (id) on delete cascade,
    item_id         integer not null,
    supplier_id     integer not null,
    supplier_sku    text,
    purchase_unit   text,
    units_per_pack  real check (units_per_pack is null or units_per_pack > 0),
    last_unit_price real check (last_unit_price is null or last_unit_price >= 0),
    lead_time_days  integer check (lead_time_days is null or lead_time_days >= 0),
    preferred       integer not null default 0 check (preferred in (0, 1)),
    created_at      text    not null default (datetime('now')),
    updated_at      text    not null default (datetime('now')),
    primary key (item_id, supplier_id),
    foreign key (item_id, user_id) references items (id, user_id) on delete cascade,
    foreign key (supplier_id, user_id) references suppliers (id, user_id) on delete cascade
);

create index idx_item_suppliers_user on item_suppliers (user_id, supplier_id, preferred desc);
create unique index idx_item_suppliers_preferred on item_suppliers (user_id, item_id)
where preferred = 1;

-- 采购单和明细先作为稳定的数据边界，页面可逐步接入，不影响当前一键入库流程。
create table purchase_orders (
    id            integer primary key autoincrement,
    user_id       integer not null references users (id) on delete cascade,
    supplier_id   integer,
    order_no      text,
    status        text    not null default 'DRAFT'
                         check (status in ('DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
    ordered_day   text,
    expected_day  text,
    received_day  text,
    note          text,
    created_at    text    not null default (datetime('now')),
    updated_at    text    not null default (datetime('now')),
    foreign key (supplier_id, user_id) references suppliers (id, user_id)
);

create unique index idx_purchase_orders_no on purchase_orders (user_id, order_no)
where order_no is not null and order_no <> '';
create index idx_purchase_orders_status on purchase_orders (user_id, status, created_at desc);
create index idx_purchase_orders_supplier on purchase_orders (user_id, supplier_id, created_at desc);
create unique index idx_purchase_orders_id_user on purchase_orders (id, user_id);

create table purchase_order_lines (
    id                integer primary key autoincrement,
    user_id           integer not null references users (id) on delete cascade,
    purchase_order_id integer not null,
    item_id           integer not null,
    ordered_qty       real    not null check (ordered_qty > 0),
    received_qty      real    not null default 0 check (received_qty >= 0),
    unit_price        real check (unit_price is null or unit_price >= 0),
    note              text,
    created_at        text    not null default (datetime('now')),
    updated_at        text    not null default (datetime('now')),
    unique (purchase_order_id, item_id),
    foreign key (purchase_order_id, user_id) references purchase_orders (id, user_id) on delete cascade,
    foreign key (item_id, user_id) references items (id, user_id)
);

create index idx_purchase_lines_user_item on purchase_order_lines (user_id, item_id);

-- 流水来源和幂等键：网络重试时不会把同一笔入库记两遍。
alter table stock_moves add column request_id text;
alter table stock_moves add column location_id integer references storage_locations (id);
alter table stock_moves add column supplier_id integer references suppliers (id);
alter table stock_moves add column reference_no text;

update stock_moves
set location_id = (
  select l.id from storage_locations l
  where l.user_id = stock_moves.user_id and l.name = '主仓'
)
where location_id is null;

create unique index idx_moves_user_request on stock_moves (user_id, request_id)
where request_id is not null and request_id <> '';
create index idx_moves_user_item on stock_moves (user_id, item_id, id desc);
create index idx_moves_location_day on stock_moves (user_id, location_id, day desc, id desc);
create index idx_moves_supplier on stock_moves (user_id, supplier_id, id desc);

-- 业务审计与库存流水分开：流水负责算库存，审计负责回答“谁在什么时候改了什么”。
create table audit_events (
    id            integer primary key autoincrement,
    user_id       integer not null references users (id) on delete cascade,
    entity_type   text    not null,
    entity_id     integer,
    action        text    not null,
    summary       text,
    metadata_json text check (metadata_json is null or json_valid(metadata_json)),
    created_at    text    not null default (datetime('now'))
);

create index idx_audit_user_time on audit_events (user_id, created_at desc, id desc);
create index idx_audit_entity on audit_events (user_id, entity_type, entity_id, id desc);
