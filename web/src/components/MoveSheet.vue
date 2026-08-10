<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { api, currentUser, fmt, money, packSpec, packText, round3, type Item, type MoveKind } from '@/api';
import { toast, toastError } from '@/toast';

const props = defineProps<{ item: Item | null; kind: MoveKind }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const qty = ref('');
const unitPrice = ref('');
const note = ref('');
const saving = ref(false);
const qtyInput = ref<HTMLInputElement | null>(null);
/** 这次按「箱」还是按「瓶」录入。进货按箱、领用按瓶，所以两边默认值不一样。 */
const byPack = ref(false);

const title = computed(() => (props.kind === 'IN' ? '入库' : '出库 / 领用'));
const canPack = computed(() => Boolean(props.item?.packSize));
const entryUnit = computed(() => (byPack.value && props.item ? props.item.packUnit! : (props.item?.unit ?? '')));

/** 无论按哪个单位录入，存进数据库的永远是基本单位的数量 */
const qtyBase = computed(() => {
  const n = Number(qty.value);
  if (!Number.isFinite(n) || n <= 0 || !props.item) return null;
  return byPack.value ? round3(n * props.item.packSize!) : round3(n);
});

// 出库不能凭空多出来：预估一下这笔记完之后还剩多少，让人在按确定之前就看见
const preview = computed(() => {
  if (!props.item || qtyBase.value === null) return null;
  return round3(props.item.stock + (props.kind === 'IN' ? qtyBase.value : -qtyBase.value));
});

watch(
  () => props.item,
  async (item) => {
    if (!item) return;
    qty.value = '';
    note.value = '';
    // 进货是整箱来的，领用是一瓶一瓶拿的
    byPack.value = Boolean(item.packSize) && props.kind === 'IN';
    unitPrice.value = '';
    await nextTick();
    qtyInput.value?.focus();
  },
);

// 切换箱/瓶时清掉进价：同一个数字在两种单位下含义差着几十倍，留着容易记错账
watch(byPack, () => (unitPrice.value = ''));

async function submit() {
  if (!props.item) return;
  if (qtyBase.value === null) {
    toastError(new Error('请输入数量'));
    return;
  }
  saving.value = true;
  try {
    const price = Number(unitPrice.value);
    const hasPrice = props.kind === 'IN' && unitPrice.value !== '' && Number.isFinite(price) && price >= 0;
    const res = await api.createMove({
      itemId: props.item.id,
      kind: props.kind,
      qty: qtyBase.value,
      // 进价一律折成「每个基本单位多少钱」再存，不然按箱记和按瓶记的价没法比
      unitPrice: hasPrice ? (byPack.value ? round3(price / props.item.packSize!) : price) : null,
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
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="move-sheet-title">
          <header>
            <div>
              <strong id="move-sheet-title">{{ title }}</strong>
              <div class="muted small">
              {{ item.name }}　当前 {{ fmt(item.stock) }} {{ item.unit }}
              <template v-if="packText(item.stock, item)">（{{ packText(item.stock, item) }}）</template>
            </div>
            </div>
            <button class="x" @click="emit('close')" aria-label="关闭">✕</button>
          </header>

          <div class="field">
            <div class="label-row">
              <span>数量（{{ entryUnit }}）</span>
              <div v-if="canPack" class="seg">
                <button :class="{ on: byPack }" @click="byPack = true">按{{ item.packUnit }}</button>
                <button :class="{ on: !byPack }" @click="byPack = false">按{{ item.unit }}</button>
              </div>
            </div>
            <input
              ref="qtyInput"
              v-model="qty"
              class="input qty"
              type="number"
              inputmode="decimal"
              step="0.001"
              min="0"
              placeholder="0"
              :aria-label="`${item.name}${title}数量（${entryUnit}）`"
              @keyup.enter="submit"
            />
            <p v-if="canPack" class="conv">
              {{ packSpec(item) }}
              <template v-if="byPack && qtyBase !== null">
                　→ 本次 <strong>{{ fmt(qtyBase) }} {{ item.unit }}</strong>
              </template>
            </p>
          </div>

          <label v-if="kind === 'IN'" class="field">
            <span>进价（{{ currentUser?.currency ?? 'EUR' }} / {{ entryUnit }}，可不填）</span>
            <input v-model="unitPrice" class="input" type="number" inputmode="decimal" step="0.01" min="0" />
            <p v-if="byPack && Number(unitPrice) > 0" class="conv">
              折合 {{ money(round3(Number(unitPrice) / item.packSize!)) }} / {{ item.unit }}
            </p>
          </label>

          <label class="field">
            <span>备注（可不填）</span>
            <input v-model="note" class="input" :placeholder="kind === 'IN' ? '供应商 / 单号' : '用途 / 领用人'" />
          </label>

          <p v-if="preview !== null" class="preview" :class="{ neg: preview < 0 }">
            记完还剩 <strong>{{ fmt(preview) }}</strong> {{ item.unit }}
            <template v-if="packText(preview, item)">＝ {{ packText(preview, item) }}</template>
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

.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.label-row > span {
  font-size: 13px;
  color: var(--muted);
}

.seg {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 9px;
  overflow: hidden;
}

.seg button {
  padding: 5px 12px;
  font-size: 13px;
  color: var(--muted);
  background: var(--card);
}

.seg button.on {
  background: var(--brand);
  color: #fff;
  font-weight: 600;
}

.conv {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--muted);
}

.conv strong {
  color: var(--brand);
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
