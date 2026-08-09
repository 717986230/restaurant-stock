-- 防暴力猜 PIN：按来源 IP 记失败次数，连错几次就把这个 IP 锁一会儿。
-- 按 IP 而不是全局，避免有人故意连错把店里自己人也挡在门外。
create table login_guard (
    ip            text primary key,
    fails         integer not null default 0,
    blocked_until text,
    updated_at    text    not null default (datetime('now'))
);
