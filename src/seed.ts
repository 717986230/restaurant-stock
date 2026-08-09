/**
 * 新用户注册时写入的初始物料清单。
 * 多租户之后种子数据不能再放在 migration 里（那样是全局的、不属于任何人），
 * 改成注册时按这份清单给每个用户各建一套，之后各改各的互不影响。
 */
export interface SeedItem {
  name: string;
  category: string;
  unit: string;
  minStock: number;
  packSize?: number;
  packUnit?: string;
}

export const SEED_ITEMS: SeedItem[] = [
  // 包装耗材：最容易断货又最不该断货的一类
  { name: '外卖盒 大', category: '包装耗材', unit: '箱', minStock: 2 },
  { name: '外卖盒 中', category: '包装耗材', unit: '箱', minStock: 3 },
  { name: '外卖盒 小', category: '包装耗材', unit: '箱', minStock: 3 },
  { name: '汤碗（带盖）', category: '包装耗材', unit: '箱', minStock: 2 },
  { name: '汤杯（带盖）', category: '包装耗材', unit: '箱', minStock: 2 },
  { name: '外卖袋 大', category: '包装耗材', unit: '捆', minStock: 5 },
  { name: '外卖袋 中', category: '包装耗材', unit: '捆', minStock: 5 },
  { name: '外卖袋 小', category: '包装耗材', unit: '捆', minStock: 3 },
  { name: '手提纸袋', category: '包装耗材', unit: '捆', minStock: 3 },
  { name: '一次性筷子', category: '包装耗材', unit: '箱', minStock: 2 },
  { name: '一次性勺子', category: '包装耗材', unit: '包', minStock: 5 },
  { name: '一次性叉子', category: '包装耗材', unit: '包', minStock: 3 },
  { name: '吸管', category: '包装耗材', unit: '包', minStock: 4 },
  { name: '餐巾纸', category: '包装耗材', unit: '箱', minStock: 2 },
  { name: '湿巾', category: '包装耗材', unit: '箱', minStock: 1 },
  { name: '保鲜膜', category: '包装耗材', unit: '卷', minStock: 4 },
  { name: '锡纸', category: '包装耗材', unit: '卷', minStock: 3 },
  { name: '封口贴', category: '包装耗材', unit: '卷', minStock: 5 },
  { name: '打包胶带', category: '包装耗材', unit: '卷', minStock: 6 },
  { name: '小票纸', category: '包装耗材', unit: '卷', minStock: 8 },
  { name: '一次性手套', category: '包装耗材', unit: '盒', minStock: 4 },

  // 酒水：按箱进、按瓶卖，所以带整箱规格
  { name: '瓶装啤酒', category: '酒水', unit: '瓶', minStock: 72, packSize: 12, packUnit: '箱' },
  { name: '听装啤酒', category: '酒水', unit: '听', minStock: 96, packSize: 24, packUnit: '箱' },
  { name: '精酿啤酒', category: '酒水', unit: '瓶', minStock: 24, packSize: 12, packUnit: '箱' },
  { name: '白酒 小瓶', category: '酒水', unit: '瓶', minStock: 48, packSize: 24, packUnit: '箱' },
  { name: '白酒 大瓶', category: '酒水', unit: '瓶', minStock: 6, packSize: 6, packUnit: '箱' },
  { name: '红酒', category: '酒水', unit: '瓶', minStock: 24, packSize: 6, packUnit: '箱' },
  { name: '黄酒', category: '酒水', unit: '瓶', minStock: 12, packSize: 12, packUnit: '箱' },
  { name: '米酒', category: '酒水', unit: '瓶', minStock: 12, packSize: 12, packUnit: '箱' },

  // 饮料
  { name: '可乐', category: '饮料', unit: '瓶', minStock: 96, packSize: 24, packUnit: '箱' },
  { name: '雪碧', category: '饮料', unit: '瓶', minStock: 72, packSize: 24, packUnit: '箱' },
  { name: '芬达', category: '饮料', unit: '瓶', minStock: 48, packSize: 24, packUnit: '箱' },
  { name: '冰红茶', category: '饮料', unit: '瓶', minStock: 45, packSize: 15, packUnit: '箱' },
  { name: '绿茶', category: '饮料', unit: '瓶', minStock: 30, packSize: 15, packUnit: '箱' },
  { name: '矿泉水', category: '饮料', unit: '瓶', minStock: 120, packSize: 24, packUnit: '箱' },
  { name: '苏打水', category: '饮料', unit: '瓶', minStock: 48, packSize: 24, packUnit: '箱' },
  { name: '橙汁', category: '饮料', unit: '瓶', minStock: 24, packSize: 12, packUnit: '箱' },
  { name: '酸梅汤', category: '饮料', unit: '瓶', minStock: 24, packSize: 12, packUnit: '箱' },
  { name: '椰汁', category: '饮料', unit: '听', minStock: 48, packSize: 24, packUnit: '箱' },
  { name: '豆奶', category: '饮料', unit: '盒', minStock: 48, packSize: 24, packUnit: '箱' },
  { name: '凉茶', category: '饮料', unit: '听', minStock: 48, packSize: 24, packUnit: '箱' },
  { name: '功能饮料', category: '饮料', unit: '听', minStock: 24, packSize: 24, packUnit: '箱' },

  // 清洁用品
  { name: '垃圾袋', category: '清洁用品', unit: '捆', minStock: 4 },
  { name: '洗洁精', category: '清洁用品', unit: '瓶', minStock: 4 },
  { name: '洗手液', category: '清洁用品', unit: '瓶', minStock: 3 },
  { name: '厨房纸', category: '清洁用品', unit: '提', minStock: 3 },
  { name: '抹布', category: '清洁用品', unit: '包', minStock: 2 },
  { name: '消毒液', category: '清洁用品', unit: '瓶', minStock: 2 },
];
