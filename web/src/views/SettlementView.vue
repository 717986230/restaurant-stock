<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, fmt, money, today, type Settlement, type SettlementStatus } from '@/api';
import { toast, toastError } from '@/toast';
import { askConfirm } from '@/confirm';

const router = useRouter();
const status = ref<SettlementStatus | null>(null);
const history = ref<Settlement[]>([]);
const loading = ref(true);
const toDay = ref(today());
const settling = ref(false);

async function load() {
  try {
    [status.value, history.value] = await Promise.all([api.settlementStatus(toDay.value), api.settlements()]);
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
// 改结账日期就要重算待结账张数，页面上的数字得跟点下去真正会结的那批对上
watch(toDay, load);

function downloadUrl(id: number) {
  return `/api/receiving/settlements/${id}/export.csv`;
}

async function settle() {
  if (!status.value?.pendingCount) return;
  if (!await askConfirm({
    title: `结账到 ${toDay.value}？`,
    message: `会把 ${status.value.pendingCount} 张还没结账的对货单打包导出，结完账的单据不能再改。`,
    confirmText: '确认结账',
  })) return;

  settling.value = true;
  try {
    const res = await api.createSettlement(toDay.value);
    toast(`已结账 ${res.slipCount} 张，共 ${money(res.totalAmount)}`);
    window.location.href = downloadUrl(res.id);
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    settling.value = false;
  }
}
</script>

<template>
  <header class="app-bar">
    <h1>
      <button class="back" @click="router.back()" aria-label="返回">‹</button>
      💰 结账
    </h1>
  </header>

  <main v-if="loading" class="spinner">加载中…</main>

  <main v-else class="page">
    <div class="status-card">
      <div class="row-line">
        <span class="muted small">上次结账日期</span>
        <strong>{{ status?.lastSettledDay ?? '还没结过账' }}</strong>
      </div>
      <div class="row-line">
        <span class="muted small">待结账对货单</span>
        <strong :class="{ urgent: status && status.pendingCount > 0 }">{{ status?.pendingCount ?? 0 }} 张</strong>
      </div>
      <div class="row-line">
        <span class="muted small">待结账金额</span>
        <strong>{{ money(status?.pendingTotal ?? 0) }}</strong>
      </div>
    </div>

    <p class="muted small hint">
      结账只会打包「还没结过账」的对货单，已经结过的不会重复导出，放心选日期。
    </p>

    <label class="field">
      <span>结到哪一天（含当天）</span>
      <input v-model="toDay" class="input" type="date" :max="today()" />
    </label>

    <button class="btn btn-primary btn-block" :disabled="settling || !status?.pendingCount" @click="settle">
      {{ settling ? '结账中…' : status?.pendingCount ? `结账并导出 ${status.pendingCount} 张` : '没有可结账的对货单' }}
    </button>

    <h2 class="sec">历史结账记录</h2>
    <ul v-if="history.length" class="rows">
      <li v-for="h in history" :key="h.id">
        <div class="head">
          <span class="name">{{ h.fromDay ? `${h.fromDay} 之后` : '首次结账' }} ～ {{ h.toDay }}</span>
          <a class="dl" :href="downloadUrl(h.id)">↓ 下载</a>
        </div>
        <div class="muted small">{{ h.slipCount }} 张对货单　合计 {{ money(h.totalAmount) }}</div>
      </li>
    </ul>
    <p v-else class="muted small">还没有结账记录</p>
  </main>
</template>

<style scoped>
.back {
  font-size: 26px;
  line-height: 1;
  color: var(--muted);
  padding: 0 6px 0 0;
}

.status-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.row-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.row-line strong {
  font-size: 15px;
}

.row-line strong.urgent {
  color: var(--brand);
}

.hint {
  margin: 0 0 14px;
  line-height: 1.6;
}

.sec {
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
  margin: 22px 0 8px;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}

.rows li {
  padding: 12px;
  border-bottom: 1px solid var(--line);
}

.rows li:last-child {
  border-bottom: none;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 14px;
  font-weight: 600;
}

.dl {
  flex: none;
  color: var(--brand);
  font-weight: 600;
  font-size: 13px;
}
</style>
