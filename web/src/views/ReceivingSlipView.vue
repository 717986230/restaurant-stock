<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, fmt, round3, type ReceivingImageKind, type ReceivingSlipDetail } from '@/api';
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
const recognizing = ref<number | null>(null);
const uploading = ref<ReceivingImageKind | null>(null);

const day = ref('');
const supplierName = ref('');
const note = ref('');

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

async function load() {
  try {
    const data = await api.receivingSlip(id);
    slip.value = data;
    day.value = data.slipDay;
    supplierName.value = data.supplierName ?? '';
    note.value = data.note ?? '';
    rows.value = data.lines.map((l) => ({
      itemName: l.itemName,
      qty: l.qty == null ? '' : String(l.qty),
      unit: l.unit ?? '',
      unitPrice: l.unitPrice == null ? '' : String(l.unitPrice),
      amount: l.amount == null ? '' : String(l.amount),
      note: l.note ?? '',
    }));
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

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

/** AI 识别只是给一份草稿，不会自动保存——认错字总会有，识别完还要人核对一遍再点保存 */
async function recognize(imageId: number) {
  recognizing.value = imageId;
  try {
    const res = await api.recognizeReceivingSlip(id, imageId);
    if (res.supplierName && !supplierName.value.trim()) supplierName.value = res.supplierName;
    if (res.day) day.value = res.day;
    if (res.lines.length) {
      rows.value = res.lines.map((l) => ({
        itemName: l.itemName,
        qty: l.qty == null ? '' : String(l.qty),
        unit: l.unit ?? '',
        unitPrice: l.unitPrice == null ? '' : String(l.unitPrice),
        amount: l.amount == null ? '' : String(l.amount),
        note: '',
      }));
      toast(`识别到 ${res.lines.length} 项，核对无误后记得保存`);
    } else {
      toast('没识别出货品行，麻烦手动填一下');
    }
  } catch (e) {
    toastError(e);
  } finally {
    recognizing.value = null;
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
  saving.value = true;
  try {
    await api.updateReceivingSlip(id, {
      day: day.value,
      supplierName: supplierName.value.trim() || null,
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
      <input v-model="day" class="input" type="date" :disabled="readOnly" />
    </label>

    <label class="field">
      <span>供应商（可不填）</span>
      <input v-model="supplierName" class="input" placeholder="拍照识别会自动填，也可以手动改" :disabled="readOnly" />
    </label>

    <div class="field">
      <span>对货单照片（AI 识别用这个）</span>
      <div class="photo-grid">
        <a v-for="im in slipImages" :key="im.id" :href="im.url" target="_blank" class="photo">
          <img :src="im.url" alt="对货单照片" />
          <div v-if="!readOnly" class="photo-ops">
            <button class="ocr" :disabled="recognizing === im.id" @click.prevent="recognize(im.id)">
              {{ recognizing === im.id ? '识别中…' : '🔍 AI 识别' }}
            </button>
            <button class="del" @click.prevent="removePhoto(im.id)">删除</button>
          </div>
        </a>
        <button v-if="!readOnly" class="add-photo" :disabled="uploading === 'SLIP'" @click="slipFileInput?.click()">
          <span>{{ uploading === 'SLIP' ? '上传中…' : '＋ 拍照' }}</span>
        </button>
      </div>
      <input ref="slipFileInput" type="file" accept="image/*" capture="environment" hidden @change="uploadPhoto($event, 'SLIP')" />
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
          <span>{{ uploading === 'GOODS' ? '上传中…' : '＋ 拍照' }}</span>
        </button>
      </div>
      <input ref="goodsFileInput" type="file" accept="image/*" capture="environment" hidden @change="uploadPhoto($event, 'GOODS')" />
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

      <p v-if="rows.length" class="total">合计 <strong>{{ fmt(total) }}</strong></p>
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
