<script setup>
import { onMounted, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

// 挂载时加载历史对话列表（从 SQLite）
onMounted(() => {
  chatStore.loadConversations()
})

// 侧边栏使用的 SVG 图标（?raw 表示以字符串形式导入，用于 v-html 渲染）
// 图标已去重：折叠/展开共用 sidebar-toggle、搜索共用 search、
// 品牌图形共用 logo-mark、新建对话共用 new-chat（与 ChatHome/ChatView）
import iconLogoDeepread from '@/assets/icons/logo-deepread.svg?raw'
import iconSearch from '@/assets/icons/search.svg?raw'
import iconSidebarToggle from '@/assets/icons/sidebar-toggle.svg?raw'
import iconNewChat from '@/assets/icons/new-chat.svg?raw'
import iconUserAvatar from '@/assets/icons/user-avatar.svg?raw'
import iconMoreDots from '@/assets/icons/more-dots.svg?raw'
import iconLogoMark from '@/assets/icons/logo-mark.svg?raw'
import iconEdit from '@/assets/icons/message-edit.svg?raw'
import iconDelete from '@/assets/icons/delete.svg?raw'

const ui = useUiStore()       // 界面状态（折叠/导航）
const chatStore = useChatStore() // 对话数据（历史列表/高亮/打开对话）
const settings = useSettingsStore() // 用户设置（显示名称等，App 启动时已加载）

/* ---------- 历史对话三点菜单（重命名 / 删除） ----------
   菜单与弹窗样式复用全局共享类（local-overrides.css 末尾），
   与书架卡片菜单（ShelfView.vue）视觉一致。 */
const menuChat = ref(null)   // 当前弹出菜单对应的对话（null 关闭）
const menuPos = ref({})      // 菜单定位：三点按钮右侧
const renameTarget = ref(null) // 正在重命名的对话
const renameText = ref('')
const renaming = ref(false)
const deleting = ref(false)  // 删除确认弹窗

/** 点击三点按钮：在按钮右侧弹出操作菜单 */
function openChatMenu(chat, evt) {
  menuChat.value = chat
  const r = evt.currentTarget.getBoundingClientRect()
  menuPos.value = { left: `${r.right + 8}px`, top: `${r.top}px` }
}

function startRename() {
  renameTarget.value = menuChat.value
  renameText.value = renameTarget.value.title
  menuChat.value = null
  renaming.value = true
}

async function confirmRename() {
  const t = renameText.value.trim()
  if (t && renameTarget.value) {
    try {
      await chatStore.renameChat(renameTarget.value.id, t)
    } catch {
      /* 失败时 store 已回滚标题，这里仅关闭弹窗 */
    }
  }
  renaming.value = false
}

function askDelete() {
  renameTarget.value = menuChat.value // 复用变量存待删除对话
  menuChat.value = null
  deleting.value = true
}

async function confirmDelete() {
  if (renameTarget.value) {
    try {
      await chatStore.deleteChat(renameTarget.value.id)
    } catch {
      /* 失败时保留列表项，仅关闭弹窗 */
    }
  }
  renameTarget.value = null
  deleting.value = false
}
</script>

<template>
  <!--
    折叠态悬浮工具栏
    当 sidebarCollapsed 为 true 时显示：包含 Logo、展开、搜索、新对话按钮，
    使用 rail-* 过渡动画淡入淡出。
    注意：必须与下方 .dc04ec1d 主容器平级，不能嵌在其内部——
    主容器折叠时带有 transform，会让内部 position:fixed 改为相对主容器定位，
    导致工具栏被一起带出屏幕左侧（按钮落在负坐标区域、无法点击）
  -->
  <Transition name="rail">
    <div
      v-if="ui.sidebarCollapsed"
      class="ca6d4be1 _5a20a69"
    >
      <!-- 折叠态 Logo（点击展开侧边栏） -->
      <div
        class="_6acebc2"
        role="button"
        aria-label="DeepRead Logo（展开侧边栏）"
        tabindex="0"
        v-html="iconLogoMark"
        @click="ui.toggleSidebar()"
      ></div>

      <!-- 折叠态功能按钮组 -->
      <div class="e5bf614e">
        <div></div>

        <!-- 展开侧边栏 -->
        <div
          role="button"
          aria-label="展开侧边栏"
          class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--m ds-button--icon-relative-m _4f3769f"
          tabindex="0"
          @click="ui.toggleSidebar()"
        >
          <div class="ds-button__background"></div>
          <div class="ds-button__icon ds-button__icon--last-child">
            <div class="ds-icon" style="font-size: inherit;" v-html="iconSidebarToggle"></div>
          </div>
        </div>

        <!-- 搜索（进入搜索页） -->
        <div
          role="button"
          aria-label="搜索"
          class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--m ds-button--icon-relative-m _4f3769f"
          tabindex="0"
          @click="ui.goSearch()"
        >
          <div class="ds-button__background"></div>
          <div class="ds-button__icon ds-button__icon--last-child">
            <div class="ds-icon" style="font-size: inherit;" v-html="iconSearch"></div>
          </div>
        </div>

        <!-- 新对话 -->
        <div
          role="button"
          aria-label="开启新对话"
          class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--m ds-button--icon-relative-m _4f3769f"
          tabindex="0"
          @click="ui.newChat()"
        >
          <div class="ds-button__background"></div>
          <div class="ds-button__icon ds-button__icon--last-child">
            <div class="ds-icon" style="font-size: inherit;" v-html="iconNewChat"></div>
          </div>
        </div>
      </div>
    </div>
  </Transition>

  <!--
    侧边栏主容器：
    - 折叠时通过 transform 整体左移收起（a02af2e6 类），内部主面板同时淡出（_70b689f 类）
  -->
  <div
    class="dc04ec1d"
    :class="{ a02af2e6: ui.sidebarCollapsed }"
  >
    <!-- 主面板：Logo、新对话入口、对话历史列表、用户卡块 -->
    <div class="b8812f16 a2f3d50e" :class="{ _70b689f: ui.sidebarCollapsed }">
      <!-- 顶部：Logo 与顶部操作按钮（搜索、折叠） -->
      <div class="_262baab">
        <!-- 点击 Logo 返回主页 -->
        <div
          class="e066abb8"
          role="button"
          aria-label="DeepRead Logo（返回主页）"
          tabindex="0"
          v-html="iconLogoDeepread"
          @click="ui.goHome()"
        ></div>
        <div class="_23e1c55">
          <!-- 搜索按钮（进入搜索页） -->
          <div
            role="button"
            aria-label="搜索"
            class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--sizing-content d05a0287"
            tabindex="0"
            style="--dsl-button-height: 34px;"
            @click="ui.goSearch()"
          >
            <div class="ds-button__background"></div>
            <div class="ds-button__icon ds-button__icon--last-child">
              <div class="ds-icon" style="font-size: inherit;" v-html="iconSearch"></div>
            </div>
          </div>

          <!-- 折叠侧边栏 -->
          <div
            role="button"
            aria-label="折叠侧边栏"
            class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--sizing-content _7d1f5e2"
            tabindex="0"
            style="--dsl-button-height: 34px;"
            @click="ui.toggleSidebar()"
          >
            <div class="ds-button__background"></div>
            <div class="ds-button__icon ds-button__icon--last-child">
              <div class="ds-icon" style="font-size: inherit;" v-html="iconSidebarToggle"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 新对话入口 -->
      <div
        class="_5a8ac7a a084f19e"
        tabindex="0"
        @click="ui.newChat()"
        style="justify-content: center;"
      >
        <div class="ds-icon _1c42ad7" style="font-size: 16px; width: 16px; height: 16px;" v-html="iconNewChat"></div>
        <span>开启新对话</span>
        <div class="ds-focus-ring"></div>
      </div>

      <!-- 可滚动历史会话区域：渲染对话历史列表（内存态，刷新后为空） -->
      <div class="_3586175 ds-scroll-area ds-scroll-area--show-on-focus-within ds-scroll-area--enabled">
        <div class="ds-scroll-area__gutters">
          <div class="ds-scroll-area__horizontal-gutter">
            <div class="ds-scroll-area__horizontal-bar"></div>
          </div>
          <div class="ds-scroll-area__vertical-gutter">
            <div class="ds-scroll-area__vertical-bar"></div>
          </div>
        </div>
        <div class="_6d215eb ds-scroll-area ds-scroll-area--show-on-focus-within ds-scroll-area--enabled">
          <!--
            对话历史列表（结构与样式复刻原站，无日期分组）
            条目三种状态（样式见 ui.css ._546d736 规则）：
            - 默认（未进入对话、未悬停）：无背景色
            - hover（未进入对话）：rgb(241, 243, 245)
            - 选中（b64fb9ae，进入对话后）：rgb(228, 237, 253) 恒定，不受悬停影响
          -->
          <div class="_77cdc67 _8a693f3">
            <a
              v-for="chat in chatStore.chats"
              :key="chat.id"
              class="_546d736"
              :class="{ b64fb9ae: chatStore.activeChatId === chat.id }"
              tabindex="0"
              @click="chatStore.openChat(chat.id)"
            >
              <div class="ds-focus-ring"></div>
              <!-- 条目标题（单行截断） -->
              <div class="c08e6e93">{{ chat.title }}</div>
              <!-- 更多操作：默认隐藏，hover / 选中时经渐变遮罩浮现。
                   mousedown.prevent：阻止鼠标点击获取焦点——否则点击后 :focus-within
                   会让条目一直保持悬停背景色（rgb(241,243,245)），鼠标移开也不消失；
                   键盘 Tab 聚焦不受影响 -->
              <div class="_254829d">
                <div
                  role="button"
                  aria-label="更多操作"
                  class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-l _2090548"
                  tabindex="0"
                  @mousedown.prevent
                  @click.stop="openChatMenu(chat, $event)"
                >
                  <div class="ds-button__background"></div>
                  <div class="ds-button__icon ds-button__icon--last-child">
                    <div class="ds-icon" style="font-size: inherit;" v-html="iconMoreDots"></div>
                  </div>
                </div>
              </div>
            </a>
          </div>
        </div>
        <div class="_1d72f01"></div>
      </div>

      <!-- 底部：用户头像与入口（点击进入用户设置页）。
           不设 tabindex / 焦点环：点击后按 Esc 会触发 :focus-visible 蓝色描边，
           与其他入口表现不一致，纯鼠标入口即可 -->
      <div class="_2afd28d" @click="ui.goUser()">
        <div class="ede5bc47">
          <div class="ds-icon" style="font-size: inherit;" v-html="iconUserAvatar"></div>
        </div>
        <div class="_9d8da05">{{ settings.displayName || '用户' }}</div>
        <div class="ds-icon _39cc453" style="font-size: 16px; width: 16px; height: 16px;" v-html="iconMoreDots"></div>
      </div>
    </div>
  </div>

  <!-- 历史对话操作菜单：重命名 / 删除（样式与书架卡片菜单共享全局类） -->
  <div v-if="menuChat" class="menu-backdrop" @click="menuChat = null">
    <div class="card-menu" :style="menuPos" @click.stop>
      <button class="menu-item" @click="startRename">
        <span class="menu-icon" v-html="iconEdit"></span>重命名
      </button>
      <button class="menu-item menu-danger" @click="askDelete">
        <span class="menu-icon" v-html="iconDelete"></span>删除
      </button>
    </div>
  </div>

  <!-- 重命名弹窗（与书架页统一：ds-modal 结构 + 灰描边 + 胶囊按钮） -->
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
          placeholder="输入新的对话标题"
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

  <!-- 删除确认弹窗 -->
  <div v-if="deleting" class="modal-backdrop" @click="deleting = false">
    <div class="ds-modal-content ds-elevated ds-modal-content--dialog modal-stroke" role="dialog" @click.stop>
      <div class="ds-modal-content__header-wrapper">
        <div class="ds-modal-content__title">是否确认删除？</div>
      </div>
      <div class="ds-modal-content__main">确认删除后，该对话及其全部消息将不可恢复</div>
      <div class="ds-modal-content__footer">
        <div class="ds-modal-content__button-group">
          <button class="modal-btn" @click="deleting = false">取消</button>
          <button class="modal-btn modal-btn--danger" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<!-- 样式说明：
     1. 侧边栏展开/折叠的过渡动画（.b8812f16 面板与 .rail-* 工具栏）
        已包含在全局样式 src/styles/ui.css 开头，此处无需重复定义。
     2. 对话历史列表（._546d736 条目 / .b64fb9ae 选中态 / .f3d18f6a 分组标题等）
        的样式同样来自 src/styles/ui.css（与原站一致），此处无需自定义样式。 -->
