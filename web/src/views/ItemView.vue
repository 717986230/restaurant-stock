<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, fmt, packSpec, packText, round3, type Item, type Move, type MoveKind } from '@/api';
import { toast, toastError } from '@/toast';
import ImagePicker from '@/components/ImagePicker.vue';
import MoveSheet from '@/components/MoveSheet.vue';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

const item = ref<Item | null>(null);
const moves = ref<Move[]>([]);
const loading = ref(true);

const sheetItem = ref<Item | null>(null);
const sheetKind = ref<MoveKind>('IN');

const KIND_LABEL: Record<MoveKind, string> = { IN: '入库', OUT: '出库', CHECK: '盘点' };

async function load() {
  try {
    const [it, ms] = await Promise.all([api.item(id), api.moves({ itemId: id, limit: 50 })]);
    item.value = it;
    moves.value = ms;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openSheet(kind: MoveKind) {
  sheetKind.value = kind;
  sheetItem.value = item.value;
}

async function undo(m: Move) {
  if (!confirm(`撤销这条${KIND_LABEL[m.kind]}记录（${fmt(Math.abs(m.qty))} ${m.unit}）？`)) return;
  try {
    await api.deleteMove(m.id);
    toast('已撤销');
    await load();
  } catch (e) {
    toastError(e);
  }
}

async function archive() {
  if (!item.value) return;
  if (!confirm(`下架「${item.value.name}」？历史流水会保留，之后重新添加同名货品可以恢复。`)) return;
  try {
    await api.deleteItem(id);
    toast('已下架');
    router.replace('/');
  } catch (e) {
    toastError(e);
  }
}

function timeOf(iso: string): string {
  // D1 返回的是 "YYYY-MM-DD HH:MM:SS"（UTC），补上 Z 才能按本地时区显示
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false }).slice(5);
}
</script>

<template>
  <header class="app-bar">
    <h1>
      <button class="back" @click="router.back()" aria-label="返回">‹</button>
      {{ item?.name ?? '货品' }}
    </h1>
  </header>

  <main v-if="loading" class="spinner">加载中…</main>
  <main v-else-if="!item" class="empty">货品不存在</main>

  <main v-else class="page">
    <div :class="['hero', item.status.toLowerCase()]">
      <div class="num">
        <strong>{{ fmt(item.stock) }}</strong>
        <span>{{ item.unit }}</span>
      </div>
      <div v-if="item.packSize" class="pack">
        <template v-if="packText(item.stock, item)">＝ {{ packText(item.stock, item) }}　</template>
        <span class="muted small">{{ packSpec(item) }}</span>
      </div>
      <div class="meta">
        <span v-if="item.status === 'OUT'" class="tag bad">库存已用光</span>
        <span v-else-if="item.status === 'LOW'" class="tag warn">库存不足，该补货了</span>
        <span v-else class="tag ok">库存正常</span>
        <span class="muted small">
          {{ item.category }}
          <template v-if="item.minStock > 0">　低于 {{ fmt(item.minStock) }} {{ item.unit }} 提醒</template>
          <template v-if="item.weeklyTarget > 0">　每周计划 {{ fmt(item.weeklyTarget) }} {{ item.unit }}</template>
          <template v-if="item.lastPrice != null">
            　最近进价 ¥{{ item.lastPrice }}/{{ item.unit }}
            <template v-if="item.packSize">（≈¥{{ fmt(round3(item.lastPrice * item.packSize)) }}/{{ item.packUnit }}）</template>
          </template>
        </span>
      </div>
    </div>

    <div class="row actions">
      <button class="btn btn-primary" @click="openSheet('IN')">＋ 入库</button>
      <button class="btn" @click="openSheet('OUT')">－ 出库</button>
    </div>

    <ImagePicker :item-id="item.id" :has-image="item.hasImage" @changed="(v) => item && (item.hasImage = v)" />

    <p v-if="item.note" class="note">{{ item.note }}</p>

    <h2 class="sec">出入库记录</h2>
    <p v-if="!moves.length" class="empty small">还没有记录</p>
    <ul v-else class="log">
      <li v-for="m in moves" :key="m.id">
        <span :class="['kind', m.kind.toLowerCase()]">{{ KIND_LABEL[m.kind] }}</span>
        <span class="delta" :class="{ minus: m.qty < 0 }">
          {{ m.qty > 0 ? '+' : '' }}{{ fmt(m.qty) }} {{ m.unit }}
        </span>
        <span class="detail muted small">
          {{ timeOf(m.createdAt) }}
          <template v-if="m.kind === 'CHECK' && m.countedQty != null">　盘后 {{ fmt(m.countedQty) }}</template>
          <template v-if="m.unitPrice != null">　¥{{ m.unitPrice }}</template>
          <template v-if="m.note">　{{ m.note }}</template>
        </span>
        <button class="undo" @click="undo(m)" aria-label="撤销">撤销</button>
      </li>
    </ul>

    <div class="row bottom">
      <RouterLink :to="`/items/${item.id}/edit`" class="btn">编辑档案</RouterLink>
      <button class="btn btn-danger" @click="archive">下架</button>
    </div>
  </main>

  <MoveSheet :item="sheetItem" :kind="sheetKind" @close="sheetItem = null" @saved="load" />
</template>

<style scoped>
.back {
  font-size: 26px;
  line-height: 1;
  color: var(--muted);
  padding: 0 6px 0 0;
}

.hero {
  border-radius: 16px;
  padding: 18px;
  background: var(--card);
  border: 1px solid var(--line);
  margin-bottom: 14px;
}

.hero.out {
  border-color: var(--danger);
  background: var(--danger-soft);
}

.hero.low {
  border-color: var(--warn);
  background: var(--warn-soft);
}

.num strong {
  font-size: 40px;
  font-weight: 680;
  line-height: 1;
}

.hero.out .num strong {
  color: var(--danger);
}

.num span {
  margin-left: 6px;
  color: var(--muted);
}

.pack {
  margin-top: 6px;
  font-size: 14px;
  color: var(--brand);
  font-weight: 600;
}

.meta {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.tag {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 9px;
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
.tag.ok {
  background: var(--ok-soft);
  color: var(--ok);
}

.actions {
  margin-bottom: 16px;
}

.note {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
  margin: 0 0 16px;
}

.sec {
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
  margin: 0 0 8px;
}

.log {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}

.log li {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.log li:last-child {
  border-bottom: none;
}

.kind {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--bg);
  color: var(--muted);
}

.kind.in {
  background: var(--ok-soft);
  color: var(--ok);
}
.kind.out {
  background: var(--brand-soft);
  color: var(--brand);
}

.delta {
  font-weight: 650;
  font-size: 15px;
  color: var(--ok);
}

.delta.minus {
  color: var(--brand);
}

/* 备注是有用信息（供应商、领用人），窄屏上宁可折行也不要截断成「老…」 */
.detail {
  min-width: 0;
  line-height: 1.5;
}

.undo {
  font-size: 12px;
  color: var(--muted);
  padding: 4px 6px;
}

.bottom {
  margin-bottom: 8px;
}

.bottom .btn {
  justify-content: center;
}
</style>
