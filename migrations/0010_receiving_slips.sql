-- 对货单模块：拍纸质对货单和货物照片，AI 识别成表格，结账时按日期批量导出。
-- 跟采购单/库存流水是两套独立数据，互不影响——这里记的是「跟供应商对账用的原始凭证」，
-- 不是库存结存的依据。

create table settlements (
    id           integer primary key autoincrement,
    user_id      integer not null references users (id) on delete cascade,
    from_day     text,
    to_day       text    not null,
    slip_count   integer not null,
    total_amount real    not null default 0,
    created_at   text    not null default (datetime('now'))
);

create index idx_settlements_user on settlements (user_id, to_day desc, id desc);

create table receiving_slips (
    id            integer primary key autoincrement,
    user_id       integer not null references users (id) on delete cascade,
    slip_day      text    not null,
    supplier_name text,
    total_amount  real,
    note          text,
    settlement_id integer references settlements (id),
    -- 非空表示已经在某次结账里导出过，之后不允许再改，避免账对完了底稿又变了
    settled_at    text,
    created_at    text    not null default (datetime('now')),
    updated_at    text    not null default (datetime('now'))
);

create index idx_receiving_slips_user_day on receiving_slips (user_id, slip_day desc, id desc);
create index idx_receiving_slips_unsettled on receiving_slips (user_id, settled_at, slip_day);
create unique index idx_receiving_slips_id_user on receiving_slips (id, user_id);

create table receiving_slip_lines (
    id         integer primary key autoincrement,
    user_id    integer not null references users (id) on delete cascade,
    slip_id    integer not null,
    line_no    integer not null,
    item_name  text    not null,
    qty        real,
    unit       text,
    unit_price real,
    amount     real,
    note       text,
    foreign key (slip_id, user_id) references receiving_slips (id, user_id) on delete cascade
);

create index idx_receiving_slip_lines_slip on receiving_slip_lines (slip_id, line_no);

-- 一张单可以挂多张照片：对货单原件（SLIP，AI 识别用这个）和货物实拍（GOODS，留证据）
create table receiving_slip_images (
    id         integer primary key autoincrement,
    user_id    integer not null references users (id) on delete cascade,
    slip_id    integer not null,
    kind       text    not null check (kind in ('SLIP', 'GOODS')),
    mime       text    not null,
    bytes      blob    not null,
    created_at text    not null default (datetime('now')),
    foreign key (slip_id, user_id) references receiving_slips (id, user_id) on delete cascade
);

create index idx_receiving_slip_images_slip on receiving_slip_images (slip_id, kind, id);
