<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api, fmt, money, today, type ReceivingSlip } from '@/api';
import { toast, toastError } from '@/toast';

const router = useRouter();
const list = ref<ReceivingSlip[]>([]);
const loading = ref(true);
const tab = ref<'0' | '1'>('0');
const creating = ref(false);

async function load() {
  try {
    list.value = await api.receivingSlips(tab.value === '0' ? 0 : 1);
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(tab, load);

async function createNew() {
  creating.value = true;
  try {
    const res = await api.createReceivingSlip({ day: today() });
    router.push(`/receiving/${res.id}`);
  } catch (e) {
    toastError(e);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <header class="app-bar">
    <div class="title-row">
      <h1>📎 对货记账</h1>
      <span class="head-links">
        <RouterLink to="/summary" class="to-settlement">📊 汇总</RouterLink>
        <RouterLink to="/settlement" class="to-settlement">💰 结账</RouterLink>
      </span>
    </div>
    <div class="chips">
      <button :class="['chip', { on: tab === '0' }]" @click="tab = '0'">待结账</button>
      <button :class="['chip', { on: tab === '1' }]" @click="tab = '1'">已结账</button>
    </div>
  </header>

  <main class="page with-floating-action">
    <div v-if="loading" class="spinner">加载中…</div>
    <div v-else-if="!list.length" class="empty">
      <p>{{ tab === '0' ? '还没有待结账的对货单' : '还没有已结账的对货单' }}</p>
      <button v-if="tab === '0'" class="btn btn-primary" :disabled="creating" @click="createNew">拍一张对货单</button>
    </div>

    <ul v-else class="rows">
      <li v-for="s in list" :key="s.id">
        <RouterLink :to="`/receiving/${s.id}`" class="row-main">
          <div class="head">
            <span class="name">{{ s.supplierName ?? '未填供应商' }}</span>
            <span v-if="s.totalAmount != null" class="amount">{{ money(s.totalAmount) }}</span>
          </div>
          <div class="muted small">
            {{ s.slipDay }}　{{ s.lineCount }} 项货品　{{ s.imageCount }} 张照片
            <template v-if="!s.lineCount">　还没识别/填表</template>
          </div>
        </RouterLink>
      </li>
    </ul>
  </main>

  <div v-if="tab === '0'" class="floating-actions" aria-label="对货单操作">
    <button class="floating-action primary" :disabled="creating" @click="createNew">
      <span class="floating-action-icon" aria-hidden="true">📷</span>
      <span>{{ creating ? '创建中…' : '拍对货单' }}</span>
    </button>
  </div>
</template>

<style scoped>
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.head-links {
  flex: none;
  display: flex;
  gap: 14px;
}

.to-settlement {
  flex: none;
  color: var(--brand);
  font-size: 14px;
  font-weight: 600;
}

.chips {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.chip {
  flex: none;
  padding: 7px 13px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--card);
  font-size: 13px;
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
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 15px;
  font-weight: 600;
}

.amount {
  flex: none;
  color: var(--brand);
  font-weight: 650;
}
</style>
