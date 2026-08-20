<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, fmt, money, today, type Move, type MoveKind } from '@/api';
import { toast, toastError } from '@/toast';
import { askConfirm } from '@/confirm';

const day = ref(today());
const moves = ref<Move[]>([]);
const loading = ref(true);
/** 首屏之外的刷新：保留旧内容，只压暗，不清空 */
const refreshing = ref(false);

const KIND_LABEL: Record<MoveKind, string> = { IN: '入库', OUT: '出库', CHECK: '盘点' };

async function load() {
  if (loading.value) refreshing.value = false;
  else refreshing.value = true;
  try {
    moves.value = await api.moves({ day: day.value, limit: 300 });
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

onMounted(load);
watch(day, load);

function shiftDay(delta: number) {
  const d = new Date(`${day.value}T12:00:00`);
  d.setDate(d.getDate() + delta);
  day.value = d.toISOString().slice(0, 10);
}

const totals = computed(() => {
  let inCount = 0;
  let outCount = 0;
  let cost = 0;
  for (const m of moves.value) {
    if (m.kind === 'IN') {
      inCount++;
      if (m.unitPrice != null) cost += m.unitPrice * m.qty;
    } else if (m.kind === 'OUT') {
      outCount++;
    }
  }
  return { inCount, outCount, cost: Math.round(cost * 100) / 100 };
});

async function undo(m: Move) {
  if (!await askConfirm({
    title: `撤销${KIND_LABEL[m.kind]}记录？`,
    message: `「${m.itemName}」这笔流水将被移除，库存会自动重新计算。`,
    confirmText: '确认撤销',
    tone: 'danger',
  })) return;
  try {
    await api.deleteMove(m.id);
    toast('已撤销');
    await load();
  } catch (e) {
    toastError(e);
  }
}

function timeOf(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5);
}
</script>

<template>
  <header class="app-bar">
    <h1>📒 出入库流水</h1>
    <div class="daybar">
      <button class="nav" @click="shiftDay(-1)" aria-label="前一天">‹</button>
      <input v-model="day" class="input date" type="date" />
      <button class="nav" :disabled="day >= today()" @click="shiftDay(1)" aria-label="后一天">›</button>
    </div>
    <div class="stats muted small">
      入库 {{ totals.inCount }} 笔 · 出库 {{ totals.outCount }} 笔
      <span v-if="totals.cost > 0">· 当日进货金额 {{ money(totals.cost) }}</span>
    </div>
  </header>

  <main :class="['page', { 'is-refreshing': refreshing }]">
    <div v-if="loading" class="spinner">加载中…</div>
    <div v-else-if="!moves.length" class="empty">这一天没有记录</div>

    <ul v-else class="log">
      <li v-for="m in moves" :key="m.id">
        <RouterLink :to="`/items/${m.itemId}`" class="left">
          <span class="name">{{ m.itemName }}</span>
          <span class="detail muted small">
            {{ timeOf(m.createdAt) }}　{{ KIND_LABEL[m.kind] }}
            <template v-if="m.kind === 'CHECK' && m.countedQty != null">　盘后 {{ fmt(m.countedQty) }}</template>
            <template v-if="m.unitPrice != null">　{{ money(m.unitPrice) }}/{{ m.unit }}</template>
            <template v-if="m.note">　{{ m.note }}</template>
          </span>
        </RouterLink>
        <span class="delta" :class="{ minus: m.qty < 0 }">
          {{ m.qty > 0 ? '+' : '' }}{{ fmt(m.qty) }} {{ m.unit }}
        </span>
        <button class="undo" :aria-label="`撤销${m.itemName}${KIND_LABEL[m.kind]}记录`" @click="undo(m)">撤销</button>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.daybar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 6px;
}

.nav {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid var(--line);
  font-size: 20px;
  color: var(--muted);
}

.nav:disabled {
  opacity: 0.35;
}

.date {
  flex: 1;
  text-align: center;
}

.log {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}

.log li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--line);
}

.log li:last-child {
  border-bottom: none;
}

.left {
  min-width: 0;
}

.name {
  display: block;
  font-size: 15px;
  font-weight: 600;
}

.detail {
  display: block;
  margin-top: 2px;
  line-height: 1.5;
}

.delta {
  font-weight: 650;
  font-size: 15px;
  color: var(--ok);
  white-space: nowrap;
}

.delta.minus {
  color: var(--brand);
}

.undo {
  font-size: 12px;
  color: var(--muted);
  padding: 4px 2px;
}
</style>
