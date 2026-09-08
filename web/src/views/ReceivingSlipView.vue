<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api, fmt, money, round3, today, type ReceivingImageKind, type ReceivingSlipDetail } from '@/api';
import { shrinkImage } from '@/image';
import { toast, toastError } from '@/toast';
import { askConfirm } from '@/confirm';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

const slip = ref<ReceivingSlipDetail | null>(null);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const recognizing = ref(false);
const uploading = ref<ReceivingImageKind | null>(null);

const day = ref('');
const supplierName = ref('');
const invoiceNo = ref('');
const note = ref('');
// 单据上印的三个数，一律照抄不反算：各档税额分别四舍五入，
// 净额+税额未必正好等于总计（差一两分是常态），而付款要照单据付。
const netAmount = ref('');
const taxAmount = ref('');
const grossAmount = ref('');

function numOrNull(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

interface RowDraft {
  itemName: string;
  qty: string;
  unit: string;
  unitPrice: string;
  amount: string;
  note: string;
}
const rows = ref<RowDraft[]>([]);

const slipFileInput = ref<HTMLInputElement | null>(null);
const goodsFileInput = ref<HTMLInputElement | null>(null);

const readOnly = computed(() => slip.value?.settled ?? false);
const slipImages = computed(() => slip.value?.images.filter((im) => im.kind === 'SLIP') ?? []);
const goodsImages = computed(() => slip.value?.images.filter((im) => im.kind === 'GOODS') ?? []);

const total = computed(() =>
  round3(rows.value.reduce((sum, r) => sum + (amountOf(r) ?? 0), 0)),
);

function amountOf(r: RowDraft): number | null {
  if (r.amount !== '') {
    const n = Number(r.amount);
    return Number.isFinite(n) ? n : null;
  }
  const qty = Number(r.qty);
  const price = Number(r.unitPrice);
  if (r.qty !== '' && r.unitPrice !== '' && Number.isFinite(qty) && Number.isFinite(price)) return round3(qty * price);
  return null;
}

/** 进结账的金额：单据印了含税总计就用它，没印才退回明细之和 */
const payable = computed(() => numOrNull(grossAmount.value) ?? total.value);

/**
 * 明细之和该等于单据上的净额。对不上通常是 AI 少认了一行、或者数字认错，
 * 这种错等到结账那天再翻就来不及了，所以保存前就要说。
 * 一分钱以内不算——单据自己也有四舍五入的零头。
 */
const netMismatch = computed(() => {
  const stated = numOrNull(netAmount.value);
  if (stated === null || !rows.value.length) return null;
  const diff = round3(total.value - stated);
  return Math.abs(diff) > 0.011 ? { stated, summed: total.value, diff } : null;
});

/** 表单当前内容的快照，跟上次保存时的比一比就知道有没有没存的改动 */
function snapshot(): string {
  return JSON.stringify({
    day: day.value,
    supplierName: supplierName.value.trim(),
    invoiceNo: invoiceNo.value.trim(),
    netAmount: netAmount.value.trim(),
    taxAmount: taxAmount.value.trim(),
    grossAmount: grossAmount.value.trim(),
    note: note.value.trim(),
    rows: rows.value,
  });
}
const savedSnapshot = ref('');
const dirty = computed(() => !readOnly.value && snapshot() !== savedSnapshot.value);
/** 删除后是主动跳走的，别再拦一次"还没保存" */
const skipLeaveGuard = ref(false);

async function load() {
  try {
    const data = await api.receivingSlip(id);
    slip.value = data;
    day.value = data.slipDay;
    supplierName.value = data.supplierName ?? '';
    invoiceNo.value = data.invoiceNo ?? '';
    netAmount.value = data.netAmount == null ? '' : String(data.netAmount);
    taxAmount.value = data.taxAmount == null ? '' : String(data.taxAmount);
    grossAmount.value = data.grossAmount == null ? '' : String(data.grossAmount);
    note.value = data.note ?? '';
    rows.value = data.lines.map((l) => ({
      itemName: l.itemName,
      qty: l.qty == null ? '' : String(l.qty),
      unit: l.unit ?? '',
      unitPrice: l.unitPrice == null ? '' : String(l.unitPrice),
      amount: l.amount == null ? '' : String(l.amount),
      note: l.note ?? '',
    }));
    savedSnapshot.value = snapshot();
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// 后厨误触返回、或者顺手点了底部导航，改了一半的表格就没了。
// 这里拦的是所有离开方式（返回键、底部标签页），不只是左上角那个箭头。
onBeforeRouteLeave(async () => {
  if (skipLeaveGuard.value || !dirty.value) return true;
  return await askConfirm({
    title: '还没保存，确定离开？',
    message: '刚改的内容会丢掉，回来要重新填一遍。',
    confirmText: '直接离开',
    tone: 'danger',
  });
});

function addRow() {
  rows.value.push({ itemName: '', qty: '', unit: '', unitPrice: '', amount: '', note: '' });
}

function removeRow(i: number) {
  rows.value.splice(i, 1);
}

async function uploadPhoto(e: Event, kind: ReceivingImageKind) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !slip.value) return;
  uploading.value = kind;
  try {
    await api.uploadReceivingImage(id, kind, await shrinkImage(file));
    await load();
    toast('照片已保存');
  } catch (err) {
    toastError(err);
  } finally {
    uploading.value = null;
    if (slipFileInput.value) slipFileInput.value.value = '';
    if (goodsFileInput.value) goodsFileInput.value.value = '';
  }
}

async function removePhoto(imageId: number) {
  if (!await askConfirm({ title: '删除这张照片？', message: '删除后无法恢复。', confirmText: '删除', tone: 'danger' })) return;
  try {
    await api.deleteReceivingImage(id, imageId);
    await load();
  } catch (e) {
    toastError(e);
  }
}

/**
 * AI 识别只是给一份草稿，不会自动保存——认错字总会有，识别完还要人核对一遍再点保存。
 * 一次把当前所有"对货单照片"都传给后端，单据分好几页拍的也能拼成一张表。
 */
async function recognize() {
  if (!slipImages.value.length) return;
  recognizing.value = true;
  try {
    const res = await api.recognizeReceivingSlip(id, slipImages.value.map((im) => im.id));
    if (res.supplierName && !supplierName.value.trim()) supplierName.value = res.supplierName;
    if (res.invoiceNo && !invoiceNo.value.trim()) invoiceNo.value = res.invoiceNo;
    if (res.day) day.value = res.day;
    if (res.netAmount != null) netAmount.value = String(res.netAmount);
    if (res.taxAmount != null) taxAmount.value = String(res.taxAmount);
    if (res.grossAmount != null) grossAmount.value = String(res.grossAmount);
    if (res.lines.length) {
      rows.value = res.lines.map((l) => ({
        itemName: l.itemName,
        qty: l.qty == null ? '' : String(l.qty),
        unit: l.unit ?? '',
        unitPrice: l.unitPrice == null ? '' : String(l.unitPrice),
        amount: l.amount == null ? '' : String(l.amount),
        note: '',
      }));
      toast(
        res.failedCount
          ? `识别到 ${res.lines.length} 项（有 ${res.failedCount} 张照片没认出来），核对无误后记得保存`
          : `识别到 ${res.lines.length} 项，核对无误后记得保存`,
      );
    } else {
      toast('没识别出货品行，麻烦手动填一下');
    }
  } catch (e) {
    toastError(e);
  } finally {
    recognizing.value = false;
  }
}

async function save() {
  const lines = rows.value
    .filter((r) => r.itemName.trim())
    .map((r) => ({
      itemName: r.itemName.trim(),
      qty: r.qty === '' ? null : Number(r.qty),
      unit: r.unit.trim() || null,
      unitPrice: r.unitPrice === '' ? null : Number(r.unitPrice),
      amount: amountOf(r),
      note: r.note.trim() || null,
    }));

  // 保存是整张替换明细：误删了行、或者 AI 识别把手改过的内容覆盖了，存下去就定了。
  // 所以这里把「实际要付多少」摆出来，让人在写进账之前最后核一眼。
  const parts = [
    lines.length ? `共 ${lines.length} 项货品` : '还没填货品明细',
    `实付 ${money(payable.value)}`,
  ];
  if (netMismatch.value) {
    parts.push(
      `⚠️ 明细加起来是 ${money(netMismatch.value.summed)}，但单据上的净额是 ${money(netMismatch.value.stated)}，` +
        `差 ${money(Math.abs(netMismatch.value.diff))}。多半是有一行没认出来或数字认错了，建议先核对。`,
    );
  }
  if (!await askConfirm({
    title: '保存这张对货单？',
    message: `${parts.join('，')}。实付金额会进结账单。`,
    confirmText: netMismatch.value ? '仍然保存' : '确认保存',
    tone: netMismatch.value ? 'danger' : undefined,
  })) return;

  saving.value = true;
  try {
    await api.updateReceivingSlip(id, {
      day: day.value,
      supplierName: supplierName.value.trim() || null,
      invoiceNo: invoiceNo.value.trim() || null,
      netAmount: numOrNull(netAmount.value),
      taxAmount: numOrNull(taxAmount.value),
      grossAmount: numOrNull(grossAmount.value),
      note: note.value.trim() || null,
      lines,
    });
    toast('已保存');
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!await askConfirm({ title: '删除这张对货单？', message: '照片和表格都会一起删掉，不能恢复。', confirmText: '删除', tone: 'danger' })) return;
  deleting.value = true;
  try {
    await api.deleteReceivingSlip(id);
    toast('已删除');
    skipLeaveGuard.value = true;
    router.replace('/receiving');
  } catch (e) {
    toastError(e);
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <header class="app-bar">
    <h1>
      <button class="back" @click="router.back()" aria-label="返回">‹</button>
      对货单
      <span v-if="slip?.settled" class="badge settled">已结账</span>
    </h1>
  </header>

  <main v-if="loading" class="spinner">加载中…</main>
  <main v-else-if="!slip" class="empty">对货单不存在</main>

  <main v-else class="page">
    <p v-if="readOnly" class="muted small readonly-hint">这张单已经结账，内容不能再改，只能查看。</p>

    <label class="field">
      <span>日期</span>
      <input v-model="day" class="input" type="date" :max="today()" :disabled="readOnly" />
    </label>

    <label class="field">
      <span>供应商（可不填）</span>
      <input v-model="supplierName" class="input" placeholder="拍照识别会自动填，也可以手动改" :disabled="readOnly" />
    </label>

    <label class="field">
      <span>单据编号</span>
      <input v-model="invoiceNo" class="input" placeholder="识别会自动填，同一编号只能录一次" :disabled="readOnly" />
    </label>

    <div class="field">
      <span>对货单照片（AI 识别用这个，单据分几张拍的都行）</span>
      <div class="photo-grid">
        <a v-for="im in slipImages" :key="im.id" :href="im.url" target="_blank" class="photo">
          <img :src="im.url" alt="对货单照片" />
          <div v-if="!readOnly" class="photo-ops">
            <button class="del" @click.prevent="removePhoto(im.id)">删除</button>
          </div>
        </a>
        <button v-if="!readOnly" class="add-photo" :disabled="uploading === 'SLIP'" @click="slipFileInput?.click()">
          <span>{{ uploading === 'SLIP' ? '上传中…' : '＋ 拍照/选图' }}</span>
        </button>
      </div>
      <input ref="slipFileInput" type="file" accept="image/*" hidden @change="uploadPhoto($event, 'SLIP')" />
      <button
        v-if="!readOnly && slipImages.length"
        class="btn btn-block ocr-all"
        :disabled="recognizing"
        @click="recognize"
      >
        {{ recognizing ? '识别中…' : `🔍 AI 识别（${slipImages.length} 张）` }}
      </button>
    </div>

    <div class="field">
      <span>货物照片（留存证据，可不传）</span>
      <div class="photo-grid">
        <a v-for="im in goodsImages" :key="im.id" :href="im.url" target="_blank" class="photo">
          <img :src="im.url" alt="货物照片" />
          <div class="photo-ops">
            <button v-if="!readOnly" class="del" @click.prevent="removePhoto(im.id)">删除</button>
          </div>
        </a>
        <button v-if="!readOnly" class="add-photo" :disabled="uploading === 'GOODS'" @click="goodsFileInput?.click()">
          <span>{{ uploading === 'GOODS' ? '上传中…' : '＋ 拍照/选图' }}</span>
        </button>
      </div>
      <input ref="goodsFileInput" type="file" accept="image/*" hidden @change="uploadPhoto($event, 'GOODS')" />
    </div>

    <div class="field">
      <div class="table-head">
        <span>货品明细</span>
        <button v-if="!readOnly" class="add-row" @click="addRow">＋ 加一行</button>
      </div>

      <div v-if="!rows.length" class="muted small">还没有表格，拍照后点「AI 识别」，或者手动加行填写。</div>

      <ul v-else class="lines">
        <li v-for="(r, i) in rows" :key="i">
          <div class="line-top">
            <input v-model="r.itemName" class="input" placeholder="货品名称" :disabled="readOnly" />
            <button v-if="!readOnly" class="rm" @click="removeRow(i)" aria-label="删除这行">✕</button>
          </div>
          <div class="line-grid">
            <input v-model="r.qty" class="input num" type="number" inputmode="decimal" step="0.001" placeholder="数量" :disabled="readOnly" />
            <input v-model="r.unit" class="input num" placeholder="单位" :disabled="readOnly" />
            <input v-model="r.unitPrice" class="input num" type="number" inputmode="decimal" step="0.01" placeholder="单价" :disabled="readOnly" />
            <input v-model="r.amount" class="input num" type="number" inputmode="decimal" step="0.01" :placeholder="`金额${amountOf(r) !== null && r.amount === '' ? `≈${fmt(amountOf(r)!)}` : ''}`" :disabled="readOnly" />
          </div>
        </li>
      </ul>

      <p v-if="rows.length" class="total">明细加起来 <strong>{{ fmt(total) }}</strong></p>
    </div>

    <div class="field">
      <span>单据金额（照单据上印的填，不用自己算）</span>
      <div class="amounts">
        <label class="amount-row">
          <span class="amount-label">净额<em>不含税</em></span>
          <input v-model="netAmount" class="input num" type="number" inputmode="decimal" step="0.01" placeholder="Netto" :disabled="readOnly" />
        </label>
        <label class="amount-row">
          <span class="amount-label">税额<em>MwSt</em></span>
          <input v-model="taxAmount" class="input num" type="number" inputmode="decimal" step="0.01" placeholder="Summe MwSt" :disabled="readOnly" />
        </label>
        <label class="amount-row pay">
          <span class="amount-label">实付<em>就是这个数</em></span>
          <input v-model="grossAmount" class="input num" type="number" inputmode="decimal" step="0.01" placeholder="Gesamtbetrag" :disabled="readOnly" />
        </label>
      </div>

      <p v-if="netMismatch" class="warn">
        ⚠️ 明细加起来 {{ fmt(netMismatch.summed) }}，单据净额 {{ fmt(netMismatch.stated) }}，差 {{ fmt(Math.abs(netMismatch.diff)) }}。
        多半是有一行没认出来或数字认错了。
      </p>
      <p class="muted small pay-hint">结账按「实付」汇总{{ grossAmount.trim() ? '' : '；没填实付就按明细之和算' }}。</p>
    </div>

    <label class="field">
      <span>备注（可不填）</span>
      <textarea v-model="note" class="input" rows="2" :disabled="readOnly"></textarea>
    </label>

    <template v-if="!readOnly">
      <button class="btn btn-primary btn-block" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <button class="btn btn-danger btn-block del-slip" :disabled="deleting" @click="remove">
        {{ deleting ? '删除中…' : '删除这张对货单' }}
      </button>
    </template>
  </main>
</template>

<style scoped>
.back {
  font-size: 26px;
  line-height: 1;
  color: var(--muted);
  padding: 0 6px 0 0;
}

.badge {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
}

.badge.settled {
  background: var(--ok-soft);
  color: var(--ok);
}

.readonly-hint {
  margin: -4px 0 12px;
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

.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.photo {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--line);
  display: block;
}

.photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-ops {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
}

.photo-ops button {
  font-size: 11px;
  color: #fff;
  padding: 3px 4px;
  text-align: center;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 6px;
}

.add-photo {
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  border: 1px dashed var(--line);
  color: var(--muted);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.ocr-all {
  margin-top: 10px;
}

.amounts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.amount-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.amount-label {
  flex: none;
  width: 92px;
  font-size: 14px;
  display: flex;
  flex-direction: column;
}

.amount-label em {
  font-style: normal;
  font-size: 11px;
  color: var(--muted);
}

.amount-row .input {
  flex: 1;
  text-align: right;
}

/* 实付这一行要一眼看出来跟上面两个不是一个性质：这是真正要掏的钱 */
.amount-row.pay .amount-label {
  font-weight: 700;
  color: var(--brand);
}

.amount-row.pay .input {
  border-color: var(--brand);
  font-weight: 700;
}

.warn {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--brand);
}

.pay-hint {
  margin: 8px 0 0;
}

.table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.add-row {
  color: var(--brand);
  font-weight: 600;
  font-size: 13px;
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
  padding: 10px;
  border-bottom: 1px solid var(--line);
}

.lines li:last-child {
  border-bottom: none;
}

.line-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.line-top .input {
  flex: 1;
  min-width: 0;
}

.rm {
  flex: none;
  color: var(--muted);
  font-size: 14px;
  padding: 2px 6px;
}

.line-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 6px;
  margin-top: 6px;
}

.line-grid .num {
  padding: 8px 6px;
  font-size: 13px;
  text-align: center;
}

.total {
  margin: 10px 0 0;
  text-align: right;
  font-size: 14px;
}

.total strong {
  color: var(--brand);
  font-size: 17px;
}

.del-slip {
  margin-top: 10px;
}
</style>
