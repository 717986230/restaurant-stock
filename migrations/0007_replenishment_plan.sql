-- 补货计划和低库存预警分开：min_stock 决定何时提醒，weekly_target 决定补到多少。
alter table items add column weekly_target real not null default 0;

-- 兼容已有货品：先沿用旧版“阈值的两倍”作为初始周计划，之后可在货品档案中调整。
update items set weekly_target = max(min_stock * 2, 0);

