<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, fmt, money, packSpec, round3, type PurchaseOrderDetail, type PurchaseOrderLine, type PurchaseStatus } from '@/api';
import { toast, toastError } from '@/toast';
import { askConfirm } from '@/confirm';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

const po = ref<PurchaseOrderDetail | null>(null);
const loading = ref(true);
const saving = ref(false);
const cancelling = ref(false);
/** 本场收货的幂等键，提交成功后作废 */
const submitId = ref<string | null>(null);
/** 每行「本次实收」的输入，进来时默认填剩余未到数量，照实改就行 */
const inputs = ref<Record<number, string>>({});

const STATUS_LABEL: Record<PurchaseStatus, string> = {
  ORDERED: '已下单',
  PARTIAL: '部分到货',
  RECEIVED: '已完成',
  CANCELLED: '已取消',
};

async function load() {
  try {
    const data = await api.purchase(id);
    po.value = data;
    const next: Record<number, string> = {};
    const receivable = data.status === 'ORDERED' || data.status === 'PARTIAL';
    for (const l of data.lines) {
      if (receivable && l.remainingQty > 0.0005) next[l.id] = String(l.remainingQty);
    }
    inputs.value = next;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const canReceive = computed(() => po.value && (po.value.status === 'ORDERED' || po.value.status === 'PARTIAL'));
const canCancel = computed(() => po.value && po.value.status === 'ORDERED' && po.value.receivedTotal <= 0.0005);

const pendingLines = computed(() => {
  if (!po.value) return [];
  return po.value.lines
    .map((l) => ({ line: l, qty: Number(inputs.value[l.id]) }))
    .filter((x) => inputs.value[x.line.id] !== undefined && inputs.value[x.line.id] !== '' && Number.isFinite(x.qty) && x.qty > 0);
});

function diffOf(line: PurchaseOrderLine): number | null {
  const raw = inputs.value[line.id];
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return round3(n - line.remainingQty);
}

async function submitReceive() {
  if (!pendingLines.value.length) {
    toastError(new Error('请至少填一项实收数量'));
    return;
  }
  if (!await askConfirm({
    title: `对货记账 ${pendingLines.value.length} 项？`,
    message: '提交后会按填写的实收数量记入库存流水，并更新这张采购单的到货进度。',
    confirmText: '确认入库',
  })) return;

  saving.value = true;
  try {
    submitId.value ??= crypto.randomUUID();
    const res = await api.receivePurchase(
      id,
      pendingLines.value.map((x) => ({ lineId: x.line.id, receivedQty: round3(x.qty) })),
      submitId.value,
    );
    toast(res.over ? '已记入库存，有几项实收比订购的还多，请留意' : '已记入库存');
    submitId.value = null;
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}

async function cancel() {
  if (!await askConfirm({
    title: '取消这张采购单？',
    message: '取消后不能恢复，还没到货的项也不会再提醒。',
    confirmText: '取消采购单',
    tone: 'danger',
  })) return;
  cancelling.value = true;
  try {
    await api.cancelPurchase(id);
    toast('已取消');
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    cancelling.value = false;
  }
}
</script>

<template>
  <header class="app-bar">
    <h1>
      <button class="back" @click="router.back()" aria-label="返回">‹</button>
      采购单详情
    </h1>
  </header>

  <main v-if="loading" class="spinner">加载中…</main>

  <main v-else-if="!po" class="empty">采购单不存在</main>

  <main v-else class="page" :class="{ 'pad-submit': canReceive }">
    <div class="summary">
      <div class="summary-head">
        <span class="name">{{ po.supplierName ?? '未指定供应商' }}</span>
        <span class="badge" :class="po.status.toLowerCase()">{{ STATUS_LABEL[po.status] }}</span>
      </div>
      <div class="muted small info-lines">
        <span>下单 {{ po.orderedDay }}</span>
        <span v-if="po.expectedDay">预计到货 {{ po.expectedDay }}</span>
        <span v-if="po.receivedDay">到货完成 {{ po.receivedDay }}</span>
        <span v-if="po.orderNo">单号 {{ po.orderNo }}</span>
      </div>
      <p v-if="po.note" class="muted small note">{{ po.note }}</p>
    </div>

    <h2 class="sec">
      货品明细（{{ po.lines.length }}）
      <span v-if="canReceive" class="muted small hint">填「本次实收」，对不上账面订购量也没关系，照实填</span>
    </h2>

    <ul class="lines">
      <li v-for="l in po.lines" :key="l.id">
        <div class="line-head">
          <span class="name">{{ l.itemName }}</span>
          <span class="qty muted small">订 {{ fmt(l.orderedQty) }} {{ l.unit }} ／ 已到 {{ fmt(l.receivedQty) }} {{ l.unit }}</span>
        </div>
        <p v-if="l.unitPrice != null" class="muted small">单价 {{ money(l.unitPrice) }} / {{ l.unit }}</p>

        <template v-if="canReceive && l.remainingQty > 0.0005">
          <div class="receive-row">
            <label class="box">
              <input
                v-model="inputs[l.id]"
                class="input num"
                type="number"
                inputmode="decimal"
                step="0.001"
                min="0"
                :aria-label="`${l.itemName}本次实收`"
              />
              <span>{{ l.unit }}</span>
            </label>
            <span class="muted small">还差 {{ fmt(l.remainingQty) }} {{ l.unit }}</span>
          </div>
          <p v-if="diffOf(l) !== null && Math.abs(diffOf(l)!) > 0.0005" class="diff-hint" :class="{ over: diffOf(l)! > 0 }">
            {{ diffOf(l)! > 0 ? `比剩余多 ${fmt(diffOf(l)!)}` : `比剩余少 ${fmt(Math.abs(diffOf(l)!))}` }} {{ l.unit }}
          </p>
        </template>
        <p v-else-if="l.remainingQty <= 0.0005" class="done muted small">已到齐</p>
      </li>
    </ul>

    <button v-if="canCancel" class="btn btn-danger btn-block cancel-btn" :disabled="cancelling" @click="cancel">
      {{ cancelling ? '取消中…' : '取消采购单' }}
    </button>
  </main>

  <div v-if="canReceive" class="submit-bar">
    <span class="muted small">已填 {{ pendingLines.length }} 项</span>
    <button class="btn btn-primary" :disabled="saving || !pendingLines.length" @click="submitReceive">
      {{ saving ? '提交中…' : '对货记账' }}
    </button>
  </div>
</template>

<style scoped>
.back {
  font-size: 26px;
  line-height: 1;
  color: var(--muted);
  padding: 0 6px 0 0;
}

.summary {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px;
  margin-bottom: 14px;
}

.summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.summary .name {
  font-size: 16px;
  font-weight: 650;
}

.badge {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--bg);
  color: var(--muted);
}

.badge.ordered {
  background: var(--warn-soft);
  color: var(--warn);
}

.badge.partial {
  background: var(--brand-soft);
  color: var(--brand);
}

.badge.received {
  background: var(--ok-soft);
  color: var(--ok);
}

.badge.cancelled {
  background: var(--danger-soft);
  color: var(--danger);
}

.info-lines {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 6px;
}

.note {
  margin: 8px 0 0;
}

.sec {
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
  margin: 0 0 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hint {
  font-weight: 400;
}

.pad-submit {
  padding-bottom: 76px;
}

.lines {
  list-style: none;
  margin: 0 0 16px;
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
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.line-head .name {
  font-size: 15px;
  font-weight: 600;
}

.receive-row {
  display: flex;
  align-items: center;
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

.diff-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--danger);
}

.diff-hint.over {
  color: var(--warn);
}

.done {
  margin: 6px 0 0;
  color: var(--ok);
}

.cancel-btn {
  margin-top: 4px;
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
