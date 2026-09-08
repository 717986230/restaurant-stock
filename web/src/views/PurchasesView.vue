<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api, fmt, type PurchaseOrder, type PurchaseStatus } from '@/api';
import { toastError } from '@/toast';

const router = useRouter();
const list = ref<PurchaseOrder[]>([]);
const loading = ref(true);
const status = ref<PurchaseStatus | ''>('');

const STATUS_LABEL: Record<PurchaseStatus, string> = {
  ORDERED: '已下单',
  PARTIAL: '部分到货',
  RECEIVED: '已完成',
  CANCELLED: '已取消',
};

async function load() {
  try {
    list.value = await api.purchases(status.value);
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(status, load);
</script>

<template>
  <header class="app-bar">
    <h1>
      <button class="back" @click="router.back()" aria-label="返回">‹</button>
      🧾 采购单
    </h1>
    <div class="chips">
      <button :class="['chip', { on: status === '' }]" @click="status = ''">全部</button>
      <button :class="['chip', { on: status === 'ORDERED' }]" @click="status = 'ORDERED'">已下单</button>
      <button :class="['chip', { on: status === 'PARTIAL' }]" @click="status = 'PARTIAL'">部分到货</button>
      <button :class="['chip', { on: status === 'RECEIVED' }]" @click="status = 'RECEIVED'">已完成</button>
      <button :class="['chip', { on: status === 'CANCELLED' }]" @click="status = 'CANCELLED'">已取消</button>
    </div>
  </header>

  <main class="page with-floating-action">
    <div v-if="loading" class="spinner">加载中…</div>
    <div v-else-if="!list.length" class="empty">
      <p>还没有采购单</p>
      <RouterLink to="/purchases/new" class="btn btn-primary">新建采购单</RouterLink>
    </div>

    <ul v-else class="rows">
      <li v-for="po in list" :key="po.id">
        <RouterLink :to="`/purchases/${po.id}`" class="row-main">
          <div class="head">
            <span class="name">{{ po.supplierName ?? '未指定供应商' }}</span>
            <span class="badge" :class="po.status.toLowerCase()">{{ STATUS_LABEL[po.status] }}</span>
          </div>
          <div class="muted small">
            {{ po.orderedDay }}　{{ po.lineCount }} 项货品　已到 {{ fmt(po.receivedTotal) }} / {{ fmt(po.orderedTotal) }}
            <template v-if="po.orderNo">　单号 {{ po.orderNo }}</template>
          </div>
        </RouterLink>
      </li>
    </ul>
  </main>

  <div class="floating-actions" aria-label="采购单操作">
    <RouterLink to="/purchases/new" class="floating-action primary">
      <span class="floating-action-icon" aria-hidden="true">＋</span>
      <span>新建采购单</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.back {
  font-size: 26px;
  line-height: 1;
  color: var(--muted);
  padding: 0 6px 0 0;
}

.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin-top: 10px;
  scrollbar-width: none;
}

.chips::-webkit-scrollbar {
  display: none;
}

.chip {
  flex: none;
  padding: 7px 13px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--card);
  font-size: 13px;
  white-space: nowrap;
}

.chip.on {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.empty .btn {
  margin-top: 12px;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row-main {
  display: block;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 15px;
  font-weight: 600;
}

.badge {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--bg);
  color: var(--muted);
}

.badge.ordered {
  background: var(--warn-soft);
  color: var(--warn);
}

.badge.partial {
  background: var(--brand-soft);
  color: var(--brand);
}

.badge.received {
  background: var(--ok-soft);
  color: var(--ok);
}

.badge.cancelled {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
