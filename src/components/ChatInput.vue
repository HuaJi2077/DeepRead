<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useChatStore } from '@/stores/chat'

// 输入框相关 SVG 图标
import iconToggleThink from '@/assets/icons/toggle-think.svg?raw'
import iconToggleSearch from '@/assets/icons/toggle-search.svg?raw'
import iconPaperclip from '@/assets/icons/input-attach.svg?raw'
import iconSend from '@/assets/icons/input-send.svg?raw'

// surface：首页输入框为 _9996a53（大投影），对话页为 _3d616d3（小投影），与原站一致
defineProps({
  surface: { type: String, default: '_9996a53' },
})

const ui = useUiStore()
const chatStore = useChatStore()

// 输入框是否有内容，用于控制发送按钮样式
const hasInput = computed(() => ui.input.trim().length > 0)

// 当前对话是否正在输出（等待响应或流式渲染中）：
// 输出期间锁定发送——按钮置灰不可点，Enter 快捷键失效，避免消息交叉
const busy = computed(() => chatStore.loading || chatStore.streaming)

/** 统一发送入口：输出中直接忽略（按钮与快捷键共用） */
function trySend() {
  if (busy.value || !hasInput.value) return
  ui.send()
}

/* ---------- 附件按钮快捷菜单：书架书籍 + 指令配置 ---------- */
// 点击书籍 → 输入「开始阅读：书名」；点击指令 → 输入该指令
// 菜单通过 Teleport 挂到 body + fixed 定位：输入框表面（._77cefa5）与
// 工具栏（.ec4f5d61）均带 overflow:hidden，普通 absolute 弹层会被裁剪
const attachBtnEl = ref(null)
const textareaEl = ref(null)
const attachMenuOpen = ref(false)
const attachLoading = ref(false)
const attachBooks = ref([])
const attachCommands = ref([])
const menuStyle = ref({})

/** 每次打开都拉取最新数据（书架可能增删、指令配置可被用户编辑） */
async function loadAttachData() {
  attachLoading.value = true
  try {
    const [shelfRes, cmdRes] = await Promise.all([
      fetch('/api/shelf', { cache: 'no-store' }),
      fetch('/api/chat/commands', { cache: 'no-store' }),
    ])
    if (!shelfRes.ok || !cmdRes.ok) throw new Error('请求失败')
    const shelf = await shelfRes.json()
    const cmdData = await cmdRes.json()
    attachBooks.value = (shelf.books || []).filter((b) => !b.invalid)
    // hidden 指令（如彩蛋）不进快捷指令菜单，仅可通过手动输入触发
    attachCommands.value = (cmdData.commands || []).filter((c) => !c.hidden)
  } catch {
    attachBooks.value = []
    attachCommands.value = []
  } finally {
    attachLoading.value = false
  }
}

/** 按附件按钮当前位置计算菜单 fixed 坐标（右对齐按钮、向上弹出） */
function positionMenu() {
  const rect = attachBtnEl.value?.getBoundingClientRect()
  if (!rect) return
  menuStyle.value = {
    right: `${Math.max(8, window.innerWidth - rect.right)}px`,
    bottom: `${window.innerHeight - rect.top + 10}px`,
  }
}

async function toggleAttachMenu() {
  attachMenuOpen.value = !attachMenuOpen.value
  if (attachMenuOpen.value) {
    positionMenu()
    await loadAttachData()
  }
}

/** 选中条目：填充输入框、关闭菜单并聚焦输入框 */
async function fillInput(text) {
  ui.input = text
  attachMenuOpen.value = false
  await nextTick()
  textareaEl.value?.focus()
}

// 点击按钮/菜单以外任意处关闭（菜单经 Teleport 在 body 下，需一并排除）
function onDocPointerDown(e) {
  if (!attachMenuOpen.value) return
  if (e.target.closest('.attach-anchor, .chat-attach-menu')) return
  attachMenuOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))
</script>

<template>
  <!-- 输入框外层容器 -->
  <div class="aaff8b8f">
    <div class="_77cefa5" :class="surface">
      <div class="_020ab5b">
        <!-- 文本输入区域（含自定义滚动条轨道） -->
        <div class="_24fad49">
          <!-- 自定义滚动条轨道（绝对定位覆盖在 textarea 上方） -->
          <div
            class="ds-scroll-area__gutters"
            style="--container-height: 60px; position: absolute; inset: 0px; width: 100%;"
          >
            <div
              class="ds-scroll-area__horizontal-gutter"
              style="left: 2px; right: 2px; display: block; bottom: 2px; height: 6px;"
            >
              <div class="ds-scroll-area__horizontal-bar" style="display: none;"></div>
            </div>
            <div
              class="ds-scroll-area__vertical-gutter"
              style="right: 2px; top: 16px; bottom: 2px; width: 6px;"
            >
              <div class="ds-scroll-area__vertical-bar" style="display: none;"></div>
            </div>
          </div>

          <!-- 多行文本输入框（输出中 Enter 不发送，仍允许 Shift+Enter 换行） -->
          <textarea
            ref="textareaEl"
            v-model="ui.input"
            class="_27c9245 ds-scroll-area ds-scroll-area--show-on-focus-within ds-scroll-area--enabled d96f2d2a"
            placeholder="输入指令进行阅读，详见右上角帮助按钮"
            rows="2"
            autocomplete="off"
            name="search"
            style="--container-height: 60px;"
            @keydown.enter.exact.prevent="trySend()"
          ></textarea>

          <div class="b13855df"></div>
        </div>

        <!-- 底部工具栏：功能开关 + 发送按钮 -->
        <div class="ec4f5d61">
          <!-- 左侧：AI 功能 / 搜索功能 开关（两者互斥：选中一个自动取消另一个，可都不选） -->
          <div class="_58b31c9">
            <!-- AI 功能开关 -->
            <div
              tabindex="0"
              :aria-pressed="ui.think"
              class="f79352dc ds-toggle-button ds-toggle-button--m"
              :class="{ 'ds-toggle-button--selected': ui.think }"
              style="transform: translateZ(0px);"
              @click="ui.toggleThink()"
            >
              <div class="ds-toggle-button__icon">
                <div class="ds-icon" style="font-size: inherit;">
                  <div class="_46d2264" aria-hidden="true">
                    <div style="width: 14px; height: 14px;" v-html="iconToggleThink"></div>
                  </div>
                </div>
              </div>
              <span class="_6dbc175">AI 功能</span>
              <div class="ds-focus-ring" style="--dsl-focus-ring-offset: -1px;"></div>
            </div>

            <!-- 搜索功能开关 -->
            <div
              tabindex="0"
              :aria-pressed="ui.search"
              class="f79352dc ds-toggle-button ds-toggle-button--m"
              :class="{ 'ds-toggle-button--selected': ui.search }"
              style="transform: translateZ(0px);"
              @click="ui.toggleSearch()"
            >
              <div class="ds-toggle-button__icon">
                <div class="ds-icon" style="font-size: inherit;">
                  <div class="_46d2264" aria-hidden="true">
                    <div style="width: 14px; height: 14px;" v-html="iconToggleSearch"></div>
                  </div>
                </div>
              </div>
              <span class="_6dbc175">搜索功能</span>
              <div class="ds-focus-ring" style="--dsl-focus-ring-offset: -1px;"></div>
            </div>
          </div>

          <!-- 右侧：附件 + 发送 -->
          <div class="bf38813a attach-anchor">
            <!-- 附件按钮：弹出快捷操作菜单（菜单本体经 Teleport 挂 body，见文件末尾） -->
            <div
              ref="attachBtnEl"
              role="button"
              aria-label="快捷操作"
              class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--s ds-button--icon-relative-m f02f0e25"
              tabindex="0"
              style="--dsl-button-height: 34px;"
              @click="toggleAttachMenu()"
            >
              <div class="ds-button__background"></div>
              <div class="ds-button__icon ds-button--icon--last-child">
                <div class="ds-icon" style="font-size: inherit;" v-html="iconPaperclip"></div>
              </div>
            </div>

            <!-- 发送按钮 -->
            <div style="width: fit-content;">
              <div
                role="button"
                :aria-disabled="!hasInput || busy"
                class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m _52c986b"
                :class="{ 'ds-button--disabled bd74640a': !hasInput || busy }"
                tabindex="0"
                style="--dsl-button-height: 34px;"
                @click="trySend()"
              >
                <div class="ds-button__background"></div>
                <div class="ds-button__icon ds-button__icon--last-child" v-html="iconSend"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷操作菜单：Teleport 到 body，fixed 定位避开输入框 overflow:hidden 裁剪。
         左右两栏：左侧书架书籍（点击填入「开始阅读：书名」）+ 右侧快捷指令（点击填入指令） -->
    <Teleport to="body">
      <div
        v-if="attachMenuOpen"
        class="chat-attach-menu"
        :style="menuStyle"
        role="menu"
        aria-label="快捷操作"
      >
        <div v-if="attachLoading" class="chat-attach-menu__hint">加载中...</div>
        <div v-else class="chat-attach-menu__cols">
          <div class="chat-attach-menu__col">
            <div class="chat-attach-menu__title">书架书籍</div>
            <div class="chat-attach-menu__list">
              <div
                v-for="book in attachBooks"
                :key="book.id"
                class="chat-attach-menu__item"
                role="menuitem"
                tabindex="0"
                @click="fillInput(`开始阅读：${book.title}`)"
              >
                <span class="chat-attach-menu__item-text">{{ book.title }}</span>
                <span class="chat-attach-menu__item-meta">{{ book.author }}</span>
              </div>
              <div v-if="!attachBooks.length" class="chat-attach-menu__hint">书架暂无书籍</div>
            </div>
          </div>
          <div class="chat-attach-menu__col">
            <div class="chat-attach-menu__title">快捷指令</div>
            <div class="chat-attach-menu__list">
              <div
                v-for="cmd in attachCommands"
                :key="cmd.id"
                class="chat-attach-menu__item"
                role="menuitem"
                tabindex="0"
                @click="fillInput(cmd.patterns[0])"
              >
                <span class="chat-attach-menu__item-text">{{ cmd.patterns[0] }}</span>
                <span class="chat-attach-menu__item-meta">{{ cmd.comment }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<!-- 样式说明：发送按钮的可点击态配色 ._52c986b（有输入时蓝色，空输入禁用态）
     已包含在全局样式 src/styles/ui.css 中，此处无需重复定义。 -->
