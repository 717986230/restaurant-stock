# 门店库存 · 中餐馆仓库管理系统

手机浏览器打开就能用的库存管理网页。前端 Vue 3，后端 Cloudflare Workers，数据存 Cloudflare D1。
没有服务器要维护，部署一条命令，日常用量在免费额度里。

## 能做什么

- **库存总览** — 按分类分组，搜索、筛选；**结存跌到阈值以下整行标红**，用光了标"已用光"
- **一键出入库** — 列表每行右侧 `＋` / `－`，弹出数字键盘输入，确定前先告诉你"记完还剩多少"
- **出入库数量记录** — 每一笔都留档（时间、数量、进价、备注），可按天翻看，记错了随时撤销
- **盘点** — 按分类逐项填实际数量，系统自动算差额并记一笔盘点流水
- **货品图片** — 手机直接拍照上传，前端先压到 900px / 约 100KB 再传，采购时不认错货
- **补货清单** — 一键复制成文本，直接粘贴发给供应商
- **导出 CSV** — 用 Excel 打开，发给会计

库存不缓存：任意时刻的结存都是这件货品所有流水之和，账永远对得上。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3 + Vite + TypeScript，移动端优先，可"添加到主屏幕"当 App 用 |
| 后端 | Cloudflare Workers + Hono（TypeScript） |
| 数据库 | Cloudflare D1（边缘 SQLite），Migration 版本化管理 |
| 图片 | 存在 D1 的 `item_images` 表，随数据库一起备份 |

## 目录结构

```
├── src/                worker 后端
│   ├── index.ts        路由入口、汇总、CSV 导出
│   ├── items.ts        货品档案 + 图片上传
│   ├── moves.ts        出入库 / 盘点流水
│   └── types.ts        类型、校验、库存状态判定
├── web/                Vue 3 前端（构建产物输出到 public/）
│   └── src/views/      库存 / 流水 / 盘点 / 详情 / 编辑 / 更多
├── migrations/         D1 数据库迁移（含外卖店常备物料初始数据）
└── wrangler.jsonc      Cloudflare 部署配置
```

## 本地开发

```bash
npm install
npm run db:init      # 初始化本地 D1（建表 + 48 项外卖店常备物料）
npm run dev          # http://localhost:8787
```

想要前端热更新，另开一个终端跑 `npm run dev:web`（5173 端口，接口自动代理到 8787）。

## 部署到 Cloudflare

第一次部署要做三步：

```bash
npx wrangler login
```

```bash
npx wrangler d1 create restaurant-stock
```

上一条命令会打印一个 `database_id`，把它填进 [wrangler.jsonc](wrangler.jsonc) 里替换掉 `PLACEHOLDER_REPLACE_AFTER_D1_CREATE`，然后：

```bash
npm run db:init:remote && npm run deploy
```

部署完会给一个 `https://restaurant-stock.<你的账号>.workers.dev` 网址。手机浏览器打开，
iPhone 选「分享 → 添加到主屏幕」，安卓选「添加到主屏幕」，之后点图标就能直接进，跟 App 一样。

以后改完代码，只要 `npm run deploy` 一条命令。

## 关于访问控制

目前**任何知道网址的人都能读写数据**。网址是随机的、不会被搜索引擎收录，但一旦外传就管不住了。
如果之后想加一道口令，改动很小：在 Worker 入口加一个中间件校验请求头里的口令，前端把口令存到
`localStorage` 就行——需要的时候可以随时加上。

## 数据安全

- D1 由 Cloudflare 托管并自动备份，可回滚到过去 30 天内任意时间点
- 想自己留一份：`npx wrangler d1 export restaurant-stock --remote --output backup.sql`

## 免费额度够不够

按一家店每天 100 次出入库、50 项货品估算，日请求量约几千次，
远在 Workers 免费额度（10 万次/天）和 D1 免费额度（500 万行读/天）之内。
图片按每张 100KB、300 个货品算约 30MB，也在 D1 的免费存储范围内。
