<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, fmt, packText, type Item, type MoveKind, type Summary } from '@/api';
import { toastError } from '@/toast';
import MoveSheet from '@/components/MoveSheet.vue';

const list = ref<Item[]>([]);
const categories = ref<string[]>([]);
const summary = ref<Summary | null>(null);
const q = ref('');
const category = ref('');
const onlyLow = ref(false);
const loading = ref(true);

const sheetItem = ref<Item | null>(null);
const sheetKind = ref<MoveKind>('IN');

async function load() {
  loading.value = true;
  try {
    const [items, sum] = await Promise.all([
      api.items({ q: q.value, category: category.value, low: onlyLow.value }),
      api.summary(),
    ]);
    list.value = items;
    summary.value = sum;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  try {
    categories.value = await api.categories();
  } catch {
    // 分类只是筛选用的辅助数据，取不到不影响主列表
  }
});

let debounce: ReturnType<typeof setTimeout>;
watch(q, () => {
  clearTimeout(debounce);
  debounce = setTimeout(load, 250);
});
watch([category, onlyLow], load);

// 按分类分组：找东西是按"包装耗材/酒水/饮料"找的，不是按拼音找的
const groups = computed(() => {
  const map = new Map<string, Item[]>();
  for (const it of list.value) {
    const arr = map.get(it.category) ?? [];
    arr.push(it);
    map.set(it.category, arr);
  }
  return [...map.entries()];
});

function openSheet(item: Item, kind: MoveKind) {
  sheetKind.value = kind;
  sheetItem.value = item;
}
</script>

<template>
  <header class="app-bar">
    <h1>📦 门店库存</h1>
    <div v-if="summary" class="stats">
      <span>共 {{ summary.items }} 项</span>
      <span v-if="summary.out" class="bad">用光 {{ summary.out }}</span>
      <span v-if="summary.low" class="warn">偏低 {{ summary.low }}</span>
      <span v-if="!summary.alerts" class="ok">库存都正常</span>
      <span class="muted">今日 入{{ summary.todayIn }} / 出{{ summary.todayOut }}</span>
    </div>

    <input v-model="q" class="input search" type="search" placeholder="搜货品名…" />

    <div class="chips">
      <button :class="['chip', { on: onlyLow }]" @click="onlyLow = !onlyLow">
        ⚠️ 只看告警<span v-if="summary?.alerts"> {{ summary.alerts }}</span>
      </button>
      <button :class="['chip', { on: category === '' }]" @click="category = ''">全部</button>
      <button
        v-for="c in categories"
        :key="c"
        :class="['chip', { on: category === c }]"
        @click="category = category === c ? '' : c"
      >
        {{ c }}
      </button>
    </div>
  </header>

  <main class="page">
    <div v-if="loading" class="spinner">加载中…</div>
    <div v-else-if="!list.length" class="empty">
      <p>没有符合条件的货品</p>
      <RouterLink to="/items/new" class="btn btn-primary">新增货品</RouterLink>
    </div>

    <section v-for="[name, arr] in groups" v-else :key="name" class="group">
      <h2>{{ name }}<span class="muted small"> · {{ arr.length }}</span></h2>

      <ul class="items">
        <li v-for="it in arr" :key="it.id" :class="['item', it.status.toLowerCase()]">
          <RouterLink :to="`/items/${it.id}`" class="main">
            <div class="thumb">
              <img v-if="it.hasImage" :src="`/api/items/${it.id}/image`" :alt="it.name" loading="lazy" />
              <span v-else>📦</span>
            </div>
            <div class="info">
              <div class="name">
                {{ it.name }}
                <span v-if="it.status === 'OUT'" class="tag bad">已用光</span>
                <span v-else-if="it.status === 'LOW'" class="tag warn">库存不足</span>
              </div>
              <div class="qty">
                <strong>{{ fmt(it.stock) }}</strong> {{ it.unit }}
                <span v-if="packText(it.stock, it)" class="pack">＝ {{ packText(it.stock, it) }}</span>
                <span v-if="it.minStock > 0" class="muted small">／低于 {{ fmt(it.minStock) }} 提醒</span>
              </div>
            </div>
          </RouterLink>

          <div class="ops">
            <button class="op in" @click="openSheet(it, 'IN')" aria-label="入库">＋</button>
            <button class="op out" @click="openSheet(it, 'OUT')" aria-label="出库">－</button>
          </div>
        </li>
      </ul>
    </section>
  </main>

  <RouterLink to="/items/new" class="fab" aria-label="新增货品">＋</RouterLink>

  <MoveSheet :item="sheetItem" :kind="sheetKind" @close="sheetItem = null" @saved="load" />
</template>

<style scoped>
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 13px;
  margin: 8px 0 10px;
  color: var(--muted);
}

.stats .bad {
  color: var(--danger);
  font-weight: 600;
}
.stats .warn {
  color: var(--warn);
  font-weight: 600;
}
.stats .ok {
  color: var(--ok);
}

.search {
  margin-bottom: 10px;
}

.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
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

.group {
  margin-bottom: 20px;
}

.group h2 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  display: flex;
  align-items: stretch;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}

/* 库存告警：整行左侧亮红边 + 淡红底，扫一眼就能挑出来 */
.item.out {
  border-color: var(--danger);
  background: var(--danger-soft);
  box-shadow: inset 4px 0 0 var(--danger);
}

.item.low {
  border-color: var(--warn);
  background: var(--warn-soft);
  box-shadow: inset 4px 0 0 var(--warn);
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
}

.thumb {
  width: 46px;
  height: 46px;
  flex: none;
  border-radius: 10px;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 20px;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.info {
  min-width: 0;
}

.name {
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
}

.tag.bad {
  background: var(--danger);
  color: #fff;
}

.tag.warn {
  background: var(--warn);
  color: #fff;
}

.qty {
  margin-top: 3px;
  font-size: 13px;
  color: var(--muted);
}

.qty strong {
  font-size: 17px;
  color: var(--text);
}

.pack {
  color: var(--brand);
  font-weight: 600;
  margin-left: 2px;
}

.item.out .qty strong {
  color: var(--danger);
}

.ops {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--line);
}

.op {
  width: 52px;
  flex: 1;
  font-size: 20px;
  font-weight: 600;
}

.op.in {
  color: var(--ok);
  border-bottom: 1px solid var(--line);
}

.op.out {
  color: var(--brand);
}

.fab {
  position: fixed;
  right: 16px;
  bottom: calc(var(--nav-h) + 16px);
  z-index: 25;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-size: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(179, 35, 31, 0.4);
}
</style>
