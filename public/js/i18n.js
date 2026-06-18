/*
 * i18n.js — translatable UI strings for the Uiineed Todo List.
 *
 * Each language is one block with the SAME set of keys. To add a language,
 * copy the `en` block, translate the values, and add it here (then add a link
 * in the language switcher). English (`en`) is the fallback for any missing key.
 *
 * Keep keys semantic (e.g. `filterTrash`, not `button7`) so translators have context.
 * `{n}` style placeholders are filled in by the app via the `tf()` helper.
 */
window.I18N = {
    en: {
        // Header / add bar
        addPlaceholder: 'Add a to-do item...',
        addBtn: 'Add',
        enterContent: '💡Please enter content!',

        // List + status
        markAllDone: 'Mark All Done',
        editPlaceholder: 'Edit Todo...',
        itemsRemaining: '{n} items remaining',
        allCompleted: 'All completed, good job!',
        finishAlt: 'Mark as Incomplete',
        restoreAlt: 'Restore',
        deleteAlt: 'Delete',
        submitAlt: 'Submit',

        // Empty-state tips
        tipsList: [
            'Add Your First To-Do Item! 📝',
            'Usage Tips 💡:',
            '✔️ Press Enter to submit actions.',
            '✔️ Drag to reorder your to-dos.',
            '✔️ Double-click to edit slogan and tasks.',
            '✔️ Access quick actions in the right sidebar.',
            '🔒 Your data is stored locally in your browser.',
            '📝 Supports data download and import.'
        ],

        // Sidebar
        quicks: 'Quicks',
        filterAll: 'All',
        filterOngoing: 'In Progress',
        filterCompleted: 'Completed',
        filterTrash: 'Trash',
        finishAll: 'Finish all',
        clearCompletedBtn: 'Clear Completed',
        clearAllBtn: 'Clear All',
        sortAZ: 'Sort A–Z',
        exportFile: 'Export file',
        copyClipboard: 'Copy',
        importFile: 'Import file',
        pasteClipboard: 'Paste',
        bulkAdd: 'Add many',
        reload: 'Reload',
        reloadTitle: 'Reload the page (useful for Home Screen web apps)',

        // Bulk-add modal
        bulkTitle: 'Add many items',
        bulkHint: 'Paste or type one item per line.',
        bulkPlaceholder: 'Buy milk\nCall the dentist\nFinish the report',
        bulkConfirm: 'Add items',
        bulkCancel: 'Cancel',

        // Paste-import fallback modal
        pasteTitle: 'Paste data to import',
        pasteHint: 'Paste exported JSON, or one item per line.',
        pasteConfirm: 'Import',
        pasteCancel: 'Cancel',

        // Dialog (alert/confirm) chrome
        dialogOK: 'OK',
        dialogCancel: 'Cancel',
        dialogPromptTitle: 'Notice',
        dialogConfirmTitle: 'Please Confirm',
        errorTitle: 'Error',

        // Dialog messages
        confirmMarkAll: 'Confirm to mark all as completed?',
        confirmClearCompleted: 'Confirm to clear all completed items?',
        confirmClearAll: 'Confirm to clear all todo items?',
        importEmpty: 'Nothing to import — no items found.',
        importSummary: 'Import done: {added} added, {updated} updated, {skipped} duplicates skipped.',
        bulkSummary: 'Added {added} items, skipped {skipped} duplicates.',
        importParseError: "Couldn't read that data. Make sure it's exported JSON or one item per line.",
        readFileError: 'Error reading file: {name}',
        clipboardCopied: 'Copied {n} items to the clipboard.',
        clipboardCopyError: "Couldn't access the clipboard. Use \"Export file\" instead.",
        clipboardReadError: "Couldn't read the clipboard. Paste your data manually instead.",
        nothingToExport: 'There is nothing to export yet.',

        // Settings + themes
        settings: 'Settings',
        settingsTitle: 'Settings',
        themeLabel: 'Theme',
        themeClassic: 'Classic',
        themeDark: 'Dark',
        themeSepia: 'Sepia',
        themeOcean: 'Ocean',
        themeContrast: 'High Contrast',
        themePastel: 'Pastel',
        themeAuto: 'Auto (system)',
        settingsClose: 'Done',

        // Menu / tabs / context bar / palette
        moreBtn: 'More',
        moreTitle: 'Actions',
        restoreAll: 'Restore all',
        emptyTrash: 'Empty trash',
        confirmEmptyTrash: 'Permanently delete everything in Trash? This cannot be undone.',
        sectionOrganize: 'Organize',
        sectionCleanup: 'Clean up',
        sectionData: 'Data',
        sectionApp: 'App',
        exportLabel: 'Export',
        importLabel: 'Import',
        channelFile: 'File',
        channelClipboard: 'Clipboard',
        channelPaste: 'Paste',
        paletteTitle: 'Commands',
        palettePlaceholder: 'Search actions…',
        paletteEmpty: 'No matching commands',
        paletteShortcut: '⌘K',

        // Inline confirm + sort
        confirmReady: 'Tap to confirm',
        sortBtn: 'Sort',
        sortTitle: 'Sort by',
        sortZA: 'Sort Z–A',
        sortNewest: 'Newest first',
        sortOldest: 'Oldest first',
        sortRandom: 'Shuffle',
        sortManual: 'Manual order',
        sortLabelManual: 'Manual',
        sortLabelAZ: 'A–Z',
        sortLabelZA: 'Z–A',
        sortLabelNewest: 'Newest',
        sortLabelOldest: 'Oldest',
        sortLabelRandom: 'Shuffled',

        // Cross-device sync
        syncNow: 'Sync now',
        syncIdle: 'Not synced',
        syncSyncing: 'Syncing…',
        syncSynced: 'Synced',
        syncSyncedAt: 'Synced {time}',
        syncOffline: 'Sync unavailable',
        syncError: 'Sync failed',

        defaultSlogan: 'Act Now, Simplify Life.☕'
    },

    zh: {
        // Header / add bar
        addPlaceholder: '新增待办事项...',
        addBtn: '提交',
        enterContent: '💡请输入内容！',

        // List + status
        markAllDone: '全部标为完成',
        editPlaceholder: '编辑 Todo...',
        itemsRemaining: '剩余 {n} 项未完成',
        allCompleted: '完美收工！',
        finishAlt: '标为未完成',
        restoreAlt: '还原',
        deleteAlt: '删除',
        submitAlt: '提交',

        // Empty-state tips
        tipsList: [
            ' 添加你的第一个待办事项！📝',
            '食用方法💡：',
            '✔️ 所有提交操作支持Enter回车键提交',
            '✔️ 拖拽Todo上下移动可排序',
            '✔️ 双击上面的标语和 Todo 可进行编辑',
            '✔️ 右侧的小窗口是快捷操作哦',
            '🔒 所有的Todo数据存储在浏览器本地',
            '📝 支持下载和导入，导入追加到当前序列'
        ],

        // Sidebar
        quicks: '快捷操作',
        filterAll: '全部',
        filterOngoing: '进行中',
        filterCompleted: '已完成',
        filterTrash: '回收站',
        finishAll: '全部标为已完成',
        clearCompletedBtn: '清除已完成',
        clearAllBtn: '清除全部',
        sortAZ: '排序 A–Z',
        exportFile: '导出文件',
        copyClipboard: '复制',
        importFile: '导入文件',
        pasteClipboard: '粘贴',
        bulkAdd: '批量添加',
        reload: '刷新',
        reloadTitle: '刷新页面（适用于添加到主屏幕的网页应用）',

        // Bulk-add modal
        bulkTitle: '批量添加待办',
        bulkHint: '每行一条，粘贴或输入。',
        bulkPlaceholder: '买牛奶\n预约牙医\n完成报告',
        bulkConfirm: '添加',
        bulkCancel: '取消',

        // Paste-import fallback modal
        pasteTitle: '粘贴要导入的数据',
        pasteHint: '粘贴导出的 JSON，或每行一条。',
        pasteConfirm: '导入',
        pasteCancel: '取消',

        // Dialog (alert/confirm) chrome
        dialogOK: '确定',
        dialogCancel: '取消',
        dialogPromptTitle: '提示',
        dialogConfirmTitle: '请确认',
        errorTitle: '错误',

        // Dialog messages
        confirmMarkAll: '确认全部标记为已完成？',
        confirmClearCompleted: '确认清除所有已完成的待办？',
        confirmClearAll: '确认清除所有待办事项？',
        importEmpty: '没有可导入的内容。',
        importSummary: '导入完成：新增 {added} 条，更新 {updated} 条，跳过重复 {skipped} 条。',
        bulkSummary: '已添加 {added} 条，跳过重复 {skipped} 条。',
        importParseError: '无法解析数据，请确保是导出的 JSON 或每行一条。',
        readFileError: '读取文件出错：{name}',
        clipboardCopied: '已复制 {n} 条到剪贴板。',
        clipboardCopyError: '无法访问剪贴板，请改用“导出文件”。',
        clipboardReadError: '无法读取剪贴板，请手动粘贴数据。',
        nothingToExport: '暂时没有可导出的内容。',

        // Settings + themes
        settings: '设置',
        settingsTitle: '设置',
        themeLabel: '主题',
        themeClassic: '经典',
        themeDark: '深色',
        themeSepia: '复古棕',
        themeOcean: '海洋',
        themeContrast: '高对比',
        themePastel: '柔和',
        themeAuto: '跟随系统',
        settingsClose: '完成',

        // 菜单 / 标签 / 上下文操作 / 命令面板
        moreBtn: '更多',
        moreTitle: '操作',
        restoreAll: '全部还原',
        emptyTrash: '清空回收站',
        confirmEmptyTrash: '永久删除回收站中的所有项目？此操作无法撤销。',
        sectionOrganize: '整理',
        sectionCleanup: '清理',
        sectionData: '数据',
        sectionApp: '应用',
        exportLabel: '导出',
        importLabel: '导入',
        channelFile: '文件',
        channelClipboard: '剪贴板',
        channelPaste: '粘贴',
        paletteTitle: '命令',
        palettePlaceholder: '搜索操作…',
        paletteEmpty: '没有匹配的命令',
        paletteShortcut: '⌘K',

        // 行内确认 + 排序
        confirmReady: '点击确认',
        sortBtn: '排序',
        sortTitle: '排序方式',
        sortZA: '排序 Z–A',
        sortNewest: '最新在前',
        sortOldest: '最早在前',
        sortRandom: '随机打乱',
        sortManual: '手动排序',
        sortLabelManual: '手动',
        sortLabelAZ: 'A–Z',
        sortLabelZA: 'Z–A',
        sortLabelNewest: '最新',
        sortLabelOldest: '最早',
        sortLabelRandom: '已打乱',

        // 跨设备同步
        syncNow: '立即同步',
        syncIdle: '尚未同步',
        syncSyncing: '同步中…',
        syncSynced: '已同步',
        syncSyncedAt: '已同步 {time}',
        syncOffline: '同步不可用',
        syncError: '同步失败',

        defaultSlogan: '立即行动，简化生活。☕'
    }
};
