<script setup>
/**
 * 用户设置页（/user）
 *
 * 数据关联 data/user.json（后端 /api/settings 读写），实时保存、无保存按钮：
 * - 开关 / 下拉：变更即调 settings.save() 立即生效（暗黑模式即时切换主题）
 * - 文本输入（API 秘钥/地址）：600ms 防抖后保存，停止输入即落盘
 * - 获取模型 / 测试AI：按「页面当前值」请求（支持未保存的临时值），
 *   通过后再落盘，避免「先保存才能测」的两步往返
 * - 清空对话 / 清空书架 / 重置设置：红色按钮 + 统一弹窗二次确认
 * - GitHub仓库：复用帮助菜单的按钮样式（help-modal__repo，跳 user.json 的 repoUrl）
 *
 * 出错提示：ToastTip 的 danger 变体（半透明红底白字）；
 * 常规成功提示：ToastTip 默认样式（半透明黑底白字）。
 * 弹窗支持 Esc 关闭（与帮助菜单的快捷键逻辑统一）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { useShelfStore } from '@/stores/shelf'
import ToastTip from '@/components/ToastTip.vue'
import iconGithub from '@/assets/icons/github.svg?raw'

const settings = useSettingsStore()
const chat = useChatStore()
const shelf = useShelfStore()
const route = useRoute()
const router = useRouter()

/* ---------- 本地可编辑状态（文本输入防抖保存，其余直存） ---------- */
const apiKey = ref('')
const baseUrl = ref('')
const displayName = ref('用户')
const model = ref('')
const models = ref([]) // 获取模型后填充下拉选项
let syncing = false // 同步输入框期间跳过自动保存（避免加载/重置误触发写盘）

function syncFromStore() {
  syncing = true
  apiKey.value = settings.apiKey
  baseUrl.value = settings.baseUrl
  displayName.value = settings.displayName
  model.value = settings.model
  // v-model 赋值在下一个微任务才触发 watcher，同步开关后于其后恢复
  Promise.resolve().then(() => (syncing = false))
}

/* ---------- Esc 关闭确认弹窗（与帮助菜单快捷键逻辑统一） + 老板键绑定捕获 ---------- */
function onKeydown(e) {
  if (bindingBossKey.value) {
    captureBossKey(e)
    return
  }
  if (e.key === 'Escape' && confirmBox.value) closeConfirm()
}

/* ---------- 老板键绑定：点击按钮进入监听，下一次按键即绑定为新键位 ---------- */
const bindingBossKey = ref(false)

// 键名展示归一化（空格等不可见键给可读名）
const KEY_LABELS = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
const bossKeyLabel = (key) => KEY_LABELS[key] || key

function captureBossKey(e) {
  // 同在 window 上的监听（App.vue 老板键跳转）必须一并拦下，
  // stopPropagation 挡不住同一目标的后续监听，须用 stopImmediatePropagation
  e.preventDefault()
  e.stopImmediatePropagation()
  // Esc 取消绑定；纯修饰键（Shift/Ctrl/Alt/Meta）等待组合结束，不算键位
  if (e.key === 'Escape') {
    bindingBossKey.value = false
    return
  }
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
  bindingBossKey.value = false
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  saveField({ bossKey: key })
}

async function startBindBossKey() {
  if (bindingBossKey.value) {
    bindingBossKey.value = false
    return
  }
  bindingBossKey.value = true
}

onMounted(async () => {
  // 捕获阶段监听：早于 App.vue 老板键的冒泡监听注册/触发，
  // 绑定期间才能用 stopImmediatePropagation 把它拦下
  window.addEventListener('keydown', onKeydown, true)
  if (!settings.loaded) await settings.load()
  syncFromStore()
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))

/* ---------- 居中提示（出错 = 红色警告变体） ---------- */
const toastMsg = ref('')
const toastDanger = ref(false)
let toastTimer = null

function showToast(msg, danger = false) {
  toastMsg.value = msg
  toastDanger.value = danger
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastMsg.value = ''), 1800)
}

/* ---------- 开关 / 下拉：变更即保存 ---------- */
async function toggleSetting(key) {
  const err = await settings.save({ [key]: !settings[key] })
  if (err) showToast(err, true)
}

async function saveField(patch) {
  const err = await settings.save(patch)
  if (err) {
    showToast(err, true)
    syncFromStore() // 保存失败回滚输入框为磁盘真实值
  }
}

/* ---------- 文本输入：600ms 防抖合并保存 ---------- */
let textSaveTimer = null
const pendingPatch = {}

function queueTextSave(key, value) {
  pendingPatch[key] = value
  clearTimeout(textSaveTimer)
  textSaveTimer = setTimeout(async () => {
    const patch = { ...pendingPatch }
    for (const k of Object.keys(pendingPatch)) delete pendingPatch[k]
    await saveField(patch)
  }, 600)
}

watch(apiKey, (v) => {
  if (!syncing) queueTextSave('apiKey', v.trim())
})
watch(baseUrl, (v) => {
  if (!syncing) queueTextSave('baseUrl', v.trim())
})
watch(displayName, (v) => {
  if (!syncing) queueTextSave('displayName', v.trim())
})

/* 模型下拉选择：确认即保存 */
watch(model, (v) => {
  if (!syncing) saveField({ model: v })
})

/* ---------- 获取模型 ---------- */
const loadingModels = ref(false)

async function fetchModels() {
  if (loadingModels.value) return
  loadingModels.value = true
  try {
    const res = await fetch('/api/settings/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey.value.trim(), baseUrl: baseUrl.value.trim() }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    models.value = data.models || []
    if (!models.value.includes(model.value)) model.value = ''
    showToast(`已获取 ${models.value.length} 个模型`)
  } catch (err) {
    showToast(`获取模型失败：${err.message}`, true)
  } finally {
    loadingModels.value = false
  }
}

/* ---------- 测试 AI ---------- */
const testing = ref(false)

async function testAI() {
  if (testing.value) return
  testing.value = true
  try {
    const res = await fetch('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: apiKey.value.trim(),
        baseUrl: baseUrl.value.trim(),
        model: model.value,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    showToast('AI 连接成功')
  } catch (err) {
    showToast(`AI 连接失败：${err.message}`, true)
  } finally {
    testing.value = false
  }
}

/* ---------- 二次确认弹窗（清空对话 / 清空书架 / 重置设置） ---------- */
const confirmBox = ref(null) // { title, desc, confirmText, action }

function openConfirm(title, desc, confirmText, action) {
  confirmBox.value = { title, desc, confirmText, action }
}

function closeConfirm() {
  confirmBox.value = null
}

async function runConfirm() {
  const box = confirmBox.value
  if (!box) return
  closeConfirm()
  await box.action()
}

/* ---------- 危险操作 ---------- */
async function clearConversations() {
  try {
    const res = await fetch('/api/chat/conversations', { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    // 正停在某个对话页时先回主页，再刷新侧边栏列表
    if (route.name === 'chat') router.push('/')
    chat.loadConversations()
    showToast(`已清空 ${data.count ?? 0} 个对话`)
  } catch (err) {
    showToast(`清空对话失败：${err.message}`, true)
  }
}

async function clearShelf() {
  try {
    const res = await fetch('/api/shelf/books', { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    if (shelf.readerBook) shelf.closeReader()
    shelf.load()
    showToast(`已清空 ${data.count ?? 0} 本书`)
  } catch (err) {
    showToast(`清空书架失败：${err.message}`, true)
  }
}

async function resetSettings() {
  try {
    const res = await fetch('/api/settings/reset', { method: 'POST' })
    const cfg = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(cfg.error || `HTTP ${res.status}`)
    settings.applyConfig(cfg)
    settings.applyTheme()
    syncFromStore()
    models.value = []
    showToast('设置已重置')
  } catch (err) {
    showToast(`重置失败：${err.message}`, true)
  }
}

/* ---------- GitHub 仓库（地址来自 data/user.json 的 repoUrl） ---------- */
async function openRepo() {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const url = data?.repoUrl
    if (!url) throw new Error('未配置 repoUrl')
    window.open(url, '_blank', 'noopener')
  } catch (err) {
    showToast(`仓库地址获取失败：${err.message}`, true)
  }
}
</script>

<template>
  <div class="user-page">
    <!-- 页头：与其他页一致的大标题样式 -->
    <header class="user-header">
      <h1>用户设置</h1>
      <p class="user-sub">设置实时保存，修改立即生效</p>
    </header>

    <div class="settings-list">
      <!-- ============ 通用设置 ============ -->
      <section class="settings-card">
        <h2 class="settings-card__title">通用设置</h2>

        <div class="settings-row settings-row--stack">
          <div class="settings-row__info">
            <div class="settings-row__label">显示名称</div>
            <div class="settings-row__desc">在用户卡显示的名称，无特殊作用</div>
          </div>
          <input
            v-model="displayName"
            type="text"
            class="settings-input"
            placeholder="用户"
            maxlength="10"
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        <div class="settings-row">
          <div class="settings-row__info">
            <div class="settings-row__label">暗黑模式</div>
            <div class="settings-row__desc">界面切换为暗色主题（Beta）</div>
          </div>
          <button
            type="button"
            class="ds-switch"
            :class="{ 'ds-switch--checked': settings.darkMode }"
            role="switch"
            :aria-checked="settings.darkMode"
            @click="toggleSetting('darkMode')"
          >
            <span class="ds-switch-thumb"></span>
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row__info">
            <div class="settings-row__label">记忆阅读进度</div>
            <div class="settings-row__desc">开启后跳转到上次阅读位置</div>
          </div>
          <button
            type="button"
            class="ds-switch"
            :class="{ 'ds-switch--checked': settings.rememberProgress }"
            role="switch"
            :aria-checked="settings.rememberProgress"
            @click="toggleSetting('rememberProgress')"
          >
            <span class="ds-switch-thumb"></span>
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row__info">
            <div class="settings-row__label">搜索条目数量</div>
            <div class="settings-row__desc">网络搜索时展示的条目数量</div>
          </div>
          <select
            v-model.number="settings.searchCount"
            class="settings-select"
            aria-label="搜索条目数量"
            @change="saveField({ searchCount: settings.searchCount })"
          >
            <option v-for="n in 5" :key="n" :value="n">{{ n }} 条</option>
          </select>
        </div>
                <div class="settings-row">
          <div class="settings-row__info">
            <div class="settings-row__label">老板键设置</div>
            <div class="settings-row__desc">一键跳转到官方网站，按 Esc 取消绑定</div>
          </div>
          <button
            type="button"
            class="modal-btn settings-keybind"
            :class="{ 'settings-keybind--binding': bindingBossKey }"
            @click="startBindBossKey"
          >
            {{ bindingBossKey ? '按下按键绑定…' : bossKeyLabel(settings.bossKey) }}
          </button>
        </div>
      </section>

      <!-- ============ AI 配置 ============ -->
      <section class="settings-card">
        <h2 class="settings-card__title">AI 配置</h2>

        <div class="settings-row settings-row--stack">
          <div class="settings-row__info">
            <div class="settings-row__label">API 秘钥</div>
            <div class="settings-row__desc">OpenAI 兼容格式的密钥，Key会保存在本地</div>
          </div>
          <!-- 密码框：显示/隐藏用浏览器原生小眼睛，不再自绘按钮 -->
          <input
            v-model="apiKey"
            type="password"
            class="settings-input"
            placeholder="sk-..."
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        <div class="settings-row settings-row--stack">
          <div class="settings-row__info">
            <div class="settings-row__label">API 地址</div>
            <div class="settings-row__desc">OpenAI 兼容格式的地址</div>
          </div>
          <input
            v-model="baseUrl"
            type="text"
            class="settings-input"
            placeholder="https://api.openai.com/v1"
            spellcheck="false"
          />
        </div>

        <div class="settings-row settings-row--stack">
          <div class="settings-row__info">
            <div class="settings-row__label">模型选择</div>
            <div class="settings-row__desc">点击「获取模型」后自动获取模型列表</div>
          </div>
          <div class="settings-model-row">
            <select v-model="model" class="settings-select settings-select--grow" aria-label="模型选择">
              <option v-if="!models.length" value="">请先点击获取模型按钮</option>
              <option v-if="model && !models.includes(model)" :value="model">{{ model }}</option>
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
            </select>
            <button
              type="button"
              class="modal-btn settings-btn-eq"
              :disabled="loadingModels"
              @click="fetchModels"
            >
              {{ loadingModels ? '获取中…' : '获取模型' }}
            </button>
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row__info">
            <div class="settings-row__label">连接测试</div>
            <div class="settings-row__desc">向模型发送测试消息，用于测试连接情况</div>
          </div>
          <button
            type="button"
            class="modal-btn modal-btn--primary settings-btn-eq"
            :disabled="testing"
            @click="testAI"
          >
            {{ testing ? '测试中…' : '测试AI' }}
          </button>
        </div>
      </section>

      <!-- ============ 数据管理 ============ -->
      <section class="settings-card">
        <h2 class="settings-card__title">数据管理</h2>

        <div class="settings-row">
          <div class="settings-row__info">
            <div class="settings-row__label">清空对话</div>
            <div class="settings-row__desc">删除所有的历史对话</div>
          </div>
          <button
            type="button"
            class="modal-btn modal-btn--danger"
            @click="openConfirm('清空对话', '将会删除所有的历史对话，该操作不可恢复。', '确认清空', clearConversations)"
          >
            清空对话
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row__info">
            <div class="settings-row__label">清空书架</div>
            <div class="settings-row__desc">删除所有的电子书（不会删除原始的电子书文件）</div>
          </div>
          <button
            type="button"
            class="modal-btn modal-btn--danger"
            @click="openConfirm('清空书架', '将会删除所有的电子书，该操作不可恢复。', '确认清空', clearShelf)"
          >
            清空书架
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-row__info">
            <div class="settings-row__label">重置设置</div>
            <div class="settings-row__desc">将所有设置恢复到默认值（不影响历史对话和电子书）</div>
          </div>
          <button
            type="button"
            class="modal-btn modal-btn--danger"
            @click="openConfirm('重置设置', '将所有设置恢复到默认值，该操作不可恢复。', '确认重置', resetSettings)"
          >
            重置设置
          </button>
        </div>
      </section>

      <!-- ============ 关于软件 ============ -->
      <section class="settings-card">
        <h2 class="settings-card__title">关于软件</h2>
        <div class="settings-row">
          <div class="settings-row__info">
            <div class="settings-row__label">GitHub仓库</div>
            <div class="settings-row__desc">本项目完全开源，无任何商业收费，如有侵权联系删除</div>
          </div>
          <!-- 复用帮助菜单的 GitHub 按钮（全局类 help-modal__repo，样式见 local-overrides.css） -->
          <button type="button" class="modal-btn help-modal__repo" @click="openRepo">
            <span class="help-modal__repo-icon" v-html="iconGithub"></span>GitHub仓库
          </button>
        </div>
      </section>
    </div>

    <!-- 二次确认弹窗（统一 modal 规范：灰描边 + 胶囊按钮） -->
    <div v-if="confirmBox" class="modal-backdrop" @click="closeConfirm">
      <div
        class="ds-modal-content ds-elevated ds-modal-content--dialog modal-stroke"
        role="dialog"
        @click.stop
      >
        <div class="ds-modal-content__header-wrapper">
          <div class="ds-modal-content__title">{{ confirmBox.title }}</div>
        </div>
        <div class="ds-modal-content__main">
          <p class="settings-confirm__desc">{{ confirmBox.desc }}</p>
        </div>
        <div class="ds-modal-content__footer">
          <div class="ds-modal-content__button-group">
            <button class="modal-btn" type="button" @click="closeConfirm">取消</button>
            <button class="modal-btn modal-btn--danger" type="button" @click="runConfirm">
              {{ confirmBox.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 出错提示：半透明红底白字；常规提示：半透明黑底白字 -->
    <ToastTip :message="toastMsg" :danger="toastDanger" />
  </div>
</template>

<style scoped>
.user-page {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 8px 40px 48px;
}

/* ---------- 页头：与其他页一致（30px 居中主题蓝） ---------- */
.user-header {
  margin-bottom: 24px;
}

.user-header h1 {
  font-size: 30px;
  font-weight: 600;
  text-align: center;
  color: rgb(57, 100, 254);
}

.user-sub {
  margin-top: 8px;
  font-size: 13px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

/* ---------- 设置卡片列表 ---------- */
.settings-list {
  max-width: 660px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card {
  border: 1px solid var(--dsw-alias-border-l4, #dcdcdc);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  padding-bottom: 4px;
}

.settings-card__title {
  margin: 0;
  padding: 16px 20px 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #464956);
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 20px;
}

.settings-row + .settings-row {
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));
}

/* 堆叠布局（文本输入类行）：标签在上、控件整行在下 */
.settings-row--stack {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.settings-row__info {
  min-width: 0;
}

.settings-row__label {
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary, #1f2329);
}

.settings-row__desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

/* ---------- 输入框 / 下拉 ---------- */
.settings-input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1px solid var(--dsw-alias-border-l4, #dcdcdc);
  border-radius: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  background: transparent;
  outline: none;
}

.settings-input:focus {
  border-color: var(--dsw-alias-brand-primary, #3964fe);
}

.settings-input::placeholder {
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

.settings-select {
  min-width: 120px;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l4, #dcdcdc);
  border-radius: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  background: var(--dsw-alias-bg-layer-1, #fff);
  outline: none;
  cursor: pointer;
}

.settings-select:focus {
  border-color: var(--dsw-alias-brand-primary, #3964fe);
}

/* 下拉选中项：品牌蓝底白字 */
.settings-select option:checked {
  background-color: rgb(57, 100, 254);
  color: #fff;
}

.settings-select--grow {
  flex: 1;
  min-width: 0;
}

/* 模型行：下拉 + 获取模型按钮 */
.settings-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 获取模型 / 测试AI 按钮统一宽度（以测试AI 的 min-width 88px 为准） */
.settings-btn-eq {
  width: 88px;
  padding: 0 8px;
}

/* 老板键键位按钮：与统一按钮同宽起步，长键名可伸展；绑定监听态品牌蓝描边提示 */
.settings-keybind {
  min-width: 88px;
}

.settings-keybind--binding {
  border-color: var(--dsw-alias-brand-primary, #3964fe);
  color: var(--dsw-alias-brand-primary, #3964fe);
}

/* ---------- 确认弹窗正文 ---------- */
.settings-confirm__desc {
  margin: 0;
  font-size: 13px;
  line-height: 21px;
  color: var(--dsw-alias-label-secondary, #464956);
}

@media (max-width: 640px) {
  .user-page {
    padding: 8px 16px 40px;
  }
}
</style>
