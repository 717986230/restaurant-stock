<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, fmt, money, type SummaryBucket, type SummaryPeriod, type SummaryResult } from '@/api';
import { toastError } from '@/toast';

const router = useRouter();
const period = ref<SummaryPeriod>('month');
const data = ref<SummaryResult | null>(null);
const loading = ref(true);
/** 展开哪一期看明细。null 表示只看总表 */
const focus = ref<string | null>(null);

const TABS: { value: SummaryPeriod; label: string }[] = [
  { value: 'month', label: '月度' },
  { value: 'quarter', label: '季度' },
  { value: 'year', label: '年度' },
];

async function load() {
  loading.value = true;
  try {
    data.value = await api.purchaseSummary(period.value, focus.value ?? undefined);
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(period, () => {
  // 换了粒度，原来展开的那一期（比如 2026-09）在季度表里根本不存在
  focus.value = null;
  load();
});
watch(focus, load);

function toggle(key: string) {
  focus.value = focus.value === key ? null : key;
}

/** 2026-09 → 2026年9月，2026-Q3 → 2026年第3季度 */
function periodLabel(key: string): string {
  const quarter = key.match(/^(\d{4})-Q(\d)$/);
  if (quarter) return `${quarter[1]}年第${quarter[2]}季度`;
  const month = key.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${month[1]}年${Number(month[2])}月`;
  return `${key}年`;
}

function trendClass(b: SummaryBucket): string {
  if (b.delta === null || b.delta === 0) return '';
  return b.delta > 0 ? 'up' : 'down';
}

function trendText(b: SummaryBucket): string {
  if (b.delta === null) return '没有更早的数据可比';
  if (b.delta === 0) return `跟${periodLabel(b.prevKey!)}持平`;
  const dir = b.delta > 0 ? '多' : '少';
  const pct = b.deltaPct === null ? '' : `（${b.deltaPct > 0 ? '+' : ''}${fmt(b.deltaPct)}%）`;
  return `比${periodLabel(b.prevKey!)}${dir}花 ${money(Math.abs(b.delta))}${pct}`;
}

function exportUrl() {
  return `/api/receiving/summary/export.csv?period=${period.value}`;
}
</script>

<template>
  <header class="app-bar">
    <h1>
      <button class="back" @click="router.back()" aria-label="返回">‹</button>
      📊 采购汇总
    </h1>
    <div class="chips">
      <button
        v-for="t in TABS"
        :key="t.value"
        :class="['chip', { on: period === t.value }]"
        @click="period = t.value"
      >
        {{ t.label }}
      </button>
    </div>
  </header>

  <main v-if="loading && !data" class="spinner">加载中…</main>

  <main v-else-if="!data?.periods.length" class="empty">
    <p>还没有对货单，汇总表是空的</p>
    <p class="muted small">先去「对货记账」记几张单，这里就有数了。</p>
  </main>

  <main v-else class="page">
    <p class="muted small hint">
      按单据上的日期统计，不管结没结账。金额口径跟结账一致：<strong>实付</strong>是含税的、真正付出去的钱。
    </p>

    <ul class="rows">
      <li v-for="b in data.periods" :key="b.key">
        <button class="row-main" @click="toggle(b.key)">
          <div class="head">
            <span class="name">{{ periodLabel(b.key) }}</span>
            <span class="paid">{{ money(b.paid) }}</span>
          </div>
          <div class="muted small sub">
            {{ b.slipCount }} 张单　净额 {{ fmt(b.net) }}　税额 {{ fmt(b.tax) }}
          </div>
          <div :class="['trend', 'small', trendClass(b)]">{{ trendText(b) }}</div>
        </button>

        <div v-if="focus === b.key" class="detail">
          <template v-if="loading">
            <p class="muted small">加载中…</p>
          </template>

          <template v-else>
            <h3>按供应商</h3>
            <ul v-if="data.bySupplier?.length" class="mini">
              <li v-for="s in data.bySupplier" :key="s.name">
                <span class="mini-name">{{ s.name }}</span>
                <span class="mini-sub muted small">{{ s.slipCount }} 张</span>
                <span class="mini-amount">{{ money(s.paid) }}</span>
              </li>
            </ul>
            <p v-else class="muted small">这一期没有数据</p>

            <h3>按货品（花钱最多的在前）</h3>
            <ul v-if="data.byItem?.length" class="mini">
              <li v-for="it in data.byItem" :key="it.name">
                <span class="mini-name">{{ it.name }}</span>
                <span class="mini-sub muted small">{{ fmt(it.qty) }} · {{ it.lineCount }} 次</span>
                <span class="mini-amount">{{ fmt(it.amount) }}</span>
              </li>
            </ul>
            <p v-else class="muted small">这一期还没有货品明细</p>
            <p class="muted small note">
              货品名是从单据上认出来的，同一种货写法不一样（大小写、多个空格）会分成几行统计。
              另外这里是<strong>净额</strong>——明细列在发票上本来就不含税。
            </p>
          </template>
        </div>
      </li>
    </ul>

    <a class="btn btn-block export" :href="exportUrl()">↓ 导出 CSV 给会计</a>
  </main>
</template>

<style scoped>
.back {
  font-size: 26px;
  line-height: 1;
  color: var(--muted);
  padding: 0 6px 0 0;
}

.hint {
  margin: 0 0 12px;
  line-height: 1.6;
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

.rows > li {
  border-bottom: 1px solid var(--line);
}

.rows > li:last-child {
  border-bottom: none;
}

.row-main {
  display: block;
  width: 100%;
  text-align: left;
  padding: 12px;
  background: none;
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

.paid {
  font-size: 16px;
  font-weight: 700;
  color: var(--brand);
}

.sub {
  margin-top: 4px;
}

.trend {
  margin-top: 4px;
  color: var(--muted);
}

.trend.up {
  color: var(--brand);
}

.trend.down {
  color: #2e7d32;
}

.detail {
  padding: 0 12px 14px;
  background: var(--bg);
}

.detail h3 {
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
  margin: 14px 0 6px;
}

.mini {
  list-style: none;
  margin: 0;
  padding: 0;
}

.mini li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--line);
}

.mini li:last-child {
  border-bottom: none;
}

.mini-name {
  flex: 1;
  font-size: 14px;
  word-break: break-word;
}

.mini-sub {
  flex: none;
}

.mini-amount {
  flex: none;
  font-weight: 600;
  font-size: 14px;
}

.note {
  margin: 10px 0 0;
  line-height: 1.6;
}

.export {
  margin-top: 14px;
  text-align: center;
}
</style>
