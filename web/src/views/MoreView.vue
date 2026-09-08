<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, currentUser, fmt, round3, today, type Item } from '@/api';
import { toast, toastError } from '@/toast';
import { askConfirm } from '@/confirm';

interface ReplenishmentPlan {
  item: Item;
  needed: number;
  orderQty: number;
  packs: number | null;
  /** 已经跌到再订货点：再不下单，货没到就断了 */
  urgent: boolean;
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
        urgent: item.status !== 'OK',
      };
    })
    // 必须下单的排最前面：这张清单是拿着照着订货的，紧急的不能埋在中间
    .sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) ||
        a.item.category.localeCompare(b.item.category, 'zh-CN') ||
        a.item.name.localeCompare(b.item.name, 'zh-CN'),
    ),
);

// 已用光和"跌到再订货点"要分开讲：新账号所有东西都是 0，
// 全部打同一个标签等于没标。
const outCount = computed(() => plans.value.filter((p) => p.item.status === 'OUT').length);
const lowCount = computed(() => plans.value.filter((p) => p.item.status === 'LOW').length);

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
  if (!await askConfirm({
    title: '退出当前账号？',
    message: '这台设备的登录状态会被清除，下次打开需要重新输入账号和密码。',
    confirmText: '退出登录',
    tone: 'danger',
  })) return;
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
    toast('补货清单已复制');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    copied ? toast('补货清单已复制') : toastError(new Error('复制失败，请重试'));
  }
}
</script>

<template>
  <header class="app-bar">
    <h1>⚙️ 更多</h1>
  </header>

  <main class="page with-floating-actions">
    <h2 class="sec">补货计划（{{ plans.length }}）</h2>
    <p class="formula">
      补货量 = 常备量 − 现有库存，按箱采购的向上取整到整箱。<br />
      标「现在下单」的是已经跌到再订货点的——按目前消耗速度，等到货那天正好用完或已经断货。
    </p>
    <p v-if="outCount || lowCount" class="urgent-line">
      <template v-if="outCount">⚠️ {{ outCount }} 项已经用光</template>
      <template v-if="outCount && lowCount">，</template>
      <template v-if="lowCount">{{ lowCount }} 项跌到再订货点</template>
    </p>
    <div v-if="loading" class="spinner">加载中…</div>
    <p v-else-if="!plans.length" class="ok-box">当前库存已经达到本周计划。</p>
    <ul v-else class="alerts">
      <li v-for="plan in plans" :key="plan.item.id" :class="plan.item.status.toLowerCase()">
        <RouterLink :to="`/items/${plan.item.id}`">
          <span class="plan-head">
            <span class="name">
              {{ plan.item.name }}
              <span v-if="plan.item.status === 'OUT'" class="now out">已用光</span>
              <span v-else-if="plan.item.status === 'LOW'" class="now">现在下单</span>
            </span>
            <strong class="order">
              补 {{ plan.packs === null ? `${fmt(plan.orderQty)} ${plan.item.unit}` : `${plan.packs} ${plan.item.packUnit}` }}
            </strong>
          </span>
          <span class="small">
            现有 {{ fmt(plan.item.stock) }} {{ plan.item.unit }}／常备 {{ fmt(plan.item.weeklyTarget) }} {{ plan.item.unit }}
            <template v-if="plan.packs !== null">／实际到货 {{ fmt(plan.orderQty) }} {{ plan.item.unit }}</template>
            <template v-if="plan.item.daysLeft !== null">
              <br />约够 {{ plan.item.daysLeft }} 天，送到要 {{ plan.item.leadTimeDays }} 天
            </template>
          </span>
        </RouterLink>
      </li>
    </ul>
    <h2 class="sec">采购</h2>
    <div class="links">
      <RouterLink to="/purchases" class="link">🧾 采购单</RouterLink>
      <RouterLink to="/suppliers" class="link">🚚 供应商</RouterLink>
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
      门店库存 · 数据存在 Cloudflare D1。<br />
      可安装到手机主屏幕或电脑桌面，打开后和 App 一样。
    </p>
  </main>

  <div class="floating-actions" aria-label="数据操作">
    <RouterLink to="/items/new" class="floating-action">
      <span class="floating-action-icon" aria-hidden="true">＋</span>
      <span>新增</span>
    </RouterLink>
    <button v-if="plans.length" class="floating-action" @click="copyShoppingList">
      <span class="floating-action-icon" aria-hidden="true">⧉</span>
      <span>复制清单</span>
    </button>
    <a :href="`/api/export.csv?day=${today()}`" class="floating-action primary">
      <span class="floating-action-icon" aria-hidden="true">↓</span>
      <span>导出库存</span>
    </a>
  </div>
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

.urgent-line {
  margin: -4px 0 10px;
  color: var(--danger);
  font-size: 13px;
  font-weight: 600;
}

.now {
  margin-left: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--warn);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.now.out {
  background: var(--danger);
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
