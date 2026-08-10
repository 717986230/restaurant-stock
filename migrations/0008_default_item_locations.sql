-- 0006 只回填了迁移当时已有的货品；补齐迁移后注册账号所生成的初始货品。
update items
set default_location_id = (
  select l.id from storage_locations l
  where l.user_id = items.user_id and l.name = '主仓'
)
where default_location_id is null;

