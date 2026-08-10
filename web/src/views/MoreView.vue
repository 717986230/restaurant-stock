<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, currentUser, fmt, round3, today, type Item } from '@/api';
import { toastError } from '@/toast';

interface ReplenishmentPlan {
  item: Item;
  needed: number;
  orderQty: number;
  packs: number | null;
}

const items = ref<Item[]>([]);
const loading = ref(true);

const plans = computed<ReplenishmentPlan[]>(() =>
  items.value
    .filter((item) => item.weeklyTarget > item.stock)
    .map((item) => {
      const needed = round3(item.weeklyTarget - item.stock);
      const packs = item.packSize ? Math.ceil(needed / item.packSize) : null;
      return {
        item,
        needed,
        orderQty: packs === null ? needed : round3(packs * item.packSize!),
        packs,
      };
    })
    .sort((a, b) => a.item.category.localeCompare(b.item.category, 'zh-CN') || a.item.name.localeCompare(b.item.name, 'zh-CN')),
);

onMounted(async () => {
  try {
    items.value = await api.items();
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
});

async function logout() {
  if (!confirm('退出登录？下次打开要重新输账号密码。')) return;
  try {
    await api.logout();
  } catch (e) {
    toastError(e);
  } finally {
    currentUser.value = null;
  }
}

/** 补货清单直接生成一段可以粘进微信发给供应商的文本 */
async function copyShoppingList() {
  if (!plans.value.length) return;
  const text = plans.value
    .map(({ item, orderQty, packs }) => {
      const amount = packs === null
        ? `${fmt(orderQty)}${item.unit}`
        : `${packs}${item.packUnit}（${fmt(orderQty)}${item.unit}）`;
      return `${item.name}：补 ${amount}；现有 ${fmt(item.stock)}${item.unit}，周计划 ${fmt(item.weeklyTarget)}${item.unit}`;
    })
    .join('\n');
  try {
    await navigator.clipboard.writeText(`【补货清单】\n${text}`);
    alert('补货清单已复制，可以直接粘贴发给供应商');
  } catch {
    prompt('复制下面的内容：', text);
  }
}
</script>

<template>
  <header class="app-bar">
    <h1>⚙️ 更多</h1>
  </header>

  <main class="page">
    <h2 class="sec">本周补货计划（{{ plans.length }}）</h2>
    <p class="formula">计划库存 − 现有库存；按箱采购的货品会向上取整到整箱。</p>
    <div v-if="loading" class="spinner">加载中…</div>
    <p v-else-if="!plans.length" class="ok-box">当前库存已经达到本周计划。</p>
    <ul v-else class="alerts">
      <li v-for="plan in plans" :key="plan.item.id" :class="plan.item.status.toLowerCase()">
        <RouterLink :to="`/items/${plan.item.id}`">
          <span class="plan-head">
            <span class="name">{{ plan.item.name }}</span>
            <strong class="order">
              补 {{ plan.packs === null ? `${fmt(plan.orderQty)} ${plan.item.unit}` : `${plan.packs} ${plan.item.packUnit}` }}
            </strong>
          </span>
          <span class="small">
            现有 {{ fmt(plan.item.stock) }} {{ plan.item.unit }}／周计划 {{ fmt(plan.item.weeklyTarget) }} {{ plan.item.unit }}
            <template v-if="plan.packs !== null">／实际到货 {{ fmt(plan.orderQty) }} {{ plan.item.unit }}</template>
          </span>
        </RouterLink>
      </li>
    </ul>
    <button v-if="plans.length" class="btn btn-primary btn-block" @click="copyShoppingList">复制补货清单</button>

    <h2 class="sec">数据</h2>
    <div class="links">
      <RouterLink to="/items/new" class="link">➕ 新增货品</RouterLink>
      <a :href="`/api/export.csv?day=${today()}`" class="link">⬇️ 导出当前库存（CSV，可用 Excel 打开）</a>
    </div>

    <h2 class="sec">账号</h2>
    <div class="links">
      <div class="link who">
        👤 当前账号：<strong>{{ currentUser?.displayName }}</strong>
        <span class="muted small">　你的数据只有这个账号看得到</span>
      </div>
      <button class="link logout" @click="logout">🔒 退出登录</button>
    </div>

    <p class="muted small foot">
      门店库存 · 数据存在 Cloudflare D1，网页版免安装。<br />
      在手机浏览器里选「添加到主屏幕」，用起来跟 App 一样。
    </p>
  </main>
</template>

<style scoped>
.sec {
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
  margin: 18px 0 8px;
}

.sec:first-child {
  margin-top: 0;
}

.formula {
  margin: -2px 0 10px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.ok-box {
  background: var(--ok-soft);
  color: var(--ok);
  border-radius: 12px;
  padding: 14px;
  font-size: 14px;
  margin: 0;
}

.alerts {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}

.alerts li {
  border-bottom: 1px solid var(--line);
}

.alerts li:last-child {
  border-bottom: none;
}

.alerts a {
  display: block;
  padding: 11px 12px;
}

.alerts .name {
  font-weight: 600;
  font-size: 15px;
}

.plan-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.order {
  flex: none;
  color: var(--accent);
  font-size: 14px;
}

.alerts .small {
  color: var(--muted);
  font-size: 13px;
}

.alerts li.out {
  box-shadow: inset 4px 0 0 var(--danger);
  background: var(--danger-soft);
}

.alerts li.low {
  box-shadow: inset 4px 0 0 var(--warn);
  background: var(--warn-soft);
}

.links {
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}

.link {
  padding: 14px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 15px;
}

.link:last-child {
  border-bottom: none;
}

.who {
  line-height: 1.6;
}

.logout {
  width: 100%;
  text-align: left;
  color: var(--danger);
}

.foot {
  margin-top: 24px;
  text-align: center;
  line-height: 1.7;
}
</style>
