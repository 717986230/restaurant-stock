-- 从「一个共享 PIN」换成「一人一个账号，各看各的数据」。
--
-- D1 做不到真的一人一个数据库：免费版一个账户上限 10 个库，而且 Worker 的 D1 绑定
-- 是静态配置、运行时没法动态绑新库。所以走业界标准的逻辑隔离——每张业务表带 user_id，
-- 每条查询都按当前登录用户过滤，用户之间互相看不见。
--
-- 下面几张表在此之前只有初始种子数据（各家的真实库存还没开始录），
-- 所以直接重建，不做数据迁移。新用户的初始物料改由注册时按代码里的清单写入。

create table users (
    id           integer primary key autoincrement,
    -- 统一存小写：避免 "LaoWang" 和 "laowang" 注册成两个账号
    username     text    not null unique,
    display_name text    not null,
    salt         text    not null,
    pass_hash    text    not null,
    iterations   integer not null,
    created_at   text    not null default (datetime('now'))
);

-- 会话存库而不是纯签名令牌，这样「退出登录」和「改密码踢下线」是真的能踢掉的。
-- 库里只存令牌的哈希，即使数据库被看到也没法拿去冒充登录。
create table sessions (
    token_hash text    primary key,
    user_id    integer not null references users (id) on delete cascade,
    expires_at text    not null,
    created_at text    not null default (datetime('now'))
);

create index idx_sessions_user on sessions (user_id);
create index idx_sessions_exp on sessions (expires_at);

drop table item_images;
drop table stock_moves;
drop table items;

create table items (
    id         integer primary key autoincrement,
    user_id    integer not null references users (id) on delete cascade,
    name       text    not null,
    category   text    not null default '其他',
    unit       text    not null default '箱',
    pack_size  real,
    pack_unit  text,
    min_stock  real    not null default 0,
    last_price real,
    has_image  integer not null default 0,
    note       text,
    archived   integer not null default 0,
    created_at text    not null default (datetime('now')),
    -- 重名只在同一个用户内部才算冲突
    unique (user_id, name)
);

create table stock_moves (
    id          integer primary key autoincrement,
    user_id     integer not null references users (id) on delete cascade,
    item_id     integer not null references items (id) on delete cascade,
    kind        text    not null check (kind in ('IN', 'OUT', 'CHECK')),
    qty         real    not null,
    unit_price  real,
    counted_qty real,
    note        text,
    operator    text,
    day         text    not null,
    created_at  text    not null default (datetime('now'))
);

create table item_images (
    item_id    integer primary key references items (id) on delete cascade,
    mime       text    not null,
    bytes      blob    not null,
    updated_at text    not null default (datetime('now'))
);

create index idx_moves_item on stock_moves (item_id, id desc);
create index idx_moves_day on stock_moves (user_id, day desc, id desc);
create index idx_items_active on items (user_id, archived, category, name);
