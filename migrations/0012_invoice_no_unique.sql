-- 发票查重从"应用层查了再插"升级成数据库唯一索引兜底。
--
-- 之前 assertInvoiceNoUnused 是 SELECT 查重、隔一次往返再 UPDATE，两步不在
-- 一个事务里：手抖点两下保存、或者网络卡顿后重试，两个请求能一起通过查重、
-- 一起写进去，同一张发票就录成了两条——这正是这功能本来要拦的东西。
--
-- 用表达式索引而不是直接拿 supplier_name 入索引：SQLite 的 UNIQUE 索引里
-- NULL 跟 NULL 不算相同，供应商没填时两条空供应商、同编号的记录会被放过，
-- 跟应用层"供应商没填就退回全账号比对"的语义对不上。coalesce 成空字符串后
-- 两条未填供应商的记录才会撞在同一个索引键上，跟 assertInvoiceNoUnused 的
-- 查重范围保持一致。

-- 加约束前先处理掉可能已经存在的重复，不然 CREATE UNIQUE INDEX 直接炸掉、
-- 这次部署整个失败，新代码也跟着卡住上不了线。保留每组重复里 id 最小的
-- 那条（最早录入的），其余的编号清空——静默清空一次总比部署失败强，
-- 清空后原来的对货单和金额都还在，只是要找的人重新看一眼编号该填什么。
update receiving_slips as t
set invoice_no = null
where t.invoice_no is not null
  and t.id <> (
    select min(t2.id) from receiving_slips as t2
    where t2.user_id = t.user_id
      and coalesce(t2.supplier_name, '') = coalesce(t.supplier_name, '')
      and t2.invoice_no = t.invoice_no
  );

create unique index idx_receiving_slips_invoice_unique
  on receiving_slips (user_id, coalesce(supplier_name, ''), invoice_no)
  where invoice_no is not null;

-- 原来那条非唯一索引现在被这条唯一索引覆盖了，重复维护没有意义
drop index idx_receiving_slips_invoice_no;
