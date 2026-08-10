<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, fmt, money, packText, type Item, type MoveKind, type Summary } from '@/api';
import { toast, toastError } from '@/toast';
import MoveSheet from '@/components/MoveSheet.vue';
import { askConfirm } from '@/confirm';

const list = ref<Item[]>([]);
const categories = ref<string[]>([]);
const summary = ref<Summary | null>(null);
const q = ref('');
const category = ref('');
const onlyLow = ref(false);
const loading = ref(true);
const selecting = ref(false);
const selected = ref(new Set<number>());
const deleting = ref(false);

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
  if (selecting.value) selected.value = new Set();
  debounce = setTimeout(() => void load(), 250);
});
watch([category, onlyLow], () => {
  if (selecting.value) selected.value = new Set();
  void load();
});

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

const allVisibleSelected = computed(
  () => list.value.length > 0 && list.value.every((item) => selected.value.has(item.id)),
);

function beginSelection() {
  selecting.value = true;
  selected.value = new Set();
}

function endSelection() {
  selecting.value = false;
  selected.value = new Set();
}

function toggleSelection(id: number) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleAllVisible() {
  const next = new Set(selected.value);
  if (allVisibleSelected.value) {
    for (const item of list.value) next.delete(item.id);
  } else {
    for (const item of list.value) next.add(item.id);
  }
  selected.value = next;
}

function handleItemClick(event: MouseEvent, id: number) {
  if (!selecting.value) return;
  event.preventDefault();
  toggleSelection(id);
}

async function bulkArchive() {
  const ids = [...selected.value];
  if (!ids.length || deleting.value) return;
  if (!await askConfirm({
    title: `下架选中的 ${ids.length} 个货品？`,
    message: '这些货品将从库存列表隐藏，历史流水和图片仍会保留。重新添加同名货品可以恢复。',
    confirmText: `下架 ${ids.length} 项`,
    tone: 'danger',
  })) return;

  deleting.value = true;
  try {
    const result = await api.bulkDeleteItems(ids);
    toast(`已下架 ${result.archived} 个货品`);
    endSelection();
    await load();
    categories.value = await api.categories();
  } catch (e) {
    toastError(e);
  } finally {
    deleting.value = false;
  }
}

function openSheet(item: Item, kind: MoveKind) {
  sheetKind.value = kind;
  sheetItem.value = item;
}
</script>

<template>
  <header class="app-bar">
    <div class="title-row">
      <h1>📦 门店库存</h1>
      <button v-if="!selecting" class="manage" @click="beginSelection">批量管理</button>
      <button v-else class="manage" @click="endSelection">完成</button>
    </div>
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

    <div v-if="selecting" class="select-tools">
      <button :disabled="!list.length" @click="toggleAllVisible">
        {{ allVisibleSelected ? '取消全选' : `全选当前 ${list.length} 项` }}
      </button>
      <span>已选 {{ selected.size }} 项</span>
    </div>
  </header>

  <main :class="['page', 'with-floating-action', { selecting }]">
    <div v-if="loading" class="spinner">加载中…</div>
    <div v-else-if="!list.length" class="empty">
      <p>没有符合条件的货品</p>
      <RouterLink to="/items/new" class="btn btn-primary">新增货品</RouterLink>
    </div>

    <section v-for="[name, arr] in groups" v-else :key="name" class="group">
      <h2>{{ name }}<span class="muted small"> · {{ arr.length }}</span></h2>

      <ul class="items">
        <li
          v-for="it in arr"
          :key="it.id"
          :class="['item', it.status.toLowerCase(), { selected: selected.has(it.id) }]"
        >
          <RouterLink
            :to="`/items/${it.id}`"
            class="main"
            @click="handleItemClick($event, it.id)"
          >
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
              <div v-if="it.lastPrice != null || it.locationName" class="details">
                <span v-if="it.lastPrice != null">最近进价 {{ money(it.lastPrice) }} / {{ it.unit }}</span>
                <span v-if="it.locationName">位置 {{ it.locationName }}</span>
              </div>
            </div>
          </RouterLink>

          <button
            v-if="selecting"
            class="selector"
            :class="{ checked: selected.has(it.id) }"
            :aria-label="selected.has(it.id) ? `取消选择${it.name}` : `选择${it.name}`"
            @click="toggleSelection(it.id)"
          >
            <span class="checkmark" aria-hidden="true">{{ selected.has(it.id) ? '✓' : '' }}</span>
          </button>
          <div v-else class="ops">
            <button class="op in" @click="openSheet(it, 'IN')" :aria-label="`${it.name}入库`">＋</button>
            <button class="op out" @click="openSheet(it, 'OUT')" :aria-label="`${it.name}出库`">－</button>
          </div>
        </li>
      </ul>
    </section>
  </main>

  <div v-if="!selecting" class="floating-actions" aria-label="库存操作">
    <RouterLink to="/items/new" class="floating-action primary">
      <span class="floating-action-icon" aria-hidden="true">＋</span>
      <span>新增</span>
    </RouterLink>
  </div>

  <div v-if="selecting" class="bulk-bar" role="toolbar" aria-label="批量管理货品">
    <button class="btn" @click="endSelection">取消</button>
    <span>已选 <strong>{{ selected.size }}</strong> 项</span>
    <button class="btn btn-danger" :disabled="!selected.size || deleting" @click="bulkArchive">
      {{ deleting ? '下架中…' : '批量下架' }}
    </button>
  </div>

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

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.manage {
  min-height: 36px;
  padding: 7px 10px;
  color: var(--brand);
  font-size: 14px;
  font-weight: 600;
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

.select-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
}

.select-tools button {
  color: var(--brand);
  font-weight: 600;
}

.select-tools button:disabled {
  opacity: 0.45;
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

.item.selected {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px var(--brand-soft);
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

.details {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 12px;
  margin-top: 3px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
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

.selector {
  width: 58px;
  flex: none;
  border-left: 1px solid var(--line);
  display: grid;
  place-items: center;
}

.checkmark {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--line);
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
}

.selector.checked .checkmark {
  background: var(--brand);
  border-color: var(--brand);
}

.selecting {
  padding-bottom: 96px;
}

.bulk-bar {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(var(--nav-h) + 10px);
  z-index: 28;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  max-width: 720px;
  margin: 0 auto;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
}

.bulk-bar span {
  text-align: center;
  font-size: 14px;
}

.bulk-bar .btn {
  min-height: 42px;
  padding: 9px 13px;
  font-size: 14px;
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

</style>
