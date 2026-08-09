<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, fmt, type Item } from '@/api';
import { toast, toastError } from '@/toast';

const categories = ref<string[]>([]);
const category = ref('');
const list = ref<Item[]>([]);
const counted = ref<Record<number, string>>({});
const loading = ref(true);
const saving = ref(false);

async function load() {
  loading.value = true;
  try {
    list.value = await api.items({ category: category.value });
    counted.value = {};
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
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

/** 只提交真正数过的行：空着的表示这次没盘，不能当成 0 */
const pending = computed(() =>
  list.value
    .map((it) => ({ it, value: counted.value[it.id] }))
    .filter(({ value }) => value !== undefined && value !== '' && Number.isFinite(Number(value)))
    .map(({ it, value }) => ({ it, qty: Number(value), diff: Number(value) - it.stock })),
);

async function submit() {
  if (!pending.value.length) {
    toastError(new Error('还没有填任何实际数量'));
    return;
  }
  const changed = pending.value.filter((p) => Math.abs(p.diff) > 0.0005);
  if (!confirm(`提交 ${pending.value.length} 项盘点，其中 ${changed.length} 项与账面对不上，确定？`)) return;

  saving.value = true;
  let ok = 0;
  try {
    // 逐条提交：一条失败不影响已经存进去的，重试时把剩下的补上就行
    for (const p of pending.value) {
      await api.createMove({ itemId: p.it.id, kind: 'CHECK', countedQty: p.qty, note: '盘点' });
      ok++;
    }
    toast(`已盘 ${ok} 项`);
    await load();
  } catch (e) {
    toastError(e);
    if (ok > 0) await load();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <header class="app-bar">
    <h1>🧮 盘点</h1>
    <p class="muted small hint">数一遍实际有多少，填进去。系统自动算出差额并记一笔盘点流水。</p>
    <div class="chips">
      <button :class="['chip', { on: category === '' }]" @click="category = ''">全部</button>
      <button
        v-for="c in categories"
        :key="c"
        :class="['chip', { on: category === c }]"
        @click="category = c"
      >
        {{ c }}
      </button>
    </div>
  </header>

  <main class="page">
    <div v-if="loading" class="spinner">加载中…</div>
    <div v-else-if="!list.length" class="empty">这个分类下没有货品</div>

    <ul v-else class="rows">
      <li v-for="it in list" :key="it.id">
        <div class="left">
          <span class="name">{{ it.name }}</span>
          <span class="muted small">账面 {{ fmt(it.stock) }} {{ it.unit }}</span>
        </div>
        <input
          v-model="counted[it.id]"
          class="input num"
          type="number"
          inputmode="decimal"
          step="0.001"
          min="0"
          :placeholder="fmt(it.stock)"
        />
        <span
          class="diff"
          :class="{
            plus: counted[it.id] !== undefined && counted[it.id] !== '' && Number(counted[it.id]) - it.stock > 0.0005,
            minus: counted[it.id] !== undefined && counted[it.id] !== '' && Number(counted[it.id]) - it.stock < -0.0005,
          }"
        >
          <template v-if="counted[it.id] !== undefined && counted[it.id] !== '' && Number.isFinite(Number(counted[it.id]))">
            {{ Number(counted[it.id]) - it.stock > 0 ? '+' : '' }}{{ fmt(Math.round((Number(counted[it.id]) - it.stock) * 1000) / 1000) }}
          </template>
        </span>
      </li>
    </ul>
  </main>

  <div v-if="pending.length" class="submit-bar">
    <span class="muted small">已填 {{ pending.length }} 项</span>
    <button class="btn btn-primary" :disabled="saving" @click="submit">
      {{ saving ? '提交中…' : '提交盘点' }}
    </button>
  </div>
</template>

<style scoped>
.hint {
  margin: 6px 0 10px;
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
  display: grid;
  grid-template-columns: 1fr 96px 52px;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line);
}

.rows li:last-child {
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

.num {
  padding: 9px 10px;
  text-align: center;
}

.diff {
  font-size: 13px;
  font-weight: 650;
  text-align: right;
  color: var(--muted);
}

.diff.plus {
  color: var(--ok);
}

.diff.minus {
  color: var(--danger);
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
