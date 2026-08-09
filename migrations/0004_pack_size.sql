-- 酒水饮料按箱进货、按瓶卖。库存统一按「瓶」这类最小单位存，
-- 箱只是录入和显示时的换算，这样半箱、拆箱零卖都能算清楚，不会出现 0.5 箱这种数。
alter table items add column pack_size real;   -- 一箱 = 多少个基本单位；null 表示这件东西不用换算
alter table items add column pack_unit text;   -- 大单位名，通常是「箱」

-- 把种子里的酒水饮料从「按箱记」改成「按瓶记」。
-- 原来的低库存阈值是箱数，换算成瓶要乘以每箱数量，否则阈值会凭空缩小几十倍。
update items set unit = '瓶', pack_unit = '箱', pack_size = 24, min_stock = min_stock * 24
    where name in ('可乐', '雪碧', '芬达', '矿泉水', '苏打水', '白酒 小瓶');

update items set unit = '瓶', pack_unit = '箱', pack_size = 15, min_stock = min_stock * 15
    where name in ('冰红茶', '绿茶');

update items set unit = '瓶', pack_unit = '箱', pack_size = 12, min_stock = min_stock * 12
    where name in ('橙汁', '酸梅汤', '瓶装啤酒', '精酿啤酒', '黄酒', '米酒');

update items set unit = '听', pack_unit = '箱', pack_size = 24, min_stock = min_stock * 24
    where name in ('椰汁', '凉茶', '功能饮料', '听装啤酒');

update items set unit = '盒', pack_unit = '箱', pack_size = 24, min_stock = min_stock * 24
    where name = '豆奶';

update items set unit = '瓶', pack_unit = '箱', pack_size = 6, min_stock = min_stock * 6
    where name = '红酒';

-- 白酒大瓶原本就是按瓶记的，阈值不用换算，只补上整箱规格
update items set pack_unit = '箱', pack_size = 6 where name = '白酒 大瓶';
