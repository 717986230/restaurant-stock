<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, fmt, today, type Item } from '@/api';
import { toastError } from '@/toast';

const alerts = ref<Item[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    alerts.value = await api.items({ low: true });
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
});

/** 补货清单直接生成一段可以粘进微信发给供应商的文本 */
async function copyShoppingList() {
  if (!alerts.value.length) return;
  const text = alerts.value
    .map((it) => `${it.name}（现有 ${fmt(it.stock)}${it.unit}，建议补到 ${fmt(Math.max(it.minStock * 2, 1))}${it.unit}）`)
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
    <h2 class="sec">需要补货（{{ alerts.length }}）</h2>
    <div v-if="loading" class="spinner">加载中…</div>
    <p v-else-if="!alerts.length" class="ok-box">目前所有货品库存都正常 👍</p>
    <ul v-else class="alerts">
      <li v-for="it in alerts" :key="it.id" :class="it.status.toLowerCase()">
        <RouterLink :to="`/items/${it.id}`">
          <span class="name">{{ it.name }}</span>
          <span class="small">
            现有 {{ fmt(it.stock) }} {{ it.unit }}
            <template v-if="it.minStock > 0">／阈值 {{ fmt(it.minStock) }}</template>
          </span>
        </RouterLink>
      </li>
    </ul>
    <button v-if="alerts.length" class="btn btn-block" @click="copyShoppingList">复制补货清单</button>

    <h2 class="sec">数据</h2>
    <div class="links">
      <RouterLink to="/items/new" class="link">➕ 新增货品</RouterLink>
      <a :href="`/api/export.csv?day=${today()}`" class="link">⬇️ 导出当前库存（CSV，可用 Excel 打开）</a>
    </div>

    <p class="muted small foot">
      后厨库存 · 数据存在 Cloudflare D1，网页版免安装。<br />
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
  display: block;
  font-weight: 600;
  font-size: 15px;
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

.foot {
  margin-top: 24px;
  text-align: center;
  line-height: 1.7;
}
</style>
