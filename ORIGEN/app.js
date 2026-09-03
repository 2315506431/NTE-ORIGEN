/**
 * 异环 · 经营助手 - 主逻辑
 * 
 * 核心功能：
 * 1. 用户配置拥有的雇员及等级
 * 2. 系统自动推荐最优10人+5菜搭配
 */

// ========== 全局状态 ==========
const state = {
    employees: [],          // 所有雇员数据
    items: [],              // 所有商品数据
    announcements: [],      // 公告数据
    selectedWindVane: null, // 当前选中的风向标
    employeeStates: {},     // 雇员状态 { id: { owned: boolean, level: number } }
    itemStates: {},         // 菜品状态 { id: { level: number } } 0=未拥有, 1=1级, 2=2级
};

// ========== 常量 ==========
// 根据店铺数量动态计算最大雇员和菜品数
// 每店铺解锁2雇员+1菜品
function getMaxEmployees() {
    return ADVANCED_SETTINGS.shopCount * 2;
}

function getMaxDishes() {
    return ADVANCED_SETTINGS.shopCount;
}



// ========== 高级设置参数 ==========
const ADVANCED_SETTINGS = {
    decorationBonus: 0.09,
    baseTraffic: 2400,
    shopCount: 5,
    exclusiveServiceEnabled: false,
    windVaneEnabled: true,
    cyclePrediction: false, // 6天预测模式
};

// ========== 高级设置本地存储 ==========
const ADVANCED_SETTINGS_KEY = 'yihuan_advanced_settings';

// ========== 公告已读状态本地存储 ==========
const ANNOUNCEMENT_READ_KEY = 'yihuan_announcement_read_max_id';

function getMaxReadAnnouncementId() {
    try {
        const saved = localStorage.getItem(ANNOUNCEMENT_READ_KEY);
        return saved ? parseInt(saved, 10) : 0;
    } catch (error) {
        console.error('读取公告已读状态失败:', error);
        return 0;
    }
}

function saveMaxReadAnnouncementId(maxId) {
    try {
        localStorage.setItem(ANNOUNCEMENT_READ_KEY, maxId.toString());
    } catch (error) {
        console.error('保存公告已读状态失败:', error);
    }
}

function getMaxAnnouncementId() {
    if (!state.announcements.length) return 0;
    return Math.max(...state.announcements.map(a => a.id || 0));
}

function hasNewAnnouncements() {
    return getMaxAnnouncementId() > getMaxReadAnnouncementId();
}

function saveAdvancedSettings() {
    try {
        localStorage.setItem(ADVANCED_SETTINGS_KEY, JSON.stringify({
            decorationBonus: ADVANCED_SETTINGS.decorationBonus,
            baseTraffic: ADVANCED_SETTINGS.baseTraffic,
            shopCount: ADVANCED_SETTINGS.shopCount,
            exclusiveServiceEnabled: ADVANCED_SETTINGS.exclusiveServiceEnabled,
            windVaneEnabled: ADVANCED_SETTINGS.windVaneEnabled,
            cyclePrediction: ADVANCED_SETTINGS.cyclePrediction,
        }));
    } catch (error) {
        console.error('保存高级设置失败:', error);
    }
}

function loadAdvancedSettings() {
    try {
        const saved = localStorage.getItem(ADVANCED_SETTINGS_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            ADVANCED_SETTINGS.decorationBonus = data.decorationBonus ?? 0.09;
            ADVANCED_SETTINGS.baseTraffic = data.baseTraffic ?? 2400;
            ADVANCED_SETTINGS.shopCount = data.shopCount ?? 5;
            ADVANCED_SETTINGS.exclusiveServiceEnabled = data.exclusiveServiceEnabled ?? false;
            ADVANCED_SETTINGS.windVaneEnabled = data.windVaneEnabled ?? true;
            ADVANCED_SETTINGS.cyclePrediction = data.cyclePrediction ?? false;
        }
    } catch (error) {
        console.error('加载高级设置失败:', error);
    }
}

// ========== 自动风向标计算 ==========
// 循环顺序：面粉(0) → 水果(1) → 咖啡豆(2) → 主食(3) → 甜品(4) → 饮料(5) → 面粉...
// 基准日期：2026-07-04 12:00 = 面粉(0)
// 2026-07-08 12:00 = 甜品(4) → 验证：(8-4)=4天 → 4%6=4 ✓
function getTodayWindVane() {
    const cycle = ['面粉', '水果', '咖啡豆', '主食', '甜品', '饮料'];
    const now = new Date();
    
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    const baseDate = new Date(2026, 6, 4, 12, 0, 0); // 基准日期：2026-07-04 12:00
    
    // 根据当前时间确定所处风向标周期的12点
    // 未到今天12点，当前风向标是昨天12点切换的；已过今天12点，是今天12点切换的
    let currentPeriodNoon;
    if (now >= todayNoon) {
        currentPeriodNoon = todayNoon;
    } else {
        currentPeriodNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0);
    }
    
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const daysDiff = Math.floor((currentPeriodNoon.getTime() - baseDate.getTime()) / millisecondsPerDay);
    
    const index = ((daysDiff % cycle.length) + cycle.length) % cycle.length;
    
    const category = cycle[index];
    const bonus = ['面粉', '水果', '咖啡豆'].includes(category) ? 0.75 : 1;
    
    return { category, bonus, index };
}

function getNextWindVane() {
    const cycle = ['面粉', '水果', '咖啡豆', '主食', '甜品', '饮料'];
    const current = getTodayWindVane();
    const nextIndex = (current.index + 1) % cycle.length;
    return { category: cycle[nextIndex], bonus: ['面粉', '水果', '咖啡豆'].includes(cycle[nextIndex]) ? 0.75 : 1 };
}

// 获取以今天为第1天的未来6天风向标列表
function getUpcomingWindVanes(days = 6) {
    const cycle = ['面粉', '水果', '咖啡豆', '主食', '甜品', '饮料'];
    const current = getTodayWindVane();
    const result = [];
    for (let i = 0; i < days; i++) {
        const idx = (current.index + i) % cycle.length;
        const category = cycle[idx];
        result.push({
            category,
            bonus: ['面粉', '水果', '咖啡豆'].includes(category) ? 0.75 : 1,
            index: idx,
            dayOffset: i,
        });
    }
    return result;
}

// ========== 高级设置模态框 ==========
function openAdvancedSettingsModal() {
    const modal = document.getElementById('advanced-settings-modal');
    const decorationInput = document.getElementById('decoration-bonus-input');
    const trafficInput = document.getElementById('base-traffic-input');
    const exclusiveServiceSwitch = document.getElementById('exclusive-service-switch');
    const windVaneSwitch = document.getElementById('windvane-switch');
    const resetTrafficBtn = document.getElementById('reset-traffic-btn');
    
    // 填充当前值
    decorationInput.value = ADVANCED_SETTINGS.decorationBonus.toFixed(3);
    trafficInput.value = ADVANCED_SETTINGS.baseTraffic;
    exclusiveServiceSwitch.checked = ADVANCED_SETTINGS.exclusiveServiceEnabled;
    windVaneSwitch.checked = ADVANCED_SETTINGS.windVaneEnabled;
    
    // 重置人流量按钮
    if (resetTrafficBtn) {
        resetTrafficBtn.onclick = () => {
            trafficInput.value = 2400;
            ADVANCED_SETTINGS.baseTraffic = 2400;
            saveAdvancedSettings();
        };
    }
    
    // 更新店铺数量选择器
    updateShopCountSelector();
    
    // 渲染菜品设置列表
    renderItemSettingsList();
    
    // 初始化菜品设置布局监听
    initItemSettingsResizeObserver();
    
    modal.classList.remove('hidden');
}

// ========== 更新店铺数量选择器 ==========
function updateShopCountSelector() {
    const container = document.getElementById('shop-count-selector');
    if (!container) return;
    
    container.innerHTML = [1, 2, 3, 4, 5].map(num => `
        <button class="shop-count-btn ${ADVANCED_SETTINGS.shopCount === num ? 'active' : ''}" 
                data-shop-count="${num}">
            ${num}
        </button>
    `).join('');
    
    // 绑定点击事件
    container.querySelectorAll('.shop-count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            ADVANCED_SETTINGS.shopCount = parseInt(btn.dataset.shopCount);
            saveAdvancedSettings();
            updateShopCountSelector();
        });
    });
    
    // 更新提示信息
    updateShopCountInfo();
}

// ========== 更新店铺数量提示信息 ==========
function updateShopCountInfo() {
    const countSpan = document.getElementById('shop-count-info');
    const dishSpan = document.getElementById('shop-count-dish-info');
    
    if (countSpan) {
        countSpan.textContent = ADVANCED_SETTINGS.shopCount * 2;
    }
    if (dishSpan) {
        dishSpan.textContent = ADVANCED_SETTINGS.shopCount;
    }
}

// ========== 渲染菜品设置列表 ==========
function renderItemSettingsList() {
    const container = document.getElementById('item-settings-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    state.items.forEach(item => {
        const itemState = state.itemStates[item.id];
        
        const card = document.createElement('div');
        card.className = `employee-card ${itemState.level > 0 ? 'active' : ''}`;
        card.id = `item-card-${item.id}`;
        
        card.innerHTML = `
            <div class="employee-info">
                <div class="employee-name" style="display: flex; align-items: center; height: 100%;">${item.name}</div>
            </div>
            <div class="employee-controls">
                <div class="level-selector" id="item-level-selector-${item.id}">
                    <span class="level-label">Lv.</span>
                    ${[1, 2].map(lv => `
                        <button class="level-btn ${itemState.level === lv ? 'active' : ''}"
                                data-item-id="${item.id}" data-level="${lv}">
                            ${lv}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
        
        container.appendChild(card);
        
        card.querySelectorAll('.level-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const clickedLevel = parseInt(btn.dataset.level);
                const currentState = state.itemStates[item.id];
                
                if (currentState.level === clickedLevel) {
                    currentState.level = 0;
                    card.classList.remove('active');
                    card.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
                } else {
                    currentState.level = clickedLevel;
                    card.classList.add('active');
                    card.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
                
                saveItemStates(); // 自动保存
            });
        });
    });
    
    // 绑定批量按钮事件
    document.querySelectorAll('.bulk-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const level = parseInt(btn.dataset.level);
            setAllItemsLevel(level);
        });
    });
    
    checkItemSettingsLayout();
}

function checkItemSettingsLayout() {
    const container = document.getElementById('item-settings-list');
    const cards = container ? container.querySelectorAll('.employee-card') : [];
    if (cards.length === 0 || !container) return;
    
    cards.forEach(card => card.style.transition = 'none');
    container.style.transition = 'none';
    
    container.classList.remove('single-column');
    
    container.getBoundingClientRect();
    
    let maxCardWidth = 0;
    cards.forEach(card => {
        const cardWidth = card.scrollWidth;
        maxCardWidth = Math.max(maxCardWidth, cardWidth);
    });
    
    const containerWidth = container.getBoundingClientRect().width;
    const gap = 12;
    const twoColMinWidth = maxCardWidth * 2 + gap;
    
    if (containerWidth >= twoColMinWidth) {
        container.classList.remove('single-column');
    } else {
        container.classList.add('single-column');
    }
    
    cards.forEach(card => card.style.transition = '');
    container.style.transition = '';
}

let itemSettingsResizeObserver = null;

function initItemSettingsResizeObserver() {
    const container = document.getElementById('item-settings-list');
    if (!container || itemSettingsResizeObserver) return;
    
    itemSettingsResizeObserver = new ResizeObserver(() => {
        checkItemSettingsLayout();
    });
    
    itemSettingsResizeObserver.observe(container);
}

// ========== 设置所有菜品等级 ==========
function setAllItemsLevel(level) {
    state.items.forEach(item => {
        state.itemStates[item.id].level = level;
    });
    
    saveItemStates();
    renderItemSettingsList();
}

// ========== 公告弹窗 ==========
function openAnnouncementModal() {
    const modal = document.getElementById('announcement-modal');
    
    // 渲染公告
    renderAnnouncements();
    
    // 保存当前最大id为已读
    const maxId = getMaxAnnouncementId();
    if (maxId > 0) {
        saveMaxReadAnnouncementId(maxId);
        // 移除按钮红点
        updateAnnouncementButtonBadge();
    }
    
    modal.classList.remove('hidden');
}

function closeAnnouncementModal() {
    const modal = document.getElementById('announcement-modal');
    modal.classList.add('hidden');
}

function updateAnnouncementButtonBadge() {
    const hasNew = hasNewAnnouncements();
    const btn = document.getElementById('announcement-btn');
    const btnFloat = document.getElementById('announcement-btn-float');
    
    if (btn) {
        btn.classList.toggle('announcement-btn-new', hasNew);
    }
    if (btnFloat) {
        btnFloat.classList.toggle('announcement-btn-new', hasNew);
    }
}

function closeAdvancedSettingsModal() {
    const modal = document.getElementById('advanced-settings-modal');
    modal.classList.add('hidden');
}

// ========== 自定义确认弹窗 ==========
let confirmCallback = null;

function showConfirmDialog({ title = '确认', message = '', onConfirm = null }) {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    if (!modal || !titleEl || !messageEl) return;

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmCallback = onConfirm;

    modal.classList.remove('hidden');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    confirmCallback = null;
}

function clearAllLocalData() {
    showConfirmDialog({
        title: '⚠️ 危险操作',
        message: '确定要清除所有本地数据吗？这将包括雇员配置、菜品配置、设置和公告已读状态。此操作不可撤销！',
        onConfirm: () => {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(ITEM_STORAGE_KEY);
            localStorage.removeItem(ADVANCED_SETTINGS_KEY);
            localStorage.removeItem(ANNOUNCEMENT_READ_KEY);

            // 重置状态
            ADVANCED_SETTINGS.decorationBonus = 0.09;
            ADVANCED_SETTINGS.baseTraffic = 2400;
            ADVANCED_SETTINGS.shopCount = 5;

            // 重置雇员状态
            state.employees.forEach(emp => {
                state.employeeStates[emp.id] = {
                    owned: false,
                    level: 1,
                };
            });

            state.items.forEach(item => {
                state.itemStates[item.id] = {
                    level: 2,
                };
            });

            // 清空推荐结果
            const resultContainer = document.getElementById('recommendation-result');
            const calcDetailSection = document.querySelector('.calc-detail-section');
            if (resultContainer) {
                resultContainer.innerHTML = '<div class="recommendation-placeholder"><p>配置拥有的雇员后，点击上方按钮计算最优方案</p></div>';
            }
            if (calcDetailSection) {
                calcDetailSection.classList.add('hidden');
            }

            closeAdvancedSettingsModal();

            // 刷新页面以应用新数据
            location.reload();
        }
    });
}

// ========== 更新雇员列表 ==========
function updateEmployeeList() {
    renderEmployeeList();
}

// ========== 数据加载 ==========
async function loadData() {
    const loadingOverlay = document.getElementById('loading-overlay');
    try {
        loadingOverlay.classList.remove('hidden');
        
        const [employeesRes, itemsRes, announcementsRes] = await Promise.all([
            fetch('./ORIGEN/data/employees.json'),
            fetch('./ORIGEN/data/items.json'),
            fetch('./ORIGEN/data/announcements.json'),
        ]);

        state.employees = await employeesRes.json();
        state.items = await itemsRes.json();
        state.announcements = await announcementsRes.json();

        loadAdvancedSettings();

        state.employees.forEach(emp => {
            if (!state.employeeStates[emp.id]) {
                state.employeeStates[emp.id] = {
                    owned: false,
                    level: 1,
                };
            }
        });

        const savedStates = loadEmployeeStates();
        if (savedStates) {
            Object.keys(savedStates).forEach(empId => {
                state.employeeStates[empId] = savedStates[empId];
            });
        }

        const savedItemStates = loadItemStates();
        
        state.items.forEach(item => {
            if (savedItemStates && savedItemStates[item.id]) {
                const saved = savedItemStates[item.id];
                if (saved.level !== undefined) {
                    state.itemStates[item.id] = { level: saved.level };
                } else if (saved.owned === false) {
                    state.itemStates[item.id] = { level: 0 };
                } else {
                    state.itemStates[item.id] = { level: saved.level || 2 };
                }
            } else {
                state.itemStates[item.id] = { level: 2 };
            }
        });

        initUI();
        
        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
        }, 300);
    } catch (error) {
        console.error('数据加载失败:', error);
        loadingOverlay.innerHTML = '<div class="loading-spinner"></div><p>数据加载失败，请刷新重试</p>';
        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
        }, 2000);
    }
}

// ========== 渲染公告 ==========
function renderAnnouncements() {
    const container = document.getElementById('announcement-content');
    if (!container) return;
    
    if (state.announcements.length === 0 || (state.announcements.length === 1 && !state.announcements[0].title)) {
        container.innerHTML = `<div class="announcement-empty">暂无公告</div>`;
        return;
    }
    
    const maxReadId = getMaxReadAnnouncementId();
    
    // 按id倒序排列（大的在上面）
    const sortedAnnouncements = [...state.announcements].sort((a, b) => (b.id || 0) - (a.id || 0));
    
    container.innerHTML = sortedAnnouncements.map(ann => {
        if (!ann.title && !ann.time && !ann.content) return '';
        const isNew = ann.id && ann.id > maxReadId;
        return `
        <div class="announcement-item ${isNew ? 'announcement-item-new' : ''}">
            <div class="announcement-item-header">
                <div class="announcement-item-title">
                    ${isNew ? '<span class="announcement-new-badge">新</span>' : ''}
                    ${ann.title}
                </div>
                <div class="announcement-item-date">${ann.time}</div>
            </div>
            <div class="announcement-item-body">
                ${ann.content}
            </div>
        </div>
    `}).join('');
}

// ========== 初始化UI ==========
function initUI() {
    updateAnnouncementButtonBadge();
    renderCurrentWindVane();
    updateEmployeeList();
    initCollapsibleSections();
    initWindVaneResizeObserver();
    initCyclePredictionSwitch();
}

function initCyclePredictionSwitch() {
    const switchEl = document.getElementById('cycle-prediction-switch');
    if (!switchEl) return;
    switchEl.checked = ADVANCED_SETTINGS.cyclePrediction;
    switchEl.addEventListener('change', () => {
        ADVANCED_SETTINGS.cyclePrediction = switchEl.checked;
        saveAdvancedSettings();
    });
}

// ========== 初始化可折叠菜单 ==========
function initCollapsibleSections() {
    // 菜品设置
    const itemSettingsToggle = document.getElementById('item-settings-toggle');
    const itemSettingsSection = document.getElementById('item-settings-content')?.parentElement;
    const itemSettingsArrow = itemSettingsToggle?.querySelector('.collapsible-arrow');
    
    if (itemSettingsToggle && itemSettingsSection) {
        itemSettingsToggle.addEventListener('click', () => {
            itemSettingsSection.classList.toggle('collapsed');
            if (itemSettingsArrow) {
                itemSettingsArrow.textContent = itemSettingsSection.classList.contains('collapsed') ? '☰' : '▼';
            }
            // 展开时重新检查菜品设置布局（折叠时容器宽度为0，初次渲染会误判为单列）
            if (!itemSettingsSection.classList.contains('collapsed')) {
                requestAnimationFrame(() => {
                    checkItemSettingsLayout();
                    initItemSettingsResizeObserver();
                });
            }
        });
    }
    
    // 其他设置
    const otherSettingsToggle = document.getElementById('other-settings-toggle');
    const otherSettingsSection = document.getElementById('other-settings-content')?.parentElement;
    const otherSettingsArrow = otherSettingsToggle?.querySelector('.collapsible-arrow');
    
    if (otherSettingsToggle && otherSettingsSection) {
        otherSettingsToggle.addEventListener('click', () => {
            otherSettingsSection.classList.toggle('collapsed');
            if (otherSettingsArrow) {
                otherSettingsArrow.textContent = otherSettingsSection.classList.contains('collapsed') ? '☰' : '▼';
            }
        });
    }
}

// ========== 渲染当前风向标 ==========
function renderCurrentWindVane() {
    const windVaneSection = document.querySelector('.windvane-section');
    
    if (!ADVANCED_SETTINGS.windVaneEnabled) {
        if (windVaneSection) windVaneSection.classList.add('hidden');
        state.selectedWindVane = null;
        return;
    }
    
    if (windVaneSection) windVaneSection.classList.remove('hidden');
    
    const windVane = getTodayWindVane();
    const nextWindVane = getNextWindVane();
    
    const nameEl = document.getElementById('windvane-name');
    const bonusEl = document.getElementById('windvane-bonus');
    const nextNameEl = document.getElementById('next-windvane-name');
    const nextBonusEl = document.getElementById('next-windvane-bonus');
    const nextHoursEl = document.getElementById('next-windvane-hours');
    
    if (nameEl) nameEl.textContent = windVane.category;
    if (bonusEl) bonusEl.textContent = `+${windVane.bonus} 方斯`;
    
    if (nextNameEl) nextNameEl.textContent = nextWindVane.category;
    if (nextBonusEl) nextBonusEl.textContent = `+${nextWindVane.bonus} 方斯`;
    
    if (nextHoursEl) {
        const now = new Date();
        const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
        let nextNoon;
        if (now >= todayNoon) {
            nextNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0);
        } else {
            nextNoon = todayNoon;
        }
        const msLeft = nextNoon.getTime() - now.getTime();
        const minutesLeft = Math.floor(msLeft / (1000 * 60));
        if (minutesLeft >= 60) {
            const hoursLeft = Math.floor(minutesLeft / 60);
            nextHoursEl.textContent = `${hoursLeft}小时后`;
        } else {
            nextHoursEl.textContent = `${minutesLeft}分钟后`;
        }
    }
    
    state.selectedWindVane = windVane;
    
    checkWindVaneLayout();
}

function checkWindVaneLayout() {
    const container = document.querySelector('.windvane-container');
    const currentCard = document.getElementById('current-windvane');
    const nextCard = document.getElementById('next-windvane');

    if (!container || !currentCard || !nextCard) return;

    // 测量期间禁用过渡，避免垂直/水平切换时 section.card 高度过渡被频繁打断而抽搐
    const section = container.closest('.card');
    if (section) section.style.transition = 'none';

    // 强制水平布局来检测溢出
    const wasVertical = container.classList.contains('vertical');
    if (wasVertical) {
        container.classList.remove('vertical');
    }
    // 强制重排
    container.offsetWidth;

    // 测量 card 的真实内容宽度：临时让 card 按 max-content 自适应
    // 不能用 scrollWidth，因为 windvane-card 没有 overflow:hidden，nowrap 溢出时 scrollWidth 不反映溢出
    const measureContentWidth = (card) => {
        const origFlex = card.style.flex;
        const origWidth = card.style.width;
        card.style.flex = '0 0 auto';
        card.style.width = 'max-content';
        const w = card.offsetWidth;
        card.style.flex = origFlex;
        card.style.width = origWidth;
        return w;
    };

    const currentContentWidth = measureContentWidth(currentCard);
    const nextContentWidth = measureContentWidth(nextCard);
    // 强制重排以恢复 flex:1 布局后再读取容器宽度
    container.offsetWidth;
    const containerWidth = container.clientWidth;
    const gap = 12;
    const neededWidth = currentContentWidth + nextContentWidth + gap;
    const tolerance = 2;

    if (neededWidth > containerWidth + tolerance) {
        container.classList.add('vertical');
    } else {
        container.classList.remove('vertical');
    }

    // 下一帧恢复过渡
    if (section) {
        requestAnimationFrame(() => { section.style.transition = ''; });
    }
}

let windVaneResizeObserver = null;
let windVaneLayoutTimer = null;

function initWindVaneResizeObserver() {
    // 观察父级 .card-body 而非 windvane-container 本身
    // 避免 windvane-container 自身因 vertical 切换导致高度变化 → 触发 ResizeObserver → 死循环
    const cardBody = document.querySelector('.windvane-section .card-body');
    if (!cardBody || windVaneResizeObserver) return;

    windVaneResizeObserver = new ResizeObserver(() => {
        // debounce：连续 resize 时只执行最后一次，避免高频触发测量
        if (windVaneLayoutTimer) clearTimeout(windVaneLayoutTimer);
        windVaneLayoutTimer = setTimeout(checkWindVaneLayout, 50);
    });

    windVaneResizeObserver.observe(cardBody);
}

// ========== 检查风向标是否适用于菜品 ==========
function isWindVaneApplicable(item, windVane) {
    if (!windVane) return false;
    
    const category = windVane.category;
    
    // 对于"面粉"、"咖啡豆"、"水果"，检查标签
    if (['面粉', '咖啡豆', '水果'].includes(category)) {
        return item.tags && item.tags.includes(category);
    }
    
    // 对于"饮料"、"主食"、"甜品"，检查菜品类别
    if (['饮料', '主食', '甜品'].includes(category)) {
        return item.category === category;
    }
    
    return false;
}

// ========== 雇员列表 ==========
function renderEmployeeList() {
    const container = document.getElementById('employee-list');
    container.innerHTML = '';

    state.employees.forEach(emp => {
        const empState = state.employeeStates[emp.id];

        const card = document.createElement('div');
        card.className = `employee-card ${empState.owned ? 'active' : ''}`;
        card.id = `emp-card-${emp.id}`;

        // 生成等级按钮的title提示
        const levelTitles = [1, 2, 3, 4, 5].map(lv => {
            const bonuses = getLevelBonusDescription(emp, lv);
            return bonuses;
        });

        card.innerHTML = `
            <div class="employee-info">
                <div class="employee-name">${emp.name}</div>
            </div>
            <div class="employee-controls">
                <div class="level-selector" id="level-selector-${emp.id}">
                    <span class="level-label">Lv.</span>
                    ${[1, 2, 3, 4, 5].map((lv, idx) => `
                        <button class="level-btn ${empState.owned && empState.level === lv ? 'active' : ''}"
                                data-emp-id="${emp.id}" data-level="${lv}"
                                title="${levelTitles[idx]}">
                            ${lv}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;

        container.appendChild(card);

        // 绑定等级按钮事件
        card.querySelectorAll('.level-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const clickedLevel = parseInt(btn.dataset.level);
                const currentState = state.employeeStates[emp.id];
                
                if (currentState.owned && currentState.level === clickedLevel) {
                    currentState.owned = false;
                    currentState.level = 0;
                    card.classList.remove('active');
                    card.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
                } else {
                    // 选择等级并设置为拥有
                    currentState.owned = true;
                    currentState.level = clickedLevel;
                    card.classList.add('active');
                    card.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
                
                saveEmployeeStates(); // 自动保存
            });
        });
    });
    
    // 渲染完成后更新布局
    requestAnimationFrame(updateEmployeeCardLayout);
}

// ========== 测量文本像素宽度 ==========
function measureTextWidth(text, element) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const style = window.getComputedStyle(element);
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.font = font;
    return ctx.measureText(text).width;
}

// ========== 动态调整雇员卡片布局 ==========
function updateEmployeeCardLayout() {
    const container = document.getElementById('employee-list');
    const cards = container ? container.querySelectorAll('.employee-card') : [];
    if (cards.length === 0 || !container) return;

    // 临时关闭过渡，确保测量准确
    cards.forEach(card => card.style.transition = 'none');
    container.style.transition = 'none';

    // 先恢复到默认状态（两列横排）再测量，避免当前布局影响测量结果
    container.classList.remove('single-column');
    cards.forEach(card => card.classList.remove('vertical-layout'));

    // 强制浏览器重排，确保恢复生效
    container.getBoundingClientRect();

    // 测量等级选择区域的实际宽度（取第一个作为参考）
    const sampleControls = cards[0].querySelector('.employee-controls');
    const controlsWidth = sampleControls ? sampleControls.getBoundingClientRect().width : 190;

    // 获取容器宽度
    const containerWidth = container.getBoundingClientRect().width;
    const gap = 12; // employee-list gap

    // 找出最长的名字宽度
    let maxNameWidth = 0;
    cards.forEach(card => {
        const nameEl = card.querySelector('.employee-name');
        if (nameEl) {
            const nameWidth = measureTextWidth(nameEl.textContent.trim(), nameEl);
            maxNameWidth = Math.max(maxNameWidth, nameWidth);
        }
    });

    // 计算卡片所需宽度（不依赖当前布局）
    // 横排：名字 + 按钮区 + padding(24) + gap(12) + 安全边距(8)
    const horizontalCardWidth = maxNameWidth + controlsWidth + 24 + 12 + 8;
    
    // 竖排：max(名字, 按钮区) + padding(24) + 安全边距(8)
    const verticalCardWidth = Math.max(maxNameWidth, controlsWidth) + 24 + 8;

    // 计算各状态阈值（从宽到窄）
    // 状态1: 两列横排 → 2个横排卡片 + gap
    const state1MinWidth = horizontalCardWidth * 2 + gap;
    
    // 状态2: 两列竖排 → 2个竖排卡片 + gap
    const state2MinWidth = verticalCardWidth * 2 + gap;
    
    // 状态3: 一列横排 → 1个横排卡片
    const state3MinWidth = horizontalCardWidth;
    
    // 状态4: 一列竖排 → 1个竖排卡片
    const state4MinWidth = verticalCardWidth;

    // 从最占宽度的方式开始试
    let needSingleColumn = false;
    let needVertical = false;

    if (containerWidth >= state1MinWidth) {
        // 状态1: 两列横排
    } else if (containerWidth >= state2MinWidth) {
        // 状态2: 两列竖排
        needVertical = true;
    } else if (containerWidth >= state3MinWidth) {
        // 状态3: 一列横排
        needSingleColumn = true;
    } else {
        // 状态4: 一列竖排
        needSingleColumn = true;
        needVertical = true;
    }

    // 设置容器列数
    if (needSingleColumn) {
        container.classList.add('single-column');
    }

    // 设置卡片布局
    cards.forEach(card => {
        if (needVertical) {
            card.classList.add('vertical-layout');
        }
    });

    // 恢复过渡
    requestAnimationFrame(() => {
        cards.forEach(card => card.style.transition = '');
        container.style.transition = '';
    });
}

// ========== 窗口大小变化时重新计算布局 ==========
let layoutResizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(layoutResizeTimeout);
    layoutResizeTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
            updateEmployeeCardLayout();
            updateRecommendationLayout();
        });
    }, 100);
});

// ========== 动态调整推荐区域布局 ==========
function updateRecommendationLayout() {
    const recSections = document.querySelector('.rec-sections');
    if (!recSections) return;

    const dishItems = recSections.querySelectorAll('.rec-dish-item');
    const employeeItems = recSections.querySelectorAll('.rec-employee-item');
    if (dishItems.length === 0 && employeeItems.length === 0) return;

    // 临时关闭过渡
    recSections.style.transition = 'none';
    dishItems.forEach(item => item.style.transition = 'none');
    employeeItems.forEach(item => item.style.transition = 'none');

    const containerWidth = recSections.getBoundingClientRect().width;
    const gap = 20; // rec-sections gap

    // === 测量菜品区域所需宽度 ===
    let maxDishItemWidthH = 0; // 价格左右排列时最宽的菜品item
    let maxDishItemWidthV = 0; // 价格上下排列时最宽的菜品item
    let maxPriceHWidth = 0;    // 价格左右排列时价格组宽度
    let maxPriceVWidth = 0;    // 价格上下排列时单行价格最大宽度
    let maxInfoWidth = 0;      // 排名+名字最大宽度

    dishItems.forEach(item => {
        const rankEl = item.querySelector('.rec-dish-rank');
        const nameEl = item.querySelector('.rec-dish-name');
        const priceEl = item.querySelector('.rec-dish-price');
        const revenueEl = item.querySelector('.rec-dish-revenue');

        // 排名宽度
        const rankWidth = rankEl ? 22 + 10 : 0; // 22px圆形 + 10px gap

        // 名字文本宽度
        const nameWidth = nameEl ? measureTextWidth(nameEl.textContent.trim(), nameEl) : 0;

        // 信息区宽度
        const infoWidth = rankWidth + nameWidth;
        maxInfoWidth = Math.max(maxInfoWidth, infoWidth);

        // 价格文本宽度
        const priceWidth = priceEl ? measureTextWidth(priceEl.textContent.trim(), priceEl) : 0;
        const revenueWidth = revenueEl ? measureTextWidth(revenueEl.textContent.trim(), revenueEl) : 0;

        // 价格左右排列：两个价格并排
        const priceHWidth = priceWidth + revenueWidth + 8; // 8px gap
        maxPriceHWidth = Math.max(maxPriceHWidth, priceHWidth);

        // 价格上下排列：取较宽的那个
        const priceVWidth = Math.max(priceWidth, revenueWidth);
        maxPriceVWidth = Math.max(maxPriceVWidth, priceVWidth);

        // item padding = 12px * 2 = 24px
        // 信息区和价格组之间的 gap = 10px
        const itemPadding = 24;

        maxDishItemWidthH = Math.max(maxDishItemWidthH, infoWidth + 10 + priceHWidth + itemPadding);
        maxDishItemWidthV = Math.max(maxDishItemWidthV, infoWidth + 10 + priceVWidth + itemPadding);
    });

    // === 测量雇员区域所需宽度 ===
    let maxEmployeeItemWidth = 0;
    employeeItems.forEach(item => {
        const nameEl = item.querySelector('.rec-employee-name');
        const levelEl = item.querySelector('.rec-employee-level');
        const nameWidth = nameEl ? measureTextWidth(nameEl.textContent.trim(), nameEl) : 0;
        const levelWidth = levelEl ? measureTextWidth(levelEl.textContent.trim(), levelEl) : 0;
        // padding 24px + gap 10px
        maxEmployeeItemWidth = Math.max(maxEmployeeItemWidth, nameWidth + levelWidth + 24 + 10);
    });

    // === 计算五种状态的阈值 ===
    // 两列时，取两列中更宽的作为统一列宽，确保不被压扁
    const colWidthH = Math.max(maxDishItemWidthH, maxEmployeeItemWidth);
    const colWidthV = Math.max(maxDishItemWidthV, maxEmployeeItemWidth);

    // 堆叠布局（菜名在上，价格在下横向排列）的最小宽度
    // 取 max(信息区宽, 价格横向宽) + padding
    const stackedItemWidth = Math.max(maxInfoWidth, maxPriceHWidth) + 24; // padding 12*2
    const oneColStacked = stackedItemWidth;

    // 状态1: 两列 + 价格左右
    const twoColPriceH = colWidthH * 2 + gap;

    // 状态2: 两列 + 价格上下
    const twoColPriceV = colWidthV * 2 + gap;

    // 状态3: 单列 + 价格左右
    const oneColPriceH = colWidthH;

    // 状态4: 单列 + 价格上下
    const oneColPriceV = colWidthV;

    // === 设置布局类 ===
    recSections.classList.remove('single-column');
    recSections.classList.remove('price-vertical');
    recSections.classList.remove('dish-stacked');

    if (containerWidth >= twoColPriceH) {
        // 状态1: 两列 + 价格左右
    } else if (containerWidth >= twoColPriceV) {
        // 状态2: 两列 + 价格上下
        recSections.classList.add('price-vertical');
    } else if (containerWidth >= oneColPriceH) {
        // 状态3: 单列 + 价格左右
        recSections.classList.add('single-column');
    } else if (containerWidth >= oneColPriceV) {
        // 状态4: 单列 + 价格上下
        recSections.classList.add('single-column');
        recSections.classList.add('price-vertical');
    } else {
        // 状态5: 单列 + 菜品垂直堆叠（菜名在上，价格在下横着排）
        recSections.classList.add('single-column');
        recSections.classList.add('dish-stacked');
    }

    // 恢复过渡
    requestAnimationFrame(() => {
        recSections.style.transition = '';
        dishItems.forEach(item => item.style.transition = '');
        employeeItems.forEach(item => item.style.transition = '');
    });
}

// ========== 获取等级加成描述（显示累计加成）==========
function getLevelBonusDescription(emp, level) {
    // 计算从Lv.1到该等级的累计加成
    let directTotal = 0;
    let trafficTotal = 0;
    let percentTotal = 0;
    const conditions = [];
    
    for (let lv = 1; lv <= level; lv++) {
        const bonuses = emp.levels[String(lv)] || [];
        bonuses.forEach(b => {
            if (b.type === 'direct') directTotal += b.value;
            if (b.type === 'traffic') trafficTotal += b.value;
            if (b.type === 'conditional') {
                if (b.effectType === 'direct' && b.isPercent) {
                    percentTotal += b.effectValue;
                }
                conditions.push(b);
            }
        });
    }
    
    const parts = [];
    if (directTotal > 0) parts.push(`售价+${directTotal.toFixed(2)}方斯`);
    if (trafficTotal > 0) parts.push(`人流量+${trafficTotal}`);
    if (percentTotal > 0) parts.push(`售价+${(percentTotal * 100).toFixed(1)}%`);
    
    // 添加本等级新增的条件加成说明
    const currentBonuses = emp.levels[String(level)] || [];
    currentBonuses.forEach(b => {
        if (b.type === 'conditional') {
            const condDesc = b.conditionType === 'sameTagCount'
                ? `类别标签×${b.condition.count}`
                : `${b.condition.tag}×${b.condition.count}`;
            const effectDesc = b.effectType === 'direct'
                ? (b.isPercent ? `售价+${(b.effectValue * 100).toFixed(1)}%` : `售价+${b.effectValue}方斯`)
                : (b.isPercent ? `人流量+${(b.effectValue * 100).toFixed(1)}%` : `人流量+${b.effectValue}`);
            parts.push(`[新]条件(${condDesc}→${effectDesc})`);
        }
    });
    
    if (parts.length === 0) {
        return `等级${level}: 无加成`;
    }
    return `等级${level}(累计): ${parts.join(', ')}`;
}

// ========== 统一的菜品价格获取函数 ==========
function getItemPrice(item) {
    if (!item) return 0;
    
    const level = state.itemStates[item.id].level;
    
    if (level === 2) {
        return item.price2 !== null ? item.price2 : (item.price1 !== null ? item.price1 : 0);
    }
    return item.price1 !== null ? item.price1 : (item.price2 !== null ? item.price2 : 0);
}

// ========== 本地存储 ==========
const STORAGE_KEY = 'yihuan_employee_states';
const ITEM_STORAGE_KEY = 'yihuan_item_states';

function saveEmployeeStates() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.employeeStates));
    } catch (error) {
        console.error('保存雇员状态失败:', error);
    }
}

function loadEmployeeStates() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (error) {
        console.error('读取雇员状态失败:', error);
    }
    return null;
}

function saveItemStates() {
    try {
        localStorage.setItem(ITEM_STORAGE_KEY, JSON.stringify(state.itemStates));
    } catch (error) {
        console.error('保存菜品状态失败:', error);
    }
}

function loadItemStates() {
    try {
        const saved = localStorage.getItem(ITEM_STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (error) {
        console.error('读取菜品状态失败:', error);
    }
    return null;
}

// ========== 推荐算法 ==========
function calculateOptimalPlan() {
    const resultContainer = document.getElementById('recommendation-result');
    const calcDetailSection = document.querySelector('.calc-detail-section');

    // 检查是否有选择的雇员
    const ownedEmployees = state.employees.filter(emp => 
        state.employeeStates[emp.id] && state.employeeStates[emp.id].owned
    );
    
    if (ownedEmployees.length === 0) {
        resultContainer.innerHTML = '<div class="recommendation-placeholder"><p>⚠️ 请先勾选拥有的雇员</p></div>';
        if (calcDetailSection) {
            calcDetailSection.classList.add('hidden');
        }
        return;
    }

    // 显示计算中状态
    if (ADVANCED_SETTINGS.cyclePrediction) {
        resultContainer.innerHTML = `
            <div class="recommendation-placeholder">
                <p>🔄 正在计算未来6天最优方案...</p>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" id="calc-progress" style="width: 0%"></div>
                </div>
                <p class="progress-text" id="progress-text">准备中... (0/6)</p>
            </div>
        `;
    } else {
        resultContainer.innerHTML = `
            <div class="recommendation-placeholder">
                <p>🔄 正在计算最优方案...</p>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" id="calc-progress" style="width: 0%"></div>
                </div>
                <p class="progress-text" id="progress-text">计算中...</p>
            </div>
        `;
    }

    // 使用 setTimeout 让UI先更新
    setTimeout(() => {
        if (ADVANCED_SETTINGS.cyclePrediction) {
            calculateCyclePrediction(ownedEmployees);
        } else {
            const bestPlan = findBestPlan(ownedEmployees);
            const progressEl = document.getElementById('calc-progress');
            const progressText = document.getElementById('progress-text');
            if (progressEl) progressEl.style.width = '100%';
            if (progressText) progressText.textContent = '计算完成！';
            renderRecommendation(bestPlan);
            scrollToRecommendation();
        }
    }, 50);
}

// ========== 6天预测计算 ==========
function calculateCyclePrediction(ownedEmployees) {
    const windVanes = getUpcomingWindVanes(6);
    const originalWindVane = state.selectedWindVane;
    const progressEl = document.getElementById('calc-progress');
    const progressText = document.getElementById('progress-text');
    
    let dayIndex = 0;
    const plans = [];
    
    function computeNextDay() {
        if (dayIndex < windVanes.length) {
            // 算完一天，更新进度（不管有没有渲染完）
            state.selectedWindVane = windVanes[dayIndex];
            const plan = findBestPlan(ownedEmployees);
            plans.push({
                windVane: windVanes[dayIndex],
                plan: plan,
                dayOffset: dayIndex,
            });
            
            // 触发进度更新
            const pct = Math.round(((dayIndex + 1) / 6) * 100);
            if (progressEl) progressEl.style.width = `${pct}%`;
            if (progressText) progressText.textContent = `正在计算第${dayIndex + 1}天 (${windVanes[dayIndex].category})... (${dayIndex + 1}/6)`;
            
            dayIndex++;
            // 无延迟继续下一天，浏览器会在空闲时渲染已更新的进度
            setTimeout(computeNextDay, 0);
        } else {
            // 全部算完
            state.selectedWindVane = originalWindVane;
            renderCyclePrediction(plans);
            scrollToRecommendation();
        }
    }

    computeNextDay();
}

// 计算完成后滚动让最优搭配推荐进入视野
function scrollToRecommendation() {
    const target = document.querySelector('.recommendation-section');
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ========== 核心算法：寻找最优方案（优化版）==========
function findBestPlan(ownedEmployees) {
    // 获取拥有雇员的ID和等级
    const availableEmployees = ownedEmployees.map(emp => ({
        id: emp.id,
        level: state.employeeStates[emp.id].level,
        data: emp,
    }));

    let bestPlan = null;
    const maxEmployees = getMaxEmployees();

    if (availableEmployees.length <= maxEmployees) {
        // 雇员数<=上限，直接找最优菜品
        const bestDishes = findBestDishes(availableEmployees);
        const originalPriceTotal = bestDishes.dishes.reduce((sum, item) => sum + getItemPrice(item), 0);
        bestPlan = {
            employees: availableEmployees,
            dishes: bestDishes.dishes,
            totalRevenue: bestDishes.totalRevenue,
            totalHourlyRevenue: bestDishes.totalHourlyRevenue,
            totalHourlyRevenueBeforeDecoration: bestDishes.totalHourlyRevenueBeforeDecoration,
            details: bestDishes.details,
            originalPriceTotal: originalPriceTotal,
        };
    } else {
        // 雇员数>上限，使用组合搜索找到最优的雇员组合
        // 先按贪心评分排序，取前15个进行组合搜索（减少计算量）
        const sortedEmployees = [...availableEmployees].sort((a, b) => {
            const bonusA = getEmployeeBonusScore(a);
            const bonusB = getEmployeeBonusScore(b);
            return bonusB - bonusA;
        });
        
        // 取前15个（如果有）进行组合搜索，平衡性能和效果
        const candidates = sortedEmployees.slice(0, Math.min(availableEmployees.length, 15));
        bestPlan = findBestEmployeeCombination(candidates);
    }

    return bestPlan;
}

// ========== 搜索最优的雇员组合（带等价/降级剪枝优化）==========
function findBestEmployeeCombination(candidates) {
    let bestTotalHourlyRevenue = -Infinity;
    let bestResult = null;
    const EPSILON = 0.01; // 收益差值小于0.01时视为相等

    // 计算组合的原始价格总和
    function calculateOriginalPriceTotal(dishCombo) {
        return dishCombo.reduce((sum, item) => sum + (getItemPrice(item) || 0), 0);
    }

    // === 预计算每个候选雇员的"加成签名" ===
    // 固定加成维度：[directBonusFlat, trafficBonusFlat, trafficBonusPercent]（不含条件触发部分）
    // 条件加成签名：conditionalBonuses 规范化序列化，用于判断两个雇员在不同菜品下的条件触发行为是否一致
    const signatures = candidates.map(emp => {
        const bonuses = getEmployeeAccumulatedBonuses(emp);
        const fixed = [bonuses.directBonusFlat, bonuses.trafficBonusFlat, bonuses.trafficBonusPercent];
        // 条件加成签名：按 conditionType+condition+effectType+effectValue+isPercent 排序后拼接
        const condSig = bonuses.conditionalBonuses
            .map(b => `${b.conditionType}|${JSON.stringify(b.condition)}|${b.effectType}|${b.effectValue}|${b.isPercent ? 1 : 0}`)
            .sort()
            .join('##');
        return { fixed, condSig };
    });

    // === 已计算组合的记录，用于支配剪枝 ===
    // 每个元素：{ fixedSum: [d,t,tp], condSig: string }
    // 安全性论证：
    //  - 菜品候选与 employeeCombo 无关（只依赖 state.items），所以两个组合面对相同菜品候选集
    //  - condSig 相同 → 对任何 dishCombo，条件触发逻辑相同，收益差异只来自 fixedSum
    //  - 若 prev.fixedSum 在所有维度 ≥ 当前，且 condSig 相同 → prev 收益必然 ≥ 当前，可安全跳过
    const computedCombos = [];

    const n = candidates.length;
    const k = getMaxEmployees();

    // 生成组合的索引
    const indices = [];
    for (let i = 0; i < k; i++) indices.push(i);

    while (true) {
        // 计算当前组合的 fixedSum 和 condSig
        const fixedSum = [0, 0, 0];
        const condSigParts = [];
        for (let j = 0; j < k; j++) {
            const sig = signatures[indices[j]];
            for (let d = 0; d < 3; d++) fixedSum[d] += sig.fixed[d];
            condSigParts.push(sig.condSig);
        }
        condSigParts.sort();
        const comboCondSig = condSigParts.join('||');

        // 支配检查：是否存在已计算组合 prev，使得 prev.condSig == 当前 condSig
        // 且 prev.fixedSum 在所有维度 ≥ 当前 fixedSum（至少一个 > 或全相等）
        let dominated = false;
        for (let p = 0; p < computedCombos.length; p++) {
            const prev = computedCombos[p];
            if (prev.condSig !== comboCondSig) continue; // 条件加成不同，不能剪枝
            let allGE = true;   // prev 所有维度 >= 当前
            let someGT = false; // prev 至少一个维度 > 当前（严格更好）
            for (let d = 0; d < 3; d++) {
                if (prev.fixedSum[d] < fixedSum[d]) { allGE = false; break; }
                if (prev.fixedSum[d] > fixedSum[d]) someGT = true;
            }
            if (allGE) {
                // prev 固定加成总和不劣于当前，且条件加成定义相同 → prev 收益必然 ≥ 当前
                // 包括两种情况：
                //   1) someGT=true：prev 严格更好（降级替换，如 c=+1% 换成 d=+0.5%）
                //   2) someGT=false：完全等价（等价替换，如 a=+1 换成 b=+1）
                dominated = true;
                break;
            }
        }

        if (!dominated) {
            // 获取当前组合的雇员并计算收益
            const employeeCombo = indices.map(i => candidates[i]);
            const result = findBestDishes(employeeCombo);

            // 更新最优解（使用 epsilon 避免浮点数精度问题）
            const revenueDiff = result.totalHourlyRevenue - bestTotalHourlyRevenue;
            if (revenueDiff > EPSILON) {
                bestTotalHourlyRevenue = result.totalHourlyRevenue;
                bestResult = {
                    employees: employeeCombo,
                    dishes: result.dishes,
                    totalRevenue: result.totalRevenue,
                    totalHourlyRevenue: result.totalHourlyRevenue,
                    totalHourlyRevenueBeforeDecoration: result.totalHourlyRevenueBeforeDecoration,
                    details: result.details,
                    originalPriceTotal: calculateOriginalPriceTotal(result.dishes),
                };
            } else if (Math.abs(revenueDiff) <= EPSILON && bestResult) {
                const currentOriginalTotal = calculateOriginalPriceTotal(result.dishes);
                if (currentOriginalTotal > bestResult.originalPriceTotal) {
                    bestTotalHourlyRevenue = result.totalHourlyRevenue;
                    bestResult = {
                        employees: employeeCombo,
                        dishes: result.dishes,
                        totalRevenue: result.totalRevenue,
                        totalHourlyRevenue: result.totalHourlyRevenue,
                        totalHourlyRevenueBeforeDecoration: result.totalHourlyRevenueBeforeDecoration,
                        details: result.details,
                        originalPriceTotal: currentOriginalTotal,
                    };
                }
            }

            // 记录已计算组合（只保存剪枝所需的最小信息）
            computedCombos.push({ fixedSum: [...fixedSum], condSig: comboCondSig });
        }

        // 生成下一个组合
        let i = k - 1;
        while (i >= 0 && indices[i] === n - k + i) i--;

        if (i < 0) break;

        indices[i]++;
        for (let j = i + 1; j < k; j++) {
            indices[j] = indices[i] + j - i;
        }
    }

    return bestResult;
}

// ========== 获取雇员从Lv.1到当前等级的累计加成 ==========
function getEmployeeAccumulatedBonuses(emp) {
    const level = emp.level;
    let directBonusFlat = 0;
    let directBonusPercent = 0;
    let trafficBonusFlat = 0;
    let trafficBonusPercent = 0;
    const conditionalBonuses = [];

    // 累加从Lv.1到当前等级的所有加成
    for (let lv = 1; lv <= level; lv++) {
        const bonuses = emp.data.levels[String(lv)] || [];
        bonuses.forEach(b => {
            if (b.type === 'direct') {
                directBonusFlat += b.value;
            } else if (b.type === 'traffic') {
                // 检查是否是百分比加成（虽然当前数据中 traffic 类型都是固定值，但为未来预留）
                if (b.isPercent) {
                    trafficBonusPercent += b.value;
                } else {
                    trafficBonusFlat += b.value;
                }
            } else if (b.type === 'conditional') {
                // 保存条件加成时，同时记录该加成对应的等级
                conditionalBonuses.push({ ...b, level: lv });
            }
        });
    }

    return {
        directBonusFlat,
        directBonusPercent,
        trafficBonusFlat,
        trafficBonusPercent,
        conditionalBonuses,
    };
}

// ========== 计算雇员加成评分（用于排序）==========
function getEmployeeBonusScore(emp) {
    const bonuses = getEmployeeAccumulatedBonuses(emp);
    let score = 0;
    
    // 固定值直接加成：1方斯≈ 24人·小时收益（2400基础人流量/100）
    score += bonuses.directBonusFlat * 2400;
    
    // 固定值人流量加成：1人流量≈ 对应收益
    score += bonuses.trafficBonusFlat * 10; // 粗略估计，每个菜品平均10方斯
    
    // 百分比人流量加成：1%≈ 24人流量，按固定值同等方式计算
    score += bonuses.trafficBonusPercent * 2400;
    
    // 条件加成按预估效果计算
    bonuses.conditionalBonuses.forEach(b => {
        let value = (b.effectValue || 0);
        if (b.effectType === 'direct') {
            if (b.isPercent) {
                // 百分比直接加成，假设每个菜品平均15方斯，2400人流量
                value *= 15 * 2400;
            } else {
                // 固定值直接加成
                value *= 2400;
            }
        } else if (b.effectType === 'traffic') {
            if (b.isPercent) {
                // 百分比人流量加成
                value *= 2400;
            } else {
                // 固定值人流量加成
                value *= 10;
            }
        }
        score += value * 0.5; // 条件加成不一定触发，乘以0.5权重
    });
    
    return score;
}

function selectCandidateDishes(availableItems) {
    const countPerCategory = 3;
    const selected = new Set();
    
    ['主食', '甜品', '饮料'].forEach(cat => {
        const categoryItems = availableItems.filter(item => item.category === cat);
        const sorted = [...categoryItems].sort((a, b) => {
            const priceA = getItemPrice(a);
            const priceB = getItemPrice(b);
            return priceB - priceA;
        });
        sorted.slice(0, countPerCategory).forEach(item => {
            selected.add(item.id);
        });
    });
    
    return availableItems.filter(item => selected.has(item.id));
}

function findBestDishes(employeeCombo) {
    const maxDishes = getMaxDishes();
    
    const availableItems = [];
    for (let i = 0; i < state.items.length; i++) {
        const item = state.items[i];
        const itemState = state.itemStates[item.id];
        if (itemState && itemState.level > 0) {
            availableItems.push(item);
        }
    }
    
    const candidateItems = selectCandidateDishes(availableItems);
    
    if (availableItems.length === 0) {
        return {
            dishes: [],
            totalRevenue: 0,
            totalHourlyRevenue: 0,
            totalHourlyRevenueBeforeDecoration: 0,
            details: {
                directBonusFlat: 0,
                directBonusPercent: 0,
                trafficBonusFlat: 0,
                trafficBonusPercent: 0,
                exclusiveServiceMultiplier: 0,
                trafficA: 0,
                totalTraffic: 0,
                decorationMultiplier: 1,
                triggeredConditions: [],
                dishDetails: []
            },
        };
    }
    
    const actualDishCount = Math.min(candidateItems.length, maxDishes);
    
    let bestCombo = null;
    let bestTotalHourlyRevenue = -Infinity;
    
    const combinations = [];
    const n = candidateItems.length;
    const k = actualDishCount;
    
    // 生成组合
    const indices = [];
    for (let i = 0; i < k; i++) indices.push(i);
    
    while (true) {
        combinations.push([...indices]);
        
        let i = k - 1;
        while (i >= 0 && indices[i] === n - k + i) i--;
        
        if (i < 0) break;
        
        indices[i]++;
        for (let j = i + 1; j < k; j++) {
            indices[j] = indices[i] + j - i;
        }
    }
    
    const EPSILON = 0.01;
    for (let c = 0; c < combinations.length; c++) {
        const comboIndices = combinations[c];
        const dishCombo = [];
        for (let i = 0; i < comboIndices.length; i++) {
            dishCombo.push(candidateItems[comboIndices[i]]);
        }
        
        // 计算收益
        const result = calculateComboRevenue(employeeCombo, dishCombo);
        if (!result) continue;
        
        // 更新最优解
        const revenueDiff = result.totalHourlyRevenue - bestTotalHourlyRevenue;
        if (revenueDiff > EPSILON) {
            // 收益明显更高
            bestTotalHourlyRevenue = result.totalHourlyRevenue;
            bestCombo = { dishes: dishCombo, ...result };
        } else if (Math.abs(revenueDiff) <= EPSILON && bestCombo) {
            // 收益相近（视为相等），选原价高的
            const currentTotal = dishCombo.reduce((sum, item) => sum + getItemPrice(item), 0);
            const bestTotal = bestCombo.dishes.reduce((sum, item) => sum + getItemPrice(item), 0);
            if (currentTotal > bestTotal) {
                bestTotalHourlyRevenue = result.totalHourlyRevenue;
                bestCombo = { dishes: dishCombo, ...result };
            }
        }
    }
    
    if (!bestCombo && candidateItems.length > 0) {
        const fallbackCombo = candidateItems.slice(0, actualDishCount);
        const fallbackResult = calculateComboRevenue(employeeCombo, fallbackCombo);
        if (fallbackResult) {
            bestCombo = { dishes: fallbackCombo, ...fallbackResult };
        }
    }
    
    // 返回结果
    if (bestCombo) {
        return {
            dishes: bestCombo.dishes,
            totalRevenue: bestCombo.totalRevenue,
            totalHourlyRevenue: bestCombo.totalHourlyRevenue,
            totalHourlyRevenueBeforeDecoration: bestCombo.totalHourlyRevenueBeforeDecoration,
            details: bestCombo.details,
        };
    } else {
        return {
            dishes: [],
            totalRevenue: 0,
            totalHourlyRevenue: 0,
            totalHourlyRevenueBeforeDecoration: 0,
            details: {
                directBonusFlat: 0,
                directBonusPercent: 0,
                trafficBonusFlat: 0,
                trafficBonusPercent: 0,
                exclusiveServiceMultiplier: 0,
                trafficA: 0,
                totalTraffic: 0,
                decorationMultiplier: 1,
                triggeredConditions: [],
                dishDetails: []
            },
        };
    }
}

// 计算特定组合的收益
function calculateComboRevenue(employeeCombo, dishCombo) {
    // 统计标签
    const tagCounts = {};
    dishCombo.forEach(item => {
        if (item.tags) {
            item.tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }
    });

    // 计算雇员加成（等级技能叠加，考虑条件触发）
    let directBonusFlat = 0;
    let directBonusPercent = 0;
    let trafficBonusFlat = 0;
    let trafficBonusPercent = 0;
    const triggeredConditions = [];

    employeeCombo.forEach(emp => {
        const accBonuses = getEmployeeAccumulatedBonuses(emp);
        directBonusFlat += accBonuses.directBonusFlat;
        trafficBonusFlat += accBonuses.trafficBonusFlat;
        trafficBonusPercent += accBonuses.trafficBonusPercent;
        
        accBonuses.conditionalBonuses.forEach(b => {
            const result = checkConditionWithTags(b, tagCounts);
            if (result.met) {
                if (b.effectType === 'direct') {
                    if (b.isPercent) {
                        directBonusPercent += b.effectValue;
                    } else {
                        directBonusFlat += b.effectValue;
                    }
                } else if (b.effectType === 'traffic') {
                    if (b.isPercent) {
                        trafficBonusPercent += b.effectValue;
                    } else {
                        trafficBonusFlat += b.effectValue;
                    }
                }
                const condDesc = getConditionDescription(b, result.matchedTag);
                triggeredConditions.push({
                    employee: emp.data.name,
                    level: b.level,
                    description: condDesc,
                    tooltip: b.conditionType === 'sameTagCount' ? `实际触发: ${result.matchedTag}×${b.condition.count}` : null,
                });
            }
        });
    });

    // 方案A：先加固定值，再乘百分比
    const exclusiveServiceMultiplier = ADVANCED_SETTINGS.exclusiveServiceEnabled ? 0.01 : 0;
    const trafficA = (ADVANCED_SETTINGS.baseTraffic + trafficBonusFlat) * (1 + trafficBonusPercent + exclusiveServiceMultiplier);
    const totalTraffic = trafficA;

    // 计算每道菜收益
    let totalRevenue = 0;
    const dishDetails = [];

    dishCombo.forEach(item => {
        // 使用统一的价格获取函数
        let basePrice = getItemPrice(item);
        
        let windVaneBonus = 0;
        let windVaneMatch = false;
        
        // 风向标加成
        if (state.selectedWindVane) {
            windVaneMatch = isWindVaneApplicable(item, state.selectedWindVane);
            if (windVaneMatch) {
                windVaneBonus = state.selectedWindVane.bonus;
            }
        }
        
        const directPercentMultiplier = 1 + directBonusPercent;

        const isCoffeeBeanWindVane = state.selectedWindVane &&
            state.selectedWindVane.category === '咖啡豆';

        let priceAfterFlat;
        let priceAfterPercent;
        let unitPrice;

        if (isCoffeeBeanWindVane && windVaneMatch) {
            // 咖啡豆特殊规则：(基础 + 雇员直接加成) * (1 + 百分比加成) + 风向标加成
            priceAfterFlat = basePrice + directBonusFlat;
            priceAfterPercent = priceAfterFlat * directPercentMultiplier;
            unitPrice = priceAfterPercent + windVaneBonus;
        } else {
            // 原始逻辑：(基础 + 风向标 + 雇员直接加成) * (1 + 百分比加成)
            priceAfterFlat = basePrice + windVaneBonus + directBonusFlat;
            priceAfterPercent = priceAfterFlat * directPercentMultiplier;
            unitPrice = priceAfterPercent;
        }

        const hourlyRevenue = unitPrice * (totalTraffic / 100);

        totalRevenue += unitPrice;
        dishDetails.push({
            item,
            revenue: unitPrice,
            hourlyRevenue,
            basePrice,
            windVaneBonus,
            windVaneMatch,
            directBonusFlat,
            directBonusPercent,
            directPercentMultiplier,
            trafficBonusFlat,
            trafficBonusPercent,
            trafficA,
            totalTraffic,
            priceAfterFlat,
            priceAfterPercent,
            unitPrice,
        });
    });

    const totalHourlyRevenueBeforeDecoration = dishDetails.reduce((sum, d) => sum + d.hourlyRevenue, 0);
    // 装修加成：游戏里是加两遍的（一遍在累计营收里，一遍在提取收益时）
    const decorationMultiplier = 1 + ADVANCED_SETTINGS.decorationBonus;
    const totalHourlyRevenue = totalHourlyRevenueBeforeDecoration * decorationMultiplier * decorationMultiplier;

    return {
        totalRevenue,
        totalHourlyRevenue,
        totalHourlyRevenueBeforeDecoration,
        details: {
            directBonusFlat,
            directBonusPercent,
            trafficBonusFlat,
            trafficBonusPercent,
            exclusiveServiceMultiplier,
            trafficA,
            totalTraffic,
            decorationMultiplier,
            triggeredConditions,
            dishDetails,
        },
    };
}



// ========== 条件检查（基于标签统计）==========
function checkConditionWithTags(bonus, tagCounts) {
    if (bonus.conditionType === 'tagCount') {
        const count = tagCounts[bonus.condition.tag] || 0;
        return { met: count >= bonus.condition.count, matchedTag: bonus.condition.tag };
    } else if (bonus.conditionType === 'sameTagCount') {
        const categoryTags = ['主食', '饮料', '甜品'];
        let maxCount = 0;
        let matchedTag = '';
        for (const tag of categoryTags) {
            const count = tagCounts[tag] || 0;
            if (count > maxCount) {
                maxCount = count;
                matchedTag = tag;
            }
        }
        return { met: maxCount >= bonus.condition.count, matchedTag };
    }
    return { met: false, matchedTag: '' };
}

// ========== 获取条件描述 ==========
function getConditionDescription(bonus, matchedTag = '') {
    let condDesc = '';
    if (bonus.conditionType === 'sameTagCount') {
        const tooltipText = matchedTag ? `当前触发: ${matchedTag}×${bonus.condition.count}` : '';
        condDesc = `<span class="tooltip-tag" ${tooltipText ? `data-tooltip="${tooltipText}"` : ''}>任意标签×${bonus.condition.count}</span>`;
    } else {
        condDesc = `${bonus.condition.tag}标签×${bonus.condition.count}`;
    }
    const effectDesc = bonus.effectType === 'direct'
        ? (bonus.isPercent ? `售价+${(bonus.effectValue * 100).toFixed(1)}%` : `售价+${bonus.effectValue}方斯`)
        : (bonus.isPercent ? `人流量+${(bonus.effectValue * 100).toFixed(1)}%` : `人流量+${bonus.effectValue}`);
    return `${condDesc}→${effectDesc}`;
}

// ========== 渲染推荐结果 ==========
// ========== 构建计算明细HTML（供单日和6天预测复用）==========
function buildDetailHtml(plan) {
    return `
        <p class="rec-calc-formula">单价 = (基础价格 + 风向标加成 + 雇员直接加成) × (1 + 百分比加成)</p>
        <p class="rec-calc-formula">显示每小时收益 = 单价 × (人流量/100)</p>
        <p class="rec-calc-formula">实际每小时收益 = 显示每小时收益 × (1 + 装修加成)²</p>
        <p class="rec-calc-note">装修加成在游戏中被计算两次：一次直接反映在累计营收中，另一次在提取收益时。</p>
        <div class="rec-calc-summary">
            <div class="rec-calc-summary-item">
                <span class="summary-label">基础人流量</span>
                <span class="summary-value">${ADVANCED_SETTINGS.baseTraffic}</span>
            </div>
            <div class="rec-calc-summary-item">
                <span class="summary-label">固定人流量加成</span>
                <span class="summary-value">+${plan.details.trafficBonusFlat.toFixed(1)}</span>
            </div>
            <div class="rec-calc-summary-item">
                <span class="summary-label">百分比人流量加成</span>
                <span class="summary-value">+${(plan.details.trafficBonusPercent * 100).toFixed(1)}%</span>
            </div>
            ${plan.details.exclusiveServiceMultiplier > 0 ? `
            <div class="rec-calc-summary-item">
                <span class="summary-label">专属客服</span>
                <span class="summary-value">+${(plan.details.exclusiveServiceMultiplier * 100).toFixed(1)}%</span>
            </div>
            ` : ''}
            <div class="rec-calc-summary-item highlight">
                <span class="summary-label">总人流量</span>
                <span class="summary-value">${plan.details.totalTraffic.toFixed(1)}</span>
            </div>
        </div>
        <div class="rec-calc-list">
            ${plan.details.dishDetails.map((d, idx) => `
                <div class="rec-calc-item">
                    <div class="rec-calc-item-header">
                        <span class="rec-calc-item-rank">${idx + 1}</span>
                        <span class="rec-calc-item-name">${d.item.name}</span>
                        <span class="rec-calc-item-result">${d.revenue.toFixed(2)} 方斯</span>
                    </div>
                    <div class="rec-calc-item-steps">
                        <div class="calc-step">
                            <span class="calc-step-label">基础价格</span>
                            <span class="calc-step-value">${d.basePrice.toFixed(2)}</span>
                        </div>
                        <div class="calc-step ${d.windVaneMatch ? 'active' : 'inactive'}">
                            <span class="calc-step-label">风向标加成</span>
                            <span class="calc-step-value">${d.windVaneMatch ? '+' + d.windVaneBonus.toFixed(2) : '+0'}</span>
                        </div>
                        <div class="calc-step">
                            <span class="calc-step-label">雇员直接加成</span>
                            <span class="calc-step-value">+${d.directBonusFlat.toFixed(2)}</span>
                        </div>
                        <div class="calc-step-divider">
                            <span class="calc-step-label">小计</span>
                            <span class="calc-step-value">${d.priceAfterFlat.toFixed(2)}</span>
                        </div>
                        ${d.directBonusPercent > 0 ? `
                        <div class="calc-step">
                            <span class="calc-step-label">百分比加成</span>
                            <span class="calc-step-value">×${d.directPercentMultiplier.toFixed(4)}</span>
                        </div>
                        <div class="calc-step-divider">
                            <span class="calc-step-label">小计</span>
                            <span class="calc-step-value">${d.priceAfterPercent.toFixed(2)}</span>
                        </div>
                        ` : ''}
                        <div class="calc-step-final">
                            <span class="calc-step-label">单价</span>
                            <span class="calc-step-value">${d.revenue.toFixed(2)} 方斯</span>
                        </div>
                        <div class="calc-step calc-step-hourly">
                            <span class="calc-step-label">每小时收益</span>
                            <span class="calc-step-value">${d.hourlyRevenue.toFixed(2)} 方斯/小时</span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="rec-calc-total">
            <div class="rec-calc-total-item">
                <span class="total-label">总单价</span>
                <span class="total-value">${plan.totalRevenue.toFixed(2)} 方斯</span>
            </div>
            <div class="rec-calc-total-item">
                <span class="total-label">显示每小时收益</span>
                <span class="total-value">${plan.totalHourlyRevenueBeforeDecoration.toFixed(2)} 方斯/小时</span>
            </div>
            <div class="rec-calc-total-item">
                <span class="total-label">装修加成</span>
                <span class="total-value">+${((plan.details.decorationMultiplier - 1) * 100).toFixed(1)}% × 2</span>
            </div>
            <div class="rec-calc-total-item highlight">
                <span class="total-label">实际每小时收益</span>
                <span class="total-value">${plan.totalHourlyRevenue.toFixed(2)} 方斯/小时</span>
            </div>
        </div>
    `;
}

function renderRecommendation(plan) {
    const container = document.getElementById('recommendation-result');
    const calcDetailSection = document.querySelector('.calc-detail-section');
    const calcDetailContainer = document.getElementById('calc-detail-result');

    // 如果 plan 无效或者没有有效内容时，也可以显示
    if (!plan) {
        container.innerHTML = '<div class="recommendation-placeholder"><p>未能计算出有效方案</p></div>';
        if (calcDetailSection) {
            calcDetailSection.classList.add('hidden');
        }
        return;
    }

    // 检查是否有有效数据
    if (!plan.dishes || plan.dishes.length === 0) {
        container.innerHTML = '<div class="recommendation-placeholder"><p>没有可用的菜品进行计算</p></div>';
        if (calcDetailSection) {
            calcDetailSection.classList.add('hidden');
        }
        return;
    }

    // 显示计算明细区域
    if (calcDetailSection) {
        calcDetailSection.classList.remove('hidden');
        // 恢复原始标题和描述（6天预测模式下点击收益按钮会修改它们）
        const titleEl = calcDetailSection.querySelector('.card-title');
        const descEl = calcDetailSection.querySelector('.card-desc');
        if (titleEl) {
            titleEl.innerHTML = '<span class="section-icon">📊</span> 计算明细';
        }
        if (descEl) {
            descEl.textContent = '详细的收益计算过程 · 计算过程不四舍五入，下方明细仅做显示';
        }
    }

    // 雇员列表
    const employeesHtml = plan.employees.map(emp => `
        <div class="rec-employee-item">
            <div class="rec-employee-info">
                <span class="rec-employee-name">${emp.data.name}</span>
                <span class="rec-employee-level">Lv.${emp.level}</span>
            </div>
        </div>
    `).join('');

    // 菜品列表
    const dishesHtml = plan.details.dishDetails.map((d, idx) => `
        <div class="rec-dish-item">
            <div class="rec-dish-info">
                <span class="rec-dish-rank">${idx + 1}</span>
                <span class="rec-dish-name">${d.item.name}</span>
            </div>
            <div class="rec-dish-price-group">
                <span class="rec-dish-price">${d.basePrice} 方斯</span>
                <span class="rec-dish-revenue">${d.revenue.toFixed(2)} 方斯</span>
            </div>
        </div>
    `).join('');

    // 雇员加成总结
    const conditionsHtml = `<div class="rec-conditions">
            <h4>🎯 雇员加成总结</h4>
            <div class="rec-bonuses">
                <span class="rec-bonus-item">售价加成: +${plan.details.directBonusFlat.toFixed(2)} +${(plan.details.directBonusPercent * 100).toFixed(1)}%</span>
                <span class="rec-bonus-item">人流量加成: +${plan.details.trafficBonusFlat.toFixed(0)} +${(plan.details.trafficBonusPercent * 100).toFixed(1)}%</span>
            </div>
            ${plan.details.triggeredConditions.length > 0 ? `
                <h5 style="margin: 12px 0 8px 0;">触发的条件加成</h5>
                ${plan.details.triggeredConditions.map(c => `
                    <div class="rec-condition-item triggered">✓ ${c.employee} (Lv.${c.level}): ${c.description}</div>
                `).join('')}
            ` : ''}
        </div>`;

    // 详细计算明细（通过独立函数构建）
    const detailHtml = buildDetailHtml(plan);

    container.innerHTML = `
        <div class="recommendation-content">
            <div class="rec-summary">
                <div class="rec-total-wrapper">
                    <div class="rec-total rec-total-no-bonus">
                        <span class="rec-total-label">显示总收益</span>
                        <span class="rec-total-value">
                            <span class="rec-total-number">${plan.totalHourlyRevenueBeforeDecoration.toFixed(2)}</span>
                            <span class="rec-total-unit">方斯/小时</span>
                        </span>
                    </div>
                    <div class="rec-total rec-total-with-bonus">
                        <span class="rec-total-label">实际总收益</span>
                        <span class="rec-total-value">
                            <span class="rec-total-number">${plan.totalHourlyRevenue.toFixed(2)}</span>
                            <span class="rec-total-unit">方斯/小时</span>
                        </span>
                    </div>
                </div>
            </div>

            <div class="rec-sections">
                <div class="rec-section">
                    <h4>👥 推荐雇员 (${plan.employees.length}人)</h4>
                    <div class="rec-employee-list">${employeesHtml}</div>
                </div>

                <div class="rec-section">
                    <h4>🍽️ 推荐菜品 (${plan.dishes.length}道)</h4>
                    <div class="rec-dish-list">${dishesHtml}</div>
                </div>
            </div>

            ${conditionsHtml}
        </div>
    `;

    // 将计算明细渲染到独立的card中
    const detailContainer = document.getElementById('calc-detail-result');
    detailContainer.innerHTML = detailHtml;

    // 绑定 tooltip 点击事件（移动端）
    document.querySelectorAll('[data-tooltip]').forEach(el => {
        el.addEventListener('click', (e) => {
            if (window.matchMedia('(hover: none)').matches) {
                e.stopPropagation();
                document.querySelectorAll('[data-tooltip]').forEach(other => {
                    if (other !== el) other.classList.remove('show-tooltip');
                });
                el.classList.toggle('show-tooltip');
            }
        });
    });

    // 点击其他地方关闭 tooltip
    document.addEventListener('click', () => {
        document.querySelectorAll('[data-tooltip]').forEach(el => {
            el.classList.remove('show-tooltip');
        });
    });

    // 渲染完成后更新布局
    requestAnimationFrame(updateRecommendationLayout);
}

// ========== 渲染6天预测结果 ==========
function renderCyclePrediction(plans) {
    const container = document.getElementById('recommendation-result');
    const calcDetailSection = document.querySelector('.calc-detail-section');
    
    if (!plans || plans.length === 0) {
        container.innerHTML = '<div class="recommendation-placeholder"><p>未能计算出有效方案</p></div>';
        if (calcDetailSection) calcDetailSection.classList.add('hidden');
        return;
    }
    
    // 隐藏计算明细（6天预测模式不显示单天明细）
    if (calcDetailSection) calcDetailSection.classList.add('hidden');
    
    // 判断搭配是否全相同（雇员ID集合 + 菜品ID集合）
    const getComboKey = (plan) => {
        if (!plan || !plan.employees || !plan.dishes) return '';
        const empIds = plan.employees.map(e => e.id).sort().join(',');
        const dishIds = plan.dishes.map(d => d.id).sort().join(',');
        return empIds + '|' + dishIds;
    };
    
    const firstKey = getComboKey(plans[0].plan);
    const allSame = plans.every(p => getComboKey(p.plan) === firstKey);
    
    // 生成日期标签
    // 风向标中午12点更新：未到12点时，当前风向标是昨天12点切换的，标签整体前移一天以避免歧义
    const getDayLabel = (offset) => {
        if (offset === 0) return '当前';
        const now = new Date();
        const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
        const adjustedOffset = now < todayNoon ? offset - 1 : offset;
        if (adjustedOffset === 0) return '今天';
        if (adjustedOffset === 1) return '明天';
        const d = new Date();
        d.setDate(d.getDate() + adjustedOffset);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    };
    
    // 生成单天卡片HTML，diffPrev 为与前一天对比的差异（新增/移除的雇员和菜品）
    const renderDayCard = (item, idx, diffPrev) => {
        const plan = item.plan;
        const displayRevenue = (plan.totalHourlyRevenueBeforeDecoration ?? 0).toFixed(2);
        const actualRevenue = plan.totalHourlyRevenue.toFixed(2);
        const isToday = idx === 0;
        const needChange = !!diffPrev;
        
        // 雇员：标记新增的（前一天没有的）
        const empHtml = plan.employees.map(e => {
            const isNew = diffPrev && diffPrev.addedEmpIds.has(e.id);
            return `<span class="cycle-tag ${isNew ? 'cycle-tag-added' : ''}">${e.data.name}</span>`;
        }).join('');
        
        // 菜品：标记新增的（前一天没有的）
        const dishHtml = plan.dishes.map(d => {
            const isNew = diffPrev && diffPrev.addedDishIds.has(d.id);
            return `<span class="cycle-tag ${isNew ? 'cycle-tag-added' : ''}">${d.name}</span>`;
        }).join('');
        
        // 被替换掉的雇员/菜品（前一天有，今天没有的）
        let removedHtml = '';
        if (diffPrev && (diffPrev.removedEmps.length > 0 || diffPrev.removedDishes.length > 0)) {
            const removedEmpHtml = diffPrev.removedEmps.length > 0
                ? diffPrev.removedEmps.map(name => `<span class="cycle-tag cycle-tag-removed">${name}</span>`).join('')
                : '';
            const removedDishHtml = diffPrev.removedDishes.length > 0
                ? diffPrev.removedDishes.map(name => `<span class="cycle-tag cycle-tag-removed">${name}</span>`).join('')
                : '';
            const parts = [];
            if (removedEmpHtml) parts.push(`👥 ${removedEmpHtml}`);
            if (removedDishHtml) parts.push(`🍽️ ${removedDishHtml}`);
            removedHtml = `<div class="cycle-day-removed">🔄 移除: ${parts.join(' ')}</div>`;
        }
        
        return `
            <div class="cycle-day-card ${needChange ? 'cycle-day-change' : ''} ${isToday ? 'cycle-day-today' : ''}">
                <div class="cycle-day-header">
                    <span class="cycle-day-label">${getDayLabel(item.dayOffset)}</span>
                    <span class="cycle-day-windvane">${item.windVane.category} +${item.windVane.bonus}</span>
                </div>
                <div class="cycle-day-body">
                    <div class="cycle-day-employees">👥 ${empHtml || '<span class="cycle-tag-empty">无</span>'}</div>
                    <div class="cycle-day-dishes">🍽️ ${dishHtml || '<span class="cycle-tag-empty">无</span>'}</div>
                    ${removedHtml}
                </div>
                <button class="cycle-detail-btn" data-day-idx="${idx}">
                    <span class="cycle-detail-btn-row">
                        <span class="cycle-detail-btn-label">
                            <span class="label-short">显示</span>
                            <span class="label-full">显示总收益</span>
                        </span>
                        <span class="cycle-detail-btn-value cycle-display-rev">${displayRevenue}<span class="cycle-rev-unit">方斯/小时</span></span>
                    </span>
                    <span class="cycle-detail-btn-row">
                        <span class="cycle-detail-btn-label">
                            <span class="label-short">实际</span>
                            <span class="label-full">实际总收益</span>
                        </span>
                        <span class="cycle-detail-btn-value cycle-actual-rev">${actualRevenue}<span class="cycle-rev-unit">方斯/小时</span></span>
                    </span>
                </button>
            </div>
        `;
    };
    
    // 计算与前一天的差异（新增了哪些雇员/菜品，移除了哪些）
    const computeDiff = (prevPlan, curPlan) => {
        if (!prevPlan || !curPlan) return null;
        const prevEmpIds = new Set(prevPlan.employees.map(e => e.id));
        const prevDishIds = new Set(prevPlan.dishes.map(d => d.id));
        const curEmpIds = new Set(curPlan.employees.map(e => e.id));
        const curDishIds = new Set(curPlan.dishes.map(d => d.id));
        
        const addedEmpIds = new Set(curPlan.employees.filter(e => !prevEmpIds.has(e.id)).map(e => e.id));
        const addedDishIds = new Set(curPlan.dishes.filter(d => !prevDishIds.has(d.id)).map(d => d.id));
        // 被移除的雇员/菜品（保留名字用于展示）
        const removedEmps = prevPlan.employees.filter(e => !curEmpIds.has(e.id)).map(e => e.data.name);
        const removedDishes = prevPlan.dishes.filter(d => !curDishIds.has(d.id)).map(d => d.name);
        
        // 如果没有任何差异，返回null
        if (addedEmpIds.size === 0 && addedDishIds.size === 0 && removedEmps.length === 0 && removedDishes.length === 0) return null;
        return { addedEmpIds, addedDishIds, removedEmps, removedDishes };
    };
    
    let summaryHtml = '';
    let daysHtml = '';
    
    if (allSame) {
        // 全部相同，无需更换
        summaryHtml = `<div class="cycle-summary cycle-summary-same">✅ 6天最优搭配相同，无需更换</div>`;
        daysHtml = plans.map((item, idx) => renderDayCard(item, idx, null)).join('');
    } else {
        // 有差异，高亮被更换的雇员/菜品
        let prevPlan = plans[0].plan;
        let changeCount = 0;
        daysHtml = plans.map((item, idx) => {
            let diff = null;
            if (idx > 0) {
                diff = computeDiff(prevPlan, item.plan);
                if (diff) changeCount++;
            }
            prevPlan = item.plan;
            return renderDayCard(item, idx, diff);
        }).join('');
        summaryHtml = `<div class="cycle-summary cycle-summary-change">⚠️ 6天内需更换 ${changeCount} 次搭配（高亮项为改动）</div>`;
    }
    
    container.innerHTML = `
        <div class="cycle-prediction-content">
            ${summaryHtml}
            <div class="cycle-prediction-hint">💡 点击每天右侧的收益按钮可查看该天计算明细</div>
            <div class="cycle-days-list">${daysHtml}</div>
        </div>
    `;
    
    // 绑定"查看明细"按钮事件
    container.querySelectorAll('.cycle-detail-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.dayIdx);
            const plan = plans[idx];
            if (!plan || !plan.plan) return;
            
            const calcDetailSection = document.querySelector('.calc-detail-section');
            const detailContainer = document.getElementById('calc-detail-result');
            if (calcDetailSection && detailContainer) {
                // 更新明细标题
                const titleEl = calcDetailSection.querySelector('.card-title');
                const descEl = calcDetailSection.querySelector('.card-desc');
                if (titleEl) {
                    titleEl.innerHTML = '<span class="section-icon">📊</span> 计算明细 · ' + getDayLabel(plan.dayOffset) + ' ' + plan.windVane.category;
                }
                if (descEl) {
                    descEl.textContent = `${getDayLabel(plan.dayOffset)} ${plan.windVane.category} +${plan.windVane.bonus} 方斯 · 实际每小时收益 ${plan.plan.totalHourlyRevenue.toFixed(2)} 方斯`;
                }
                detailContainer.innerHTML = buildDetailHtml(plan.plan);
                calcDetailSection.classList.remove('hidden');
                // 滚动到明细区域
                calcDetailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
    
    requestAnimationFrame(() => {
        updateRecommendationLayout();
        checkCycleDayLayout();
        initCycleDayResizeObserver();
    });
}

// 动态检测6天预测卡片布局：雇员或菜品换行超过2行时切换为上中下纵向排列
let cycleDayResizeObserver = null;

// 统计容器内标签占用的行数（通过子元素 offsetTop 去重）
function countTagRows(container) {
    if (!container) return 0;
    const tags = container.querySelectorAll('.cycle-tag, .cycle-tag-empty');
    if (tags.length === 0) return 0;
    const tops = new Set();
    tags.forEach(tag => {
        // 取整以消除亚像素差异
        tops.add(Math.round(tag.offsetTop));
    });
    return tops.size;
}

function checkCycleDayLayout() {
    const cards = document.querySelectorAll('.cycle-day-card');
    if (cards.length === 0) return;

    // 测量期间禁用过渡
    const section = cards[0].closest('.card');
    if (section) section.style.transition = 'none';

    // 先全部恢复横向布局以测量真实换行情况
    cards.forEach(card => {
        card.style.transition = 'none';
        card.classList.remove('vertical');
    });

    // 强制重排
    cards[0].getBoundingClientRect();

    cards.forEach(card => {
        const empContainer = card.querySelector('.cycle-day-employees');
        const dishContainer = card.querySelector('.cycle-day-dishes');
        const empRows = countTagRows(empContainer);
        const dishRows = countTagRows(dishContainer);
        // 雇员或菜品任意一方超过2行即切换为纵向
        if (empRows > 2 || dishRows > 2) {
            card.classList.add('vertical');
        }
    });

    cards.forEach(card => card.style.transition = '');
    if (section) {
        requestAnimationFrame(() => { section.style.transition = ''; });
    }

    // 根据布局方向同步更新提示文本
    const hint = document.querySelector('.cycle-prediction-hint');
    if (hint) {
        const hasVertical = Array.from(cards).some(c => c.classList.contains('vertical'));
        hint.textContent = hasVertical
            ? '💡 点击每天下方的收益按钮可查看该天计算明细'
            : '💡 点击每天右侧的收益按钮可查看该天计算明细';
    }
}

function initCycleDayResizeObserver() {
    const container = document.querySelector('.cycle-days-list');
    if (!container || cycleDayResizeObserver) return;

    cycleDayResizeObserver = new ResizeObserver(() => {
        checkCycleDayLayout();
    });
    cycleDayResizeObserver.observe(container);
}

// ========== 事件绑定 ==========
// 窗口 resize 期间禁用过渡，避免 clamp 等响应式值每像素变化时触发动画抽搐
let resizeTransitionTimer = null;
window.addEventListener('resize', () => {
    document.body.classList.add('resizing');
    if (resizeTransitionTimer) clearTimeout(resizeTransitionTimer);
    resizeTransitionTimer = setTimeout(() => {
        document.body.classList.remove('resizing');
    }, 150);
});

document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // 计算按钮
    document.getElementById('calculate-btn').addEventListener('click', calculateOptimalPlan);

    // 公告按钮
    document.getElementById('announcement-btn').addEventListener('click', openAnnouncementModal);
    const announcementBtnFloat = document.getElementById('announcement-btn-float');
    if (announcementBtnFloat) {
        announcementBtnFloat.addEventListener('click', openAnnouncementModal);
    }

    // 关闭公告模态框按钮
    document.getElementById('close-announcement-btn').addEventListener('click', closeAnnouncementModal);

    // 点击公告模态框背景关闭
    document.getElementById('announcement-modal').addEventListener('click', (e) => {
        if (e.target.id === 'announcement-modal') {
            closeAnnouncementModal();
        }
    });

    // 高级设置按钮
    document.getElementById('advanced-settings-btn').addEventListener('click', openAdvancedSettingsModal);
    const advancedSettingsBtnFloat = document.getElementById('advanced-settings-btn-float');
    if (advancedSettingsBtnFloat) {
        advancedSettingsBtnFloat.addEventListener('click', openAdvancedSettingsModal);
    }

    // 关闭高级设置模态框按钮
    document.getElementById('close-modal-btn').addEventListener('click', closeAdvancedSettingsModal);

    // 点击高级设置模态框背景关闭
    document.getElementById('advanced-settings-modal').addEventListener('click', (e) => {
        if (e.target.id === 'advanced-settings-modal') {
            closeAdvancedSettingsModal();
        }
    });

    // 装修加成输入变化
    document.getElementById('decoration-bonus-input').addEventListener('change', (e) => {
        const value = parseFloat(e.target.value) || 0;
        ADVANCED_SETTINGS.decorationBonus = Math.max(0, parseFloat(value));
        saveAdvancedSettings();
    });

    // 基础人流量输入变化
    document.getElementById('base-traffic-input').addEventListener('change', (e) => {
        const value = parseInt(e.target.value) || 0;
        ADVANCED_SETTINGS.baseTraffic = Math.max(0, value);
        saveAdvancedSettings();
    });
    
    // 专属客服开关变化
    document.getElementById('exclusive-service-switch').addEventListener('change', (e) => {
        ADVANCED_SETTINGS.exclusiveServiceEnabled = e.target.checked;
        saveAdvancedSettings();
    });
    
    // 风向标开关变化
    document.getElementById('windvane-switch').addEventListener('change', (e) => {
        ADVANCED_SETTINGS.windVaneEnabled = e.target.checked;
        saveAdvancedSettings();
        renderCurrentWindVane();
    });
    
    // 清除数据按钮
    document.getElementById('clear-data-btn').addEventListener('click', clearAllLocalData);

    // ESC键关闭模态框
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAnnouncementModal();
            closeAdvancedSettingsModal();
            closeConfirmModal();
        }
    });

    // 确认弹窗按钮事件
    document.getElementById('confirm-ok-btn').addEventListener('click', () => {
        const cb = confirmCallback;
        closeConfirmModal();
        if (cb) cb();
    });
    document.getElementById('confirm-cancel-btn').addEventListener('click', closeConfirmModal);
    document.getElementById('confirm-modal').addEventListener('click', (e) => {
        if (e.target.id === 'confirm-modal') {
            closeConfirmModal();
        }
    });

    // GitHub按钮二次确认（使用自定义弹窗）
    const githubButtons = document.querySelectorAll('.github-link');
    githubButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            showConfirmDialog({
                title: '跳转确认',
                message: '确定要跳转到 GitHub 仓库吗？',
                onConfirm: () => {
                    // 真正跳转
                    window.open(btn.href, btn.target || '_self');
                }
            });
        });
    });
});
