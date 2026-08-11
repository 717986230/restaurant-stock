-- 把「什么时候该下单」从一个人工填的固定阈值，换成按实际消耗速度和送货天数算出来的再订货点。
--
-- 原来 min_stock 要老板凭感觉填一个数，填完就不动了，卖得快卖得慢都用同一个数。
-- 现在只要问一句「这东西送到要几天」，剩下的系统自己算：
--     再订货点 = 日均消耗 × (送货天数 + 安全天数)
-- 日均消耗由两次盘点之间的实际消耗推出来，不需要逐笔记出库。
--
-- min_stock 不删，降级成兜底：新货品还没盘过两次、算不出消耗速度时仍然用它。
alter table items add column lead_time_days integer not null default 2
    check (lead_time_days >= 0 and lead_time_days <= 60);

-- item_suppliers 里已经有按供应商的 lead_time_days，那个是将来做多供应商比价用的。
-- 这里放在 items 上是为了让老板只填一个数，不用先建供应商档案。
