<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, fmt, packSpec, type Item, type Supplier } from '@/api';
import { toast, toastError } from '@/toast';

const router = useRouter();

const suppliers = ref<Supplier[]>([]);
const supplierName = ref('');
const orderNo = ref('');
const expectedDay = ref('');
const note = ref('');
const saving = ref(false);

const items = ref<Item[]>([]);
const itemQuery = ref('');

interface LineDraft {
  itemId: number;
  name: string;
  unit: string;
  packSize: number | null;
  packUnit: string | null;
  qty: string;
  unitPrice: string;
}
const lines = ref<LineDraft[]>([]);

onMounted(async () => {
  try {
    [suppliers.value, items.value] = await Promise.all([api.suppliers(), api.items()]);
  } catch (e) {
    toastError(e);
  }
});

const matchedSupplier = computed(() => suppliers.value.find((s) => s.name === supplierName.value.trim()) ?? null);

function addItem() {
  const name = itemQuery.value.trim();
  if (!name) return;
  const it = items.value.find((i) => i.name === name);
  if (!it) {
    toastError(new Error('请从列表里选一个已有货品'));
    return;
  }
  if (lines.value.some((l) => l.itemId === it.id)) {
    toastError(new Error('已经添加过这件货品了'));
    return;
  }
  lines.value.push({
    itemId: it.id,
    name: it.name,
    unit: it.unit,
    packSize: it.packSize,
    packUnit: it.packUnit,
    qty: '',
    unitPrice: '',
  });
  itemQuery.value = '';
}

function removeLine(itemId: number) {
  lines.value = lines.value.filter((l) => l.itemId !== itemId);
}

async function save() {
  if (!lines.value.length) {
    toastError(new Error('请至少添加一项货品'));
    return;
  }
  const payload = lines.value.map((l) => ({
    itemId: l.itemId,
    orderedQty: Number(l.qty),
    unitPrice: l.unitPrice === '' ? null : Number(l.unitPrice),
  }));
  const bad = payload.find((l) => !Number.isFinite(l.orderedQty) || l.orderedQty <= 0);
  if (bad) {
    toastError(new Error('每项货品都要填订购数量'));
    return;
  }
  saving.value = true;
  try {
    const res = await api.createPurchase({
      supplierId: matchedSupplier.value?.id ?? null,
      orderNo: orderNo.value.trim() || null,
      expectedDay: expectedDay.value || null,
      note: note.value.trim() || null,
      lines: payload,
    });
    toast('采购单已创建');
    router.replace(`/purchases/${res.id}`);
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
      新建采购单
    </h1>
  </header>

  <main class="page">
    <label class="field">
      <span>供应商（可不填）</span>
      <input v-model="supplierName" class="input" list="supplier-options" placeholder="从下单联系人里选，或直接留空" />
      <datalist id="supplier-options">
        <option v-for="s in suppliers" :key="s.id" :value="s.name" />
      </datalist>
    </label>

    <label class="field">
      <span>采购单号（可不填）</span>
      <input v-model="orderNo" class="input" placeholder="供应商给的单号，方便日后核对" />
    </label>

    <label class="field">
      <span>预计到货日（可不填）</span>
      <input v-model="expectedDay" class="input" type="date" />
    </label>

    <div class="field">
      <span>货品明细</span>
      <div class="add-row">
        <input v-model="itemQuery" class="input" list="item-options" placeholder="搜货品名，选中后点添加" @keyup.enter="addItem" />
        <datalist id="item-options">
          <option v-for="it in items" :key="it.id" :value="it.name" />
        </datalist>
        <button class="btn" @click="addItem">添加</button>
      </div>

      <ul v-if="lines.length" class="lines">
        <li v-for="l in lines" :key="l.itemId">
          <div class="line-head">
            <span class="name">{{ l.name }}</span>
            <button class="rm" @click="removeLine(l.itemId)" aria-label="移除">✕</button>
          </div>
          <div class="line-inputs">
            <label class="box">
              <input
                v-model="l.qty"
                class="input num"
                type="number"
                inputmode="decimal"
                step="0.001"
                min="0"
                placeholder="0"
                :aria-label="`${l.name}订购数量`"
              />
              <span>{{ l.unit }}</span>
            </label>
            <label class="box">
              <input
                v-model="l.unitPrice"
                class="input num"
                type="number"
                inputmode="decimal"
                step="0.01"
                min="0"
                placeholder="单价可不填"
                :aria-label="`${l.name}单价`"
              />
            </label>
          </div>
          <p v-if="l.packSize" class="muted small">{{ packSpec(l) }}</p>
        </li>
      </ul>
      <p v-else class="muted small">还没有添加货品</p>
    </div>

    <label class="field">
      <span>备注（可不填）</span>
      <textarea v-model="note" class="input" rows="2"></textarea>
    </label>

    <button class="btn btn-primary btn-block" :disabled="saving" @click="save">
      {{ saving ? '保存中…' : '创建采购单' }}
    </button>
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

textarea.input {
  resize: vertical;
}

.add-row {
  display: flex;
  gap: 8px;
}

.add-row .input {
  flex: 1;
  min-width: 0;
}

.add-row .btn {
  flex: none;
}

.lines {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}

.lines li {
  padding: 12px;
  border-bottom: 1px solid var(--line);
}

.lines li:last-child {
  border-bottom: none;
}

.line-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.line-head .name {
  font-size: 15px;
  font-weight: 600;
}

.rm {
  color: var(--muted);
  font-size: 14px;
  padding: 2px 6px;
}

.line-inputs {
  display: flex;
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
  width: 110px;
  padding: 9px 8px;
  text-align: center;
}
</style>
