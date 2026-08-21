<script setup>
// 我的书架页：书籍管理（导入 / 重命名 / 更多信息 / 删除）
// - 数据持久化在项目 data/shelf.json（本地后端读写），不存浏览器
// - 点击书籍在卡片右侧弹出操作菜单：更多信息 / 重命名 / 删除
//   更多信息 → 解析并展示 shelf.json 中该书的全部字段
//   删除 → 屏幕中心确认弹窗（参考站 ds-modal 样式 + 灰色描边）
// - 阅读入口在「阅读模式」页，本页点击书籍不打开阅读器
// - 导入按钮与封面同长宽（3:4），固定网格第一位

import { onMounted, ref } from 'vue'
import { useShelfStore } from '@/stores/shelf'
import { normalizeProgress } from '@/utils/reading'
import BookGrid from '@/components/BookGrid.vue'
import iconAdd from '@/assets/icons/add.svg?raw'
import iconInfo from '@/assets/icons/info.svg?raw'
import iconEdit from '@/assets/icons/message-edit.svg?raw'
import iconDelete from '@/assets/icons/delete.svg?raw'

const shelf = useShelfStore()
const fileInput = ref(null)

onMounted(() => {
  shelf.load()
})

function pickFiles() {
  if (shelf.importing) return
  fileInput.value?.click()
}

/** input 选择后逐个导入，完成后清空 value 以便重复选择同一文件 */
async function onFilesChange(e) {
  const files = [...e.target.files]
  e.target.value = ''
  for (const f of files) {
    await shelf.importBook(f)
  }
}

/* ---------- 卡片操作菜单（更多信息 / 重命名 / 删除） ---------- */
const menuBook = ref(null) // 当前弹出菜单对应的书籍（null 关闭）
const menuPos = ref({})    // 菜单定位：卡片右侧
const infoBook = ref(null) // 「更多信息」弹窗展示的书籍
const renameTarget = ref(null) // 正在重命名的书籍
const renameText = ref('')
const renaming = ref(false)
const deleting = ref(false) // 删除确认弹窗

function openMenu(book, evt) {
  menuBook.value = book
  const r = evt.currentTarget.getBoundingClientRect()
  // 菜单出现在书籍块右侧（留 8px 间距），顶部对齐卡片顶
  menuPos.value = { left: `${r.right + 8}px`, top: `${r.top}px` }
}

function startRename() {
  renameTarget.value = menuBook.value
  renameText.value = renameTarget.value.title
  menuBook.value = null
  renaming.value = true
}

async function confirmRename() {
  const t = renameText.value.trim()
  if (t && renameTarget.value) await shelf.renameBook(renameTarget.value.id, t)
  renaming.value = false
}

/* ---------- 更多信息弹窗：shelf.json 字段解析展示 ---------- */
function showInfo() {
  infoBook.value = menuBook.value
  menuBook.value = null
}

function formatSize(size) {
  if (!size) return '-'
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/* ---------- 删除确认 ---------- */
function askDelete() {
  renameTarget.value = menuBook.value // 复用变量存待删除书
  menuBook.value = null
  deleting.value = true
}

async function confirmDelete() {
  if (renameTarget.value) await shelf.removeBook(renameTarget.value.id)
  renameTarget.value = null
  deleting.value = false
}
</script>

<template>
  <div class="shelf-page">
    <!-- 页头：标题（居中、主题蓝）+ 数量 + 空态提示 -->
    <header class="shelf-header">
      <h1>我的书架</h1>
      <p class="shelf-sub">
        {{ shelf.loading ? '正在加载…' : `总计: ${shelf.books.length}本 | 存在: ${shelf.validCount}本 | 丢失: ${shelf.invalidCount}本 | 支持格式: EPUB / PDF / TXT`
        }}
      </p>
      <!-- 空态提示：紧贴统计行下部居中（页头已为其预留一行空间，避免出现/消失时布局跳动） -->
      <p v-if="!shelf.loading && !shelf.books.length" class="shelf-empty">
        书架还是空的，点击「导入电子书」导入第一本电子书吧
      </p>
      <p v-if="shelf.importError" class="shelf-error">{{ shelf.importError }}</p>
    </header>

    <!-- 书籍网格（点击书籍 → 操作菜单） -->
    <BookGrid :books="shelf.books" @open="openMenu">
      <template #prepend>
        <!-- 导入按钮：与封面同长宽，固定网格第一位 -->
        <button class="import-card" :disabled="shelf.importing" @click="pickFiles">
          <span class="import-icon" v-html="iconAdd"></span>
          <span class="import-label">{{ shelf.importing ? '正在导入…' : '导入电子书' }}</span>
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".epub,.pdf,.txt"
          multiple
          hidden
          @change="onFilesChange"
        />
      </template>
    </BookGrid>

    <!-- 卡片操作菜单：更多信息 / 重命名 / 删除（卡片右侧） -->
    <div v-if="menuBook" class="menu-backdrop" @click="menuBook = null">
      <div class="card-menu" :style="menuPos" @click.stop>
        <button class="menu-item" @click="showInfo">
          <span class="menu-icon" v-html="iconInfo"></span>更多信息
        </button>
        <button class="menu-item" @click="startRename">
          <span class="menu-icon" v-html="iconEdit"></span>重命名
        </button>
        <button class="menu-item menu-danger" @click="askDelete">
          <span class="menu-icon" v-html="iconDelete"></span>删除
        </button>
      </div>
    </div>

    <!-- 重命名弹窗（与其余弹窗统一：ds-modal 结构 + 灰描边 + 居中 + 胶囊按钮） -->
    <div v-if="renaming" class="modal-backdrop" @click="renaming = false">
      <div class="ds-modal-content ds-elevated ds-modal-content--dialog modal-stroke" role="dialog" @click.stop>
        <div class="ds-modal-content__header-wrapper">
          <div class="ds-modal-content__title">重命名</div>
        </div>
        <div class="ds-modal-content__main">
          <input
            v-model="renameText"
            class="rename-input"
            maxlength="200"
            placeholder="输入新的书名"
            @keydown.enter="confirmRename"
          />
        </div>
        <div class="ds-modal-content__footer">
          <div class="ds-modal-content__button-group">
            <button class="modal-btn" @click="renaming = false">取消</button>
            <button class="modal-btn modal-btn--primary" @click="confirmRename">确定</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 更多信息弹窗：展示 shelf.json 全部字段 -->
    <div v-if="infoBook" class="modal-backdrop" @click="infoBook = null">
      <div
        class="ds-modal-content ds-elevated ds-modal-content--dialog modal-stroke info-modal"
        role="dialog"
        @click.stop
      >
        <div class="ds-modal-content__header-wrapper">
          <div class="ds-modal-content__title">书籍信息</div>
        </div>
        <div class="ds-modal-content__main">
          <div class="info-row"><span class="info-key">书名</span><span class="info-val">{{ infoBook.title }}</span></div>
          <div class="info-row"><span class="info-key">作者</span><span class="info-val">{{ infoBook.author }}</span></div>
          <div class="info-row"><span class="info-key">格式</span><span class="info-val">{{ infoBook.format.toUpperCase() }}</span></div>
          <div class="info-row"><span class="info-key">文件大小</span><span class="info-val">{{ formatSize(infoBook.size) }}</span></div>
          <div class="info-row"><span class="info-key">导入时间</span><span class="info-val">{{ formatTime(infoBook.addedAt) }}</span></div>
          <div class="info-row"><span class="info-key">阅读进度</span><span class="info-val">{{ normalizeProgress(infoBook.progress) }}%</span></div>
          <div class="info-row"><span class="info-key">状态</span><span class="info-val">{{ infoBook.invalid ? '已丢失' : '正常' }}</span></div>
          <div class="info-row"><span class="info-key">书籍文件</span><span class="info-val">{{ infoBook.file }}</span></div>
          <div class="info-row"><span class="info-key">封面文件</span><span class="info-val">{{ infoBook.cover || '（无）' }}</span></div>
          <div class="info-row"><span class="info-key">ID</span><span class="info-val">{{ infoBook.id }}</span></div>
        </div>
        <div class="ds-modal-content__footer">
          <div class="ds-modal-content__button-group">
            <button class="modal-btn" @click="infoBook = null">关闭</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗（参考站 ds-modal + 灰色描边） -->
    <div v-if="deleting" class="modal-backdrop" @click="deleting = false">
      <div
        class="ds-modal-content ds-elevated ds-modal-content--dialog modal-stroke"
        role="dialog"
        @click.stop
      >
        <div class="ds-modal-content__header-wrapper">
          <div class="ds-modal-content__title">是否确认删除？</div>
        </div>
        <div class="ds-modal-content__main">电子书和阅读进度将不可恢复 (不会删除原始的电子书文件)</div>
        <div class="ds-modal-content__footer">
          <div class="ds-modal-content__button-group">
            <button class="modal-btn" @click="deleting = false">取消</button>
            <button class="modal-btn modal-btn--danger" @click="confirmDelete">删除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shelf-page {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  /* 顶部内边距收窄：标题上移，避免页头显得过于靠下 */
  padding: 8px 40px 48px;
}

/* ---------- 页头：标题居中、主题蓝 ---------- */
.shelf-header {
  margin-bottom: 28px;
}

.shelf-header h1 {
  font-size: 30px;
  font-weight: 600;
  text-align: center;
  color: rgb(57, 100, 254);
}

.shelf-sub {
  margin-top: 8px;
  font-size: 13px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

.shelf-error {
  margin-top: 8px;
  font-size: 13px;
  text-align: center;
  color: var(--dsw-alias-label-alert, #e0564f);
}

/* 空态提示：统计行下部居中；固定行高为页头预留空间，空态消失时布局不跳动 */
.shelf-empty {
  margin-top: 10px;
  min-height: 13px; /* 与字号一致，仅占一行基线高度 */
  font-size: 13px;
  line-height: 13px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

/* ---------- 导入按钮（第一位，与封面同比例 3:4） ---------- */
.import-card {
  aspect-ratio: 3 / 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1.5px dashed #a2a4a6;
  border-radius: 10px;
  background: var(--dsw-alias-fill-secondary, rgb(249, 250, 251));
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

/* 暗色模式：底色经 fill-secondary 变量自动变深，虚线描边改半透明白 */
body[data-ds-dark-theme] .import-card {
  border-color: rgba(255, 255, 255, 0.28);
}

.import-card:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary, #3964fe);
  background: rgba(57, 100, 254, 0.06);
}

.import-card:disabled {
  cursor: wait;
  opacity: 0.6;
}

/* 添加图标（add.svg，1em 随字号缩放） */
.import-icon {
  display: inline-flex;
  font-size: 34px;
  line-height: 1;
  color: var(--dsw-alias-brand-primary, #3964fe);
}

.import-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #464956);
}

/* 卡片操作菜单 / 弹窗 / 胶囊按钮样式已提取为全局共享（见 local-overrides.css 末尾），
   与历史对话三点菜单（SideBar.vue）复用同一套类名，此处不再重复定义。 */

.info-modal :deep(.ds-modal-content__main) {
  /* 注意：不可写 width:100% —— main 是 content-box，100%+padding 会比弹窗宽 48px，
     导致信息文字右缘恒定溢出背景板约 23px（任何浏览器都溢出，Edge 缩放下更明显）。
     flex 纵向子项默认自动撑满包含块，无需显式宽度 */
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-row {
  display: flex;
  gap: 12px;
  font-size: 13px;
  line-height: 1.5;
}

.info-key {
  width: 72px;
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

.info-val {
  flex: 1;
  min-width: 0;
  word-break: break-all;
  overflow-wrap: anywhere; /* 超长路径/ID 强制换行，不超出弹窗背景 */
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

/* ---------- 响应式：窄屏收窄边距 ---------- */
@media (max-width: 640px) {
  .shelf-page {
    padding: 8px 16px 40px;
  }
}
</style>
