<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, fmt, packSpec, packText, round3, type Item } from '@/api';
import { toast, toastError } from '@/toast';
import { askConfirm } from '@/confirm';

const categories = ref<string[]>([]);
const category = ref('');
const list = ref<Item[]>([]);
/**
 * 见过的所有货品，跨分类累积。
 * 盘点是"走一圈把每个架子数一遍"，中途必然要切分类；
 * 只留当前分类的话，切走就找不回刚才数的是哪件东西了。
 */
const known = ref<Map<number, Item>>(new Map());
/** 每行两个输入框：整箱数和散装数。酒水饮料点货时本来就是「3 箱零 5 瓶」这么数的。 */
const counted = ref<Record<number, { box: string; base: string }>>({});
const loading = ref(true);
/** 首屏之外的刷新：保留旧内容，只压暗，不清空 */
const refreshing = ref(false);
const saving = ref(false);
/** 本场盘点的幂等键，提交成功后作废 */
const submitId = ref<string | null>(null);
const q = ref('');

/** 只过滤显示，不影响已填的数字——搜完清空搜索框，填过的还在 */
const visible = computed(() => {
  const kw = q.value.trim();
  return kw ? list.value.filter((it) => it.name.includes(kw)) : list.value;
});

function cell(id: number) {
  return (counted.value[id] ??= { box: '', base: '' });
}

async function load() {
  if (loading.value) refreshing.value = false;
  else refreshing.value = true;
  try {
    const items = await api.items({ category: category.value });
    list.value = items;
    // 不清 counted：切分类不该把已经数好的数字抹掉
    const merged = new Map(known.value);
    for (const it of items) merged.set(it.id, it);
    known.value = merged;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

onMounted(async () => {
  try {
    categories.value = await api.categories();
    category.value = categories.value[0] ?? '';
  } catch {
    // 没有分类就盘全部
  }
  await load();
});

watch(category, load);

/** 两个框都空着表示这行没盘，不能当成 0 —— 那会把满仓的货直接清零 */
function totalOf(it: Item, c: { box: string; base: string } | undefined): number | null {
  if (!c || (c.box === '' && c.base === '')) return null;
  const box = c.box === '' ? 0 : Number(c.box);
  const base = c.base === '' ? 0 : Number(c.base);
  if (!Number.isFinite(box) || !Number.isFinite(base) || box < 0 || base < 0) return null;
  return round3(box * (it.packSize ?? 0) + base);
}

function total(it: Item): number | null {
  return totalOf(it, counted.value[it.id]);
}

interface PendingRow {
  it: Item;
  qty: number;
  diff: number;
}

/** 从已填的数字反推，而不是从当前分类的列表——否则切走的分类就提交不上了 */
const pending = computed<PendingRow[]>(() => {
  const rows: PendingRow[] = [];
  for (const [key, c] of Object.entries(counted.value)) {
    const it = known.value.get(Number(key));
    if (!it) continue;
    const qty = totalOf(it, c);
    if (qty === null) continue;
    rows.push({ it, qty, diff: round3(qty - it.stock) });
  }
  return rows;
});

/** 已填但不在当前屏幕上的项数，提交前要让人知道自己交的不止眼前这些 */
const pendingElsewhere = computed(() => {
  const here = new Set(list.value.map((it) => it.id));
  return pending.value.filter((p) => !here.has(p.it.id)).length;
});

async function submit() {
  if (!pending.value.length) {
    toastError(new Error('还没有填任何实际数量'));
    return;
  }
  const changed = pending.value.filter((p) => Math.abs(p.diff) > 0.0005);
  if (!await askConfirm({
    title: `提交 ${pending.value.length} 项盘点？`,
    message: `${changed.length} 项与账面数量不同。提交后会为每件货品生成盘点流水并更新库存。`,
    confirmText: '提交盘点',
  })) return;

  saving.value = true;
  try {
    // 整场一个请求：后厨信号不稳时，宁可整场失败重来，也不要盘到一半——
    // 半场盘点会让日均消耗的锚点错位，算出来的消耗速度是假的
    // 同一场盘点复用同一个 id：超时后重试不会记成两场。成功后才作废。
    submitId.value ??= crypto.randomUUID();
    const res = await api.submitStocktake(
      pending.value.map((p) => ({ itemId: p.it.id, countedQty: p.qty })),
      submitId.value,
    );
    toast(res.changed ? `已盘 ${res.counted} 项，${res.changed} 项对不上账已修正` : `已盘 ${res.counted} 项，全部对得上`);
    counted.value = {};
    submitId.value = null;
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <header class="app-bar">
    <h1>🧮 盘点</h1>
    <p class="muted small hint">数一遍实际有多少，填进去。系统自动算出差额并记一笔盘点流水。</p>
    <input v-model="q" class="input search" type="search" placeholder="搜货品名…" />

    <div class="chips">
      <button :class="['chip', { on: category === '' }]" @click="category = ''">全部</button>
      <button v-for="c in categories" :key="c" :class="['chip', { on: category === c }]" @click="category = c">
        {{ c }}
      </button>
    </div>
  </header>

  <main :class="['page', { 'is-refreshing': refreshing }]">
    <div v-if="loading" class="spinner">加载中…</div>
    <div v-else-if="!list.length" class="empty">这个分类下没有货品</div>
    <div v-else-if="!visible.length" class="empty">没有匹配「{{ q }}」的货品</div>

    <ul v-else class="rows">
      <li v-for="it in visible" :key="it.id">
        <div class="head">
          <span class="name">{{ it.name }}</span>
          <span class="diff" :class="{ plus: (total(it) ?? it.stock) - it.stock > 0.0005, minus: (total(it) ?? it.stock) - it.stock < -0.0005 }">
            <template v-if="total(it) !== null">
              {{ total(it)! - it.stock > 0 ? '+' : '' }}{{ fmt(round3(total(it)! - it.stock)) }} {{ it.unit }}
            </template>
          </span>
        </div>

        <div class="line muted small">
          账面 {{ fmt(it.stock) }} {{ it.unit }}
          <template v-if="packText(it.stock, it)">（{{ packText(it.stock, it) }}）</template>
          <template v-if="it.packSize">　{{ packSpec(it) }}</template>
        </div>

        <div class="inputs">
          <label v-if="it.packSize" class="box">
            <input
              v-model="cell(it.id).box"
              class="input num"
              type="number"
              inputmode="numeric"
              step="1"
              min="0"
              placeholder="0"
              :aria-label="`${it.name}整${it.packUnit}数量`"
            />
            <span>{{ it.packUnit }}</span>
          </label>
          <label class="box">
            <input
              v-model="cell(it.id).base"
              class="input num"
              type="number"
              inputmode="decimal"
              step="0.001"
              min="0"
              placeholder="0"
              :aria-label="`${it.name}${it.unit}数量`"
            />
            <span>{{ it.unit }}</span>
          </label>
          <span v-if="it.packSize && total(it) !== null" class="sum">共 {{ fmt(total(it)!) }} {{ it.unit }}</span>
        </div>
      </li>
    </ul>
  </main>

  <div v-if="pending.length" class="submit-bar">
    <span class="muted small">
      已填 {{ pending.length }} 项
      <template v-if="pendingElsewhere">（含其他分类 {{ pendingElsewhere }} 项）</template>
    </span>
    <button class="btn btn-primary" :disabled="saving" @click="submit">
      {{ saving ? '提交中…' : '提交盘点' }}
    </button>
  </div>
</template>

<style scoped>
.hint {
  margin: 6px 0 10px;
}

.search {
  margin-bottom: 10px;
}

.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
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

.rows {
  list-style: none;
  margin: 0 0 72px;
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
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.name {
  font-size: 15px;
  font-weight: 600;
}

.diff {
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
}

.diff.plus {
  color: var(--ok);
}

.diff.minus {
  color: var(--danger);
}

.line {
  margin-top: 2px;
  line-height: 1.5;
}

.inputs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.box {
  display: flex;
  align-items: center;
  gap: 6px;
}

.box span {
  font-size: 14px;
  color: var(--muted);
}

.num {
  width: 84px;
  padding: 9px 8px;
  text-align: center;
}

.sum {
  flex: 1 1 100%;
  font-size: 13px;
  color: var(--brand);
  font-weight: 600;
}

.submit-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: var(--nav-h);
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--card);
  border-top: 1px solid var(--line);
}
</style>
