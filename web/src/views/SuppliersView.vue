<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Supplier } from '@/api';
import { toast, toastError } from '@/toast';
import { askConfirm } from '@/confirm';
import SupplierSheet from '@/components/SupplierSheet.vue';

const router = useRouter();
const list = ref<Supplier[]>([]);
const loading = ref(true);
const sheetOpen = ref(false);
const editing = ref<Supplier | null>(null);

async function load() {
  try {
    list.value = await api.suppliers();
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openNew() {
  editing.value = null;
  sheetOpen.value = true;
}

function openEdit(s: Supplier) {
  editing.value = s;
  sheetOpen.value = true;
}

async function archive(s: Supplier) {
  if (!await askConfirm({
    title: `删除供应商「${s.name}」？`,
    message: '已经下过的采购单仍会保留这个名字，只是以后新建采购单选不到它了。',
    confirmText: '删除',
    tone: 'danger',
  })) return;
  try {
    await api.archiveSupplier(s.id);
    toast('已删除');
    await load();
  } catch (e) {
    toastError(e);
  }
}
</script>

<template>
  <header class="app-bar">
    <h1>
      <button class="back" @click="router.back()" aria-label="返回">‹</button>
      🚚 供应商
    </h1>
  </header>

  <main class="page with-floating-action">
    <div v-if="loading" class="spinner">加载中…</div>
    <div v-else-if="!list.length" class="empty">
      <p>还没有供应商</p>
      <button class="btn btn-primary" @click="openNew">新增供应商</button>
    </div>

    <ul v-else class="rows">
      <li v-for="s in list" :key="s.id">
        <button class="row-main" @click="openEdit(s)">
          <span class="name">{{ s.name }}</span>
          <span v-if="s.contactName || s.phone" class="muted small">
            {{ [s.contactName, s.phone].filter(Boolean).join(' · ') }}
          </span>
        </button>
        <button class="del" @click="archive(s)" aria-label="删除">🗑</button>
      </li>
    </ul>
  </main>

  <div class="floating-actions" aria-label="供应商操作">
    <button class="floating-action primary" @click="openNew">
      <span class="floating-action-icon" aria-hidden="true">＋</span>
      <span>新增</span>
    </button>
  </div>

  <SupplierSheet :open="sheetOpen" :supplier="editing" @close="sheetOpen = false" @saved="load" />
</template>

<style scoped>
.back {
  font-size: 26px;
  line-height: 1;
  color: var(--muted);
  padding: 0 6px 0 0;
}

.empty .btn {
  margin-top: 12px;
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
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--line);
}

.rows li:last-child {
  border-bottom: none;
}

.row-main {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 13px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font-size: 15px;
  font-weight: 600;
}

.del {
  flex: none;
  width: 50px;
  color: var(--danger);
  border-left: 1px solid var(--line);
}
</style>
