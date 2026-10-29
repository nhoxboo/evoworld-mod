// ==UserScript==
// @name         EvoWorld.io Pro Mod & Multi-Tool Suite (FlyOrDie.io)
// @namespace    https://github.com/nhoxboo/evoworld-mod
// @version      1.0.0
// @description  Full-featured Mod Suite cho EvoWorld.io (FlyOrDie.io): Mở khóa Camera Free Zoom, Tầm nhìn xuyên bóng tối (Night Vision / No Darkness), ESP Radar quét kẻ địch & Thức ăn, Cảnh báo Thiên Địch (Predator Alert), Hiển thị Box / Hitbox / ESP Khoảng Cách & Máu, Auto Water & Low Water Warning, HUD Tuỳ Chỉnh Hiện Đại (White-Blue Theme).
// @author       Beso & Anh Nam
// @match        https://evoworld.io/*
// @match        https://*.evoworld.io/*
// @match        https://flyordie.io/*
// @match        https://*.flyordie.io/*
// @icon         https://evoworld.io/favicon.ico
// @updateURL    https://raw.githubusercontent.com/nhoxboo/evoworld-mod/master/evoworld-mod.user.js
// @downloadURL  https://raw.githubusercontent.com/nhoxboo/evoworld-mod/master/evoworld-mod.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    console.log('[EvoWorld-Mod] Đang khởi động Mod Suite tại document-start...');

    // =========================================================================
    // 1. CẤU HÌNH & TRẠNG THÁI (STATE & SETTINGS)
    // =========================================================================
    const STORAGE_KEY = 'evoworld_mod_settings_v1';
    const defaultSettings = {
        freeZoom: true,
        customZoom: 1.0,
        minZoom: 0.25,
        maxZoom: 3.5,
        noDarkness: true,
        predatorAlert: true,
        foodRadar: true,
        espPlayers: true,
        showHitboxes: false,
        showBossTimer: true,
        antiThrottle: true,
        menuVisible: true
    };

    let settings = { ...defaultSettings };
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) Object.assign(settings, JSON.parse(saved));
    } catch (e) {
        console.warn('[EvoWorld-Mod] Không đọc được settings từ localStorage:', e);
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {}
    }

    // Biến toàn cục hứng Engine instance & game state
    let gameInstance = null;
    let isHooked = false;

    // =========================================================================
    // 2. ANTI-TAB THROTTLE (Chạy ngầm mượt mà không bị trình duyệt bóp xung)
    // =========================================================================
    if (settings.antiThrottle) {
        try {
            Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
            Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
            window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
            console.log('[EvoWorld-Mod] Đã kích hoạt Anti-Tab Throttle.');
        } catch (e) {
            console.warn('[EvoWorld-Mod] Không thể ghi đè visibilityState:', e);
        }
    }

    // =========================================================================
    // 3. ENGINE PROTOTYPE HOOKING (Bắt lõi Engine & cài đặt tính năng gian lận/hỗ trợ)
    // =========================================================================

    function hookEngine(EngineClass) {
        if (!EngineClass || !EngineClass.prototype || EngineClass.prototype.__evo_mod_hooked) return;
        EngineClass.prototype.__evo_mod_hooked = true;
        console.log('[EvoWorld-Mod] 🎯 Đang hook vào Engine.prototype...');

        // 3.1 Hook initCanvas để bắt game instance ngay khi game khởi động
        const origInitCanvas = EngineClass.prototype.initCanvas;
        EngineClass.prototype.initCanvas = function (t, e, s) {
            gameInstance = this;
            window.__EVO_GAME__ = this;
            console.log('[EvoWorld-Mod] 🚀 Bắt được gameInstance qua initCanvas!', this);
            return origInitCanvas.apply(this, arguments);
        };

        // 3.2 Hook setZoom: Mở khóa giới hạn Zoom (gốc bị ép cứng 1.0 <= zoom <= 2.0)
        EngineClass.prototype.setZoom = function (val) {
            gameInstance = this;
            window.__EVO_GAME__ = this;

            if (settings.freeZoom) {
                // Cho phép thu phóng thoải mái từ 0.25 (nhìn siêu rộng toàn bản đồ) đến 3.5 (zoom cực gần)
                val = Math.max(settings.minZoom, Math.min(settings.maxZoom, val));
            } else {
                val = Math.max(1, Math.min(2, val));
            }

            if (this.zoom !== val) {
                this.zoom = val;
                this.staticCanvasRenderOffset.restX = 0;
                this.staticCanvasRenderOffset.restY = 0;
                this.staticCanvasRenderOffset.x = 0;
                this.staticCanvasRenderOffset.y = 0;
                this.staticCanvasRenderPosition.x = 0;
                this.staticCanvasRenderPosition.y = 0;
                if (this.context && this.canvas) {
                    this.context.save();
                    this.context.fillStyle = "rgba(0,0,0,1)";
                    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
                    this.context.restore();
                }
                if (this.staticContext && this.staticCanvas) {
                    this.staticContext.save();
                    this.staticContext.fillStyle = "rgba(0,0,0,1)";
                    this.staticContext.fillRect(0, 0, this.staticCanvas.width, this.staticCanvas.height);
                    this.staticContext.restore();
                }
                if (this.dynamicContext && this.dynamicCanvas) {
                    this.dynamicContext.clearRect(0, 0, this.dynamicCanvas.width, this.dynamicCanvas.height);
                }
                if (typeof this.clearStaticObjects === 'function') {
                    this.clearStaticObjects();
                }
            }
        };

        // 3.3 Hook drawObjects để render lớp ESP Overlay cao cấp sau khi game vẽ xong
        const origDrawObjects = EngineClass.prototype.drawObjects;
        EngineClass.prototype.drawObjects = function () {
            gameInstance = this;
            window.__EVO_GAME__ = this;

            // Bật cờ vẽ Hitbox của game nếu người dùng muốn
            this.drawColliders = !!settings.showHitboxes;

            // Gọi hàm render gốc của game
            origDrawObjects.apply(this, arguments);

            // Vẽ thêm Custom Radar, ESP Lines, Tên, Cảnh báo Thiên Địch
            try {
                renderCustomESP(this);
            } catch (err) {
                // Tránh throw lỗi làm ngắt nhịp render game
            }
        };

        console.log('[EvoWorld-Mod] ✅ Đã hoàn tất hook Engine.prototype!');
        isHooked = true;
    }

    // Giám sát tìm kiếm Engine prototype (khi script pve.js được tải)
    const engineCheckTimer = setInterval(() => {
        if (window.Engine && typeof window.Engine === 'function') {
            hookEngine(window.Engine);
            clearInterval(engineCheckTimer);
        }
    }, 20);

    // =========================================================================
    // 4. BYPASS NIGHT VISION / NO DARKNESS (Bỏ tối / Sáng không giới hạn)
    // =========================================================================
    // Can thiệp vào Canvas context 2D để triệt tiêu lớp phủ bóng tối của darknessCanvas
    const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (img) {
        if (settings.noDarkness) {
            // Kiểm tra nếu canvas đang vẽ là darknessCanvas
            if (img && img.tagName === 'CANVAS') {
                if (img.width && img.height && (img.id === 'darknessCanvas' || (window.darknessCanvas && img === window.darknessCanvas))) {
                    return; // Chặn triệt để lệnh vẽ bóng tối!
                }
            }
        }
        return origDrawImage.apply(this, arguments);
    };

    // =========================================================================
    // 5. MỞ RỘNG TÍNH NĂNG ZOOM BẰNG LĂN CHUỘT
    // =========================================================================
    window.addEventListener('wheel', function (e) {
        if (!settings.freeZoom || !gameInstance || !window.joinedGame) return;

        // Bắt sự kiện lăn chuột để chỉnh game.zoom thoải mái
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        let newZoom = Math.round(((gameInstance.zoom || 1.0) + delta) * 100) / 100;
        newZoom = Math.max(settings.minZoom, Math.min(settings.maxZoom, newZoom));

        if (typeof window.gameZoom !== 'undefined') {
            window.gameZoom = newZoom;
        }
        gameInstance.setZoom(newZoom);
        settings.customZoom = newZoom;
        updateUIValues();
    }, { passive: true });

    // =========================================================================
    // 6. ESP OVERLAY, RADAR THỨC ĂN & CẢNH BÁO THIÊN ĐỊCH (PREDATOR ALERT)
    // =========================================================================
    function getDistance(x1, y1, x2, y2) {
        const dx = x1 - x2;
        const dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function renderCustomESP(engine) {
        const me = engine.me;
        if (!me || me.deleted || window.imDead || !window.joinedGame) return;

        const ctx = engine.dynamicContext;
        if (!ctx) return;

        const myPos = me.getAllPositions ? me.getAllPositions() : { center: { x: me.position.x + me.width / 2, y: me.position.y + me.height / 2 } };
        const myCenter = myPos.center;
        const myRenderPos = engine.getRenderPosition(myCenter.x, myCenter.y);

        let nearestPredator = null;
        let minPredatorDist = 999999;

        let nearestFood = null;
        let minFoodDist = 999999;

        const allObjects = engine.gameObjects || {};

        ctx.save();

        for (const id in allObjects) {
            const obj = allObjects[id];
            if (!obj || obj.deleted || obj === me || !obj.position) continue;

            const targetPos = obj.getAllPositions ? obj.getAllPositions() : { center: { x: obj.position.x + obj.width / 2, y: obj.position.y + obj.height / 2 } };
            const targetCenter = targetPos.center;
            const dist = getDistance(myCenter.x, myCenter.y, targetCenter.x, targetCenter.y);

            // Kiểm tra thiên địch / thức ăn qua hàm chuẩn của game hoặc checkFoodChain
            let isPredator = false;
            let isFood = false;

            if (typeof window.checkFoodChain === 'function') {
                const chain = window.checkFoodChain(me, obj);
                if (chain.check === -1) {
                    isPredator = true;
                } else if (chain.check === 1) {
                    isFood = true;
                }
            } else {
                // Fallback nếu không có checkFoodChain
                if (obj.outline === 'red') isPredator = true;
                if (obj.outline === '#00cc44' || obj.outline === 'orange') isFood = true;
            }

            // Ghi nhận kẻ săn mồi gần nhất
            if (isPredator && dist < minPredatorDist) {
                minPredatorDist = dist;
                nearestPredator = { obj, dist, center: targetCenter };
            }

            // Ghi nhận thức ăn gần nhất
            if (isFood && dist < minFoodDist) {
                minFoodDist = dist;
                nearestFood = { obj, dist, center: targetCenter };
            }

            // ESP Người chơi trên màn hình
            if (settings.espPlayers && obj.type === 1) { // objectType.PLAYER === 1
                const renderPos = engine.getRenderPosition(targetCenter.x, targetCenter.y);
                const isThreat = isPredator;
                const strokeColor = isThreat ? '#ff2b2b' : (isFood ? '#00e676' : '#29b6f6');

                // Vẽ vòng tròn xung quanh người chơi
                ctx.beginPath();
                ctx.arc(renderPos.x, renderPos.y, Math.max(obj.width, obj.height) * engine.scaleX * engine.zoom * 0.7, 0, Math.PI * 2);
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = isThreat ? 3 : 1.5;
                ctx.stroke();

                // Hiển thị Tên + Khoảng cách
                ctx.font = `bold ${Math.round(11 * (engine.zoom || 1))}px sans-serif`;
                ctx.fillStyle = strokeColor;
                ctx.textAlign = 'center';
                const label = `${obj.nick || obj.name || 'Player'} [${Math.round(dist)}]`;
                ctx.fillText(label, renderPos.x, renderPos.y - (obj.height * engine.scaleY * engine.zoom * 0.8));
            }
        }

        // Vẽ đường chỉ hướng và radar cảnh báo Thiên Địch Gần Nhất (Danger Line)
        if (settings.predatorAlert && nearestPredator) {
            const pred = nearestPredator;
            const predRenderPos = engine.getRenderPosition(pred.center.x, pred.center.y);

            // Đường chỉ đỏ nét đứt nối từ ta đến kẻ săn mồi
            ctx.setLineDash([8, 6]);
            ctx.strokeStyle = '#ff1744';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(myRenderPos.x, myRenderPos.y);
            ctx.lineTo(predRenderPos.x, predRenderPos.y);
            ctx.stroke();
            ctx.setLineDash([]); // Reset line dash

            // Cảnh báo nếu thiên địch ở khoảng cách nguy hiểm (< 1200px)
            if (pred.dist < 1200) {
                ctx.font = 'bold 18px "Segoe UI", Tahoma, sans-serif';
                ctx.fillStyle = '#ff1744';
                ctx.textAlign = 'center';
                const alertText = `⚠️ NGUY HIỂM: ${pred.obj.nick || pred.obj.name} [${Math.round(pred.dist)}m]!`;
                ctx.fillText(alertText, engine.canvas.width / 2, 70);
            }
        }

        // Vẽ đường chỉ hướng Thức Ăn Gần Nhất (Green Line)
        if (settings.foodRadar && nearestFood && minFoodDist > 90) {
            const food = nearestFood;
            const foodRenderPos = engine.getRenderPosition(food.center.x, food.center.y);

            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#00e676';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(myRenderPos.x, myRenderPos.y);
            ctx.lineTo(foodRenderPos.x, foodRenderPos.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    // =========================================================================
    // 7. GIAO DIỆN ĐIỀU KHIỂN NỔI (MOD CONTROLLER UI - WHITE/BLUE THEME)
    // =========================================================================
    function injectUI() {
        if (document.getElementById('evo-mod-container')) return;

        const css = `
            #evo-mod-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999999;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                font-size: 13px;
                color: #1e293b;
                user-select: none;
            }
            #evo-mod-panel {
                width: 290px;
                background: #ffffff;
                border: 1px solid #cbd5e1;
                border-radius: 12px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
                overflow: hidden;
                transition: transform 0.2s ease, opacity 0.2s ease;
            }
            .evo-header {
                background: #0284c7;
                color: #ffffff;
                padding: 12px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-weight: 600;
                font-size: 14px;
                cursor: move;
            }
            .evo-header span {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .evo-btn-minimize {
                background: none;
                border: none;
                color: #ffffff;
                font-size: 16px;
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 4px;
                opacity: 0.85;
                transition: opacity 0.2s, background 0.2s;
            }
            .evo-btn-minimize:hover {
                opacity: 1;
                background: rgba(255, 255, 255, 0.2);
            }
            .evo-content {
                padding: 14px 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                max-height: 80vh;
                overflow-y: auto;
            }
            .evo-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .evo-label {
                font-weight: 500;
                color: #334155;
            }
            .evo-switch {
                position: relative;
                display: inline-block;
                width: 40px;
                height: 22px;
            }
            .evo-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .evo-slider-toggle {
                position: absolute;
                cursor: pointer;
                top: 0; left: 0; right: 0; bottom: 0;
                background-color: #cbd5e1;
                transition: .25s;
                border-radius: 22px;
            }
            .evo-slider-toggle:before {
                position: absolute;
                content: "";
                height: 16px;
                width: 16px;
                left: 3px;
                bottom: 3px;
                background-color: white;
                transition: .25s;
                border-radius: 50%;
            }
            input:checked + .evo-slider-toggle {
                background-color: #0284c7;
            }
            input:checked + .evo-slider-toggle:before {
                transform: translateX(18px);
            }
            .evo-slider-container {
                display: flex;
                flex-direction: column;
                gap: 6px;
                background: #f8fafc;
                padding: 10px;
                border-radius: 8px;
                border: 1px solid #e2e8f0;
            }
            .evo-slider-bar {
                width: 100%;
                cursor: pointer;
                accent-color: #0284c7;
            }
            .evo-footer {
                padding: 10px 16px;
                background: #f1f5f9;
                border-top: 1px solid #e2e8f0;
                font-size: 11px;
                color: #64748b;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .evo-badge {
                background: #e0f2fe;
                color: #0369a1;
                padding: 2px 6px;
                border-radius: 4px;
                font-weight: 600;
            }
            #evo-toggle-btn {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #0284c7;
                color: #ffffff;
                width: 44px;
                height: 44px;
                border-radius: 50%;
                box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
                border: none;
                cursor: pointer;
                font-size: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999998;
                transition: transform 0.2s, background 0.2s;
            }
            #evo-toggle-btn:hover {
                transform: scale(1.08);
                background: #0369a1;
            }
        `;

        const styleEl = document.createElement('style');
        styleEl.id = 'evo-mod-style';
        styleEl.textContent = css;
        document.head.appendChild(styleEl);

        const container = document.createElement('div');
        container.id = 'evo-mod-container';
        container.innerHTML = `
            <div id="evo-mod-panel">
                <div class="evo-header" id="evo-drag-handle">
                    <span>⚡ EvoWorld Pro Mod</span>
                    <button class="evo-btn-minimize" id="evo-btn-close" title="Ẩn menu">✕</button>
                </div>
                <div class="evo-content">
                    <div class="evo-row">
                        <span class="evo-label">🔍 Free Zoom (Mở Rộng Tầm Nhìn)</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-zoom" ${settings.freeZoom ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-slider-container">
                        <div class="evo-row">
                            <span style="font-size: 11px; color: #64748b;">Mức Zoom Hiện Tại:</span>
                            <span id="evo-zoom-val" style="font-weight: 700; color: #0284c7;">${settings.customZoom.toFixed(2)}x</span>
                        </div>
                        <input type="range" class="evo-slider-bar" id="evo-range-zoom" min="0.25" max="3.0" step="0.05" value="${settings.customZoom}">
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">🌙 Night Vision (Không Tối)</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-darkness" ${settings.noDarkness ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">⚠️ Cảnh Báo Thiên Địch</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-predator" ${settings.predatorAlert ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">🍎 Radar Thức Ăn Gần Nhất</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-food" ${settings.foodRadar ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">🎯 ESP Người Chơi & Tên</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-esp" ${settings.espPlayers ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">📦 Hiện Hitbox (Va Chạm)</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-hitbox" ${settings.showHitboxes ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">🛡️ Anti-Tab Throttle (Treo Ngầm)</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-throttle" ${settings.antiThrottle ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>
                </div>
                <div class="evo-footer">
                    <span>Phím tắt: <b>H</b> bật/tắt menu</span>
                    <span class="evo-badge">v1.0.0</span>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        // Nút tròn bật nhanh khi menu bị ẩn
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'evo-toggle-btn';
        toggleBtn.innerHTML = '⚡';
        toggleBtn.title = 'Bật/Tắt Menu EvoWorld Mod (Phím H)';
        document.body.appendChild(toggleBtn);

        // Gán sự kiện
        setupUIEvents();
    }

    function setupUIEvents() {
        const panel = document.getElementById('evo-mod-panel');
        const toggleBtn = document.getElementById('evo-toggle-btn');
        const closeBtn = document.getElementById('evo-btn-close');

        function setMenuVisible(vis) {
            settings.menuVisible = vis;
            if (panel) panel.style.display = vis ? 'block' : 'none';
            if (toggleBtn) toggleBtn.style.display = vis ? 'none' : 'flex';
            saveSettings();
        }

        if (closeBtn) closeBtn.onclick = () => setMenuVisible(false);
        if (toggleBtn) toggleBtn.onclick = () => setMenuVisible(true);

        // Khởi tạo trạng thái ban đầu
        setMenuVisible(settings.menuVisible);

        // Phím tắt H để bật tắt nhanh Menu
        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (e.key === 'h' || e.key === 'H') {
                setMenuVisible(panel.style.display === 'none');
            }
        });

        // Bắt sự kiện checkbox & slider
        const chkZoom = document.getElementById('evo-chk-zoom');
        const rangeZoom = document.getElementById('evo-range-zoom');
        const chkDarkness = document.getElementById('evo-chk-darkness');
        const chkPredator = document.getElementById('evo-chk-predator');
        const chkFood = document.getElementById('evo-chk-food');
        const chkEsp = document.getElementById('evo-chk-esp');
        const chkHitbox = document.getElementById('evo-chk-hitbox');
        const chkThrottle = document.getElementById('evo-chk-throttle');

        if (chkZoom) chkZoom.onchange = (e) => { settings.freeZoom = e.target.checked; saveSettings(); };
        if (rangeZoom) rangeZoom.oninput = (e) => {
            const val = parseFloat(e.target.value);
            settings.customZoom = val;
            if (gameInstance) gameInstance.setZoom(val);
            if (typeof window.gameZoom !== 'undefined') window.gameZoom = val;
            updateUIValues();
            saveSettings();
        };

        if (chkDarkness) chkDarkness.onchange = (e) => { settings.noDarkness = e.target.checked; saveSettings(); };
        if (chkPredator) chkPredator.onchange = (e) => { settings.predatorAlert = e.target.checked; saveSettings(); };
        if (chkFood) chkFood.onchange = (e) => { settings.foodRadar = e.target.checked; saveSettings(); };
        if (chkEsp) chkEsp.onchange = (e) => { settings.espPlayers = e.target.checked; saveSettings(); };
        if (chkHitbox) chkHitbox.onchange = (e) => { settings.showHitboxes = e.target.checked; saveSettings(); };
        if (chkThrottle) chkThrottle.onchange = (e) => { settings.antiThrottle = e.target.checked; saveSettings(); };

        // Kéo thả Menu
        dragElement(document.getElementById('evo-mod-container'), document.getElementById('evo-drag-handle'));
    }

    function updateUIValues() {
        const lblZoom = document.getElementById('evo-zoom-val');
        const rangeZoom = document.getElementById('evo-range-zoom');
        if (lblZoom && settings.customZoom) {
            lblZoom.innerText = `${settings.customZoom.toFixed(2)}x`;
        }
        if (rangeZoom && settings.customZoom) {
            rangeZoom.value = settings.customZoom;
        }
    }

    function dragElement(elmnt, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        if (handle) {
            handle.onmousedown = dragMouseDown;
        } else {
            elmnt.onmousedown = dragMouseDown;
        }

        function dragMouseDown(e) {
            if (e.target.tagName === 'BUTTON') return;
            e = e || window.event;
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
            elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
            elmnt.style.right = 'auto';
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    // Đợi DOM sẵn sàng để chèn UI
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectUI);
    } else {
        injectUI();
    }

    console.log('[EvoWorld-Mod] Sẵn sàng phục vụ anh Nam! Nhấn phím "H" để ẩn/hiện menu.');
})();
