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
const unit = ref('箱');
const packSize = ref('');
const packUnit = ref('箱');
const minStock = ref('0');
const note = ref('');
const categories = ref<string[]>([]);
const saving = ref(false);
const loading = ref(!!id);

const PACK_UNITS = ['箱', '件', '提', '打', '包', '捆', '板'];

// 常用的排前面：外卖店进货以箱、捆、包、卷为主，重量单位反而少用
const UNITS = ['箱', '捆', '包', '卷', '提', '盒', '袋', '瓶', '听', '桶', '个', '条', '打', '份', '斤', '公斤', '克'];

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
      packSize.value = it.packSize == null ? '' : String(it.packSize);
      packUnit.value = it.packUnit ?? '箱';
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
    unit: unit.value.trim() || '箱',
    // 留空 / 填 0 都表示这件东西不做换算
    packSize: Number(packSize.value) > 0 ? Number(packSize.value) : null,
    packUnit: packUnit.value,
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
      <input v-model="name" class="input" placeholder="比如：外卖盒 大" />
    </label>

    <label class="field">
      <span>分类</span>
      <input v-model="category" class="input" list="category-options" placeholder="包装耗材 / 酒水 / 饮料…" />
      <datalist id="category-options">
        <option v-for="c in categories" :key="c" :value="c" />
      </datalist>
    </label>

    <label class="field">
      <span>基本单位（库存按它计数）</span>
      <select v-model="unit" class="input">
        <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
      </select>
    </label>

    <div class="field">
      <span>整箱规格（酒水饮料填这个，系统自动换算）</span>
      <div class="pack-row">
        <span class="fixed">1</span>
        <select v-model="packUnit" class="input">
          <option v-for="u in PACK_UNITS" :key="u" :value="u">{{ u }}</option>
        </select>
        <span class="fixed">=</span>
        <input v-model="packSize" class="input" type="number" inputmode="numeric" step="1" min="0" placeholder="24" />
        <span class="fixed">{{ unit }}</span>
      </div>
      <small class="muted">
        比如一箱可乐 24 瓶就填 24。填了之后，入库可以直接按{{ packUnit }}录，列表会显示「共 96 {{ unit }} ＝ 4
        {{ packUnit }}」。不用换算就留空。
      </small>
    </div>

    <label class="field">
      <span>低库存阈值（{{ unit }}）</span>
      <input v-model="minStock" class="input" type="number" inputmode="decimal" step="0.001" min="0" />
      <small class="muted">结存降到这个数以下，列表里会标红提醒。填 0 表示只在用光时提醒。</small>
    </label>

    <label class="field">
      <span>备注（可不填）</span>
      <textarea v-model="note" class="input" rows="2" placeholder="常用供应商、规格、存放位置…"></textarea>
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

.field > span {
  display: block;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 6px;
}

.field small {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
}

.pack-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pack-row .fixed {
  flex: none;
  color: var(--muted);
  font-size: 15px;
}

.pack-row select.input {
  flex: 0 0 84px;
  padding: 12px 8px;
}

.pack-row input.input {
  flex: 1;
  min-width: 0;
  text-align: center;
}

textarea.input {
  resize: vertical;
}

.tip {
  margin-top: 14px;
  text-align: center;
}
</style>
