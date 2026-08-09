<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import { toast, toastError } from '@/toast';

const route = useRoute();
const router = useRouter();
const id = route.params.id ? Number(route.params.id) : null;
const isNew = computed(() => id === null);

const name = ref('');
const category = ref('');
const unit = ref('斤');
const minStock = ref('0');
const note = ref('');
const categories = ref<string[]>([]);
const saving = ref(false);
const loading = ref(!!id);

const UNITS = ['斤', '公斤', '克', '个', '只', '把', '袋', '箱', '瓶', '桶', '盒', '块', '提', '捆', '份'];

onMounted(async () => {
  try {
    categories.value = await api.categories();
    if (!isNew.value) category.value = '';
    else category.value = categories.value[0] ?? '其他';
  } catch {
    // 分类拉不到就让用户自己填
  }
  if (id !== null) {
    try {
      const it = await api.item(id);
      name.value = it.name;
      category.value = it.category;
      unit.value = it.unit;
      minStock.value = String(it.minStock);
      note.value = it.note ?? '';
    } catch (e) {
      toastError(e);
    } finally {
      loading.value = false;
    }
  }
});

async function save() {
  if (!name.value.trim()) {
    toastError(new Error('请填货品名称'));
    return;
  }
  saving.value = true;
  const body = {
    name: name.value.trim(),
    category: category.value.trim() || '其他',
    unit: unit.value.trim() || '斤',
    minStock: Number(minStock.value) || 0,
    note: note.value.trim() || null,
  };
  try {
    if (id === null) {
      const res = await api.createItem(body);
      toast(res.restored ? '已恢复此前下架的货品' : '已添加');
      router.replace(`/items/${res.id}`);
    } else {
      await api.updateItem(id, body);
      toast('已保存');
      router.back();
    }
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <header class="app-bar">
    <h1>
      <button class="back" @click="router.back()" aria-label="返回">‹</button>
      {{ isNew ? '新增货品' : '编辑档案' }}
    </h1>
  </header>

  <main v-if="loading" class="spinner">加载中…</main>

  <main v-else class="page">
    <label class="field">
      <span>货品名称</span>
      <input v-model="name" class="input" placeholder="比如：五花肉" />
    </label>

    <label class="field">
      <span>分类</span>
      <input v-model="category" class="input" list="category-options" placeholder="肉类 / 蔬菜 / 调料…" />
      <datalist id="category-options">
        <option v-for="c in categories" :key="c" :value="c" />
      </datalist>
    </label>

    <label class="field">
      <span>计量单位</span>
      <select v-model="unit" class="input">
        <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
      </select>
    </label>

    <label class="field">
      <span>低库存阈值（{{ unit }}）</span>
      <input v-model="minStock" class="input" type="number" inputmode="decimal" step="0.001" min="0" />
      <small class="muted">结存降到这个数以下，列表里会标红提醒。填 0 表示只在用光时提醒。</small>
    </label>

    <label class="field">
      <span>备注（可不填）</span>
      <textarea v-model="note" class="input" rows="2" placeholder="常用供应商、存放位置…"></textarea>
    </label>

    <button class="btn btn-primary btn-block" :disabled="saving" @click="save">
      {{ saving ? '保存中…' : '保存' }}
    </button>

    <p v-if="isNew" class="muted small tip">保存后可以在详情页给它拍照上传图片。</p>
  </main>
</template>

<style scoped>
.back {
  font-size: 26px;
  line-height: 1;
  color: var(--muted);
  padding: 0 6px 0 0;
}

.field small {
  display: block;
  margin-top: 6px;
  font-size: 12px;
}

textarea.input {
  resize: vertical;
}

.tip {
  margin-top: 14px;
  text-align: center;
}
</style>
