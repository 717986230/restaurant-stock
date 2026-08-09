<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { api, fmt, type Item, type MoveKind } from '@/api';
import { toast, toastError } from '@/toast';

const props = defineProps<{ item: Item | null; kind: MoveKind }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const qty = ref('');
const unitPrice = ref('');
const note = ref('');
const saving = ref(false);
const qtyInput = ref<HTMLInputElement | null>(null);

const title = computed(() => (props.kind === 'IN' ? '入库' : '出库 / 领用'));

// 出库不能凭空多出来：预估一下这笔记完之后还剩多少，让人在按确定之前就看见
const preview = computed(() => {
  if (!props.item) return null;
  const n = Number(qty.value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return props.item.stock + (props.kind === 'IN' ? n : -n);
});

watch(
  () => props.item,
  async (item) => {
    if (!item) return;
    qty.value = '';
    note.value = '';
    unitPrice.value = props.kind === 'IN' && item.lastPrice != null ? String(item.lastPrice) : '';
    await nextTick();
    qtyInput.value?.focus();
  },
);

async function submit() {
  if (!props.item) return;
  const n = Number(qty.value);
  if (!Number.isFinite(n) || n <= 0) {
    toastError(new Error('请输入数量'));
    return;
  }
  saving.value = true;
  try {
    const res = await api.createMove({
      itemId: props.item.id,
      kind: props.kind,
      qty: n,
      unitPrice: props.kind === 'IN' && unitPrice.value ? Number(unitPrice.value) : null,
      note: note.value || null,
    });
    const warn = res.status === 'OUT' ? '，已用光！' : res.status === 'LOW' ? '，库存偏低' : '';
    toast(`${res.itemName} 现有 ${fmt(res.stock)} ${res.unit}${warn}`);
    emit('saved');
    emit('close');
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="item" class="mask" @click.self="emit('close')">
        <div class="sheet">
          <header>
            <div>
              <strong>{{ title }}</strong>
              <div class="muted small">{{ item.name }}　当前 {{ fmt(item.stock) }} {{ item.unit }}</div>
            </div>
            <button class="x" @click="emit('close')" aria-label="关闭">✕</button>
          </header>

          <label class="field">
            <span>数量（{{ item.unit }}）</span>
            <input
              ref="qtyInput"
              v-model="qty"
              class="input qty"
              type="number"
              inputmode="decimal"
              step="0.001"
              min="0"
              placeholder="0"
              @keyup.enter="submit"
            />
          </label>

          <label v-if="kind === 'IN'" class="field">
            <span>进价（元 / {{ item.unit }}，可不填）</span>
            <input v-model="unitPrice" class="input" type="number" inputmode="decimal" step="0.01" min="0" />
          </label>

          <label class="field">
            <span>备注（可不填）</span>
            <input v-model="note" class="input" :placeholder="kind === 'IN' ? '供应商 / 单号' : '用途 / 领用人'" />
          </label>

          <p v-if="preview !== null" class="preview" :class="{ neg: preview < 0 }">
            记完还剩 <strong>{{ fmt(preview) }}</strong> {{ item.unit }}
            <span v-if="preview < 0">（会记成负数，先确认是不是漏记了入库）</span>
          </p>

          <button class="btn btn-primary btn-block" :disabled="saving" @click="submit">
            {{ saving ? '保存中…' : '确定' }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
}

.sheet {
  width: 100%;
  background: var(--card);
  border-radius: 18px 18px 0 0;
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
  max-height: 88dvh;
  overflow-y: auto;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

header strong {
  font-size: 17px;
}

.x {
  font-size: 18px;
  color: var(--muted);
  padding: 4px 8px;
}

.qty {
  font-size: 30px;
  font-weight: 650;
  text-align: center;
  letter-spacing: 0.5px;
}

.preview {
  margin: 0 0 14px;
  font-size: 14px;
  color: var(--muted);
}

.preview.neg {
  color: var(--danger);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.22s ease;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.22s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
