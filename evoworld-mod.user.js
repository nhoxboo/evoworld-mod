// ==UserScript==
// @name         EvoWorld.io Pro Mod & Ultimate Cheat Suite (FlyOrDie.io)
// @namespace    https://github.com/nhoxboo/evoworld-mod
// @version      2.0.0
// @description  Bản Nâng Cấp Toàn Diện v2.0 cho EvoWorld.io (FlyOrDie.io): Free Zoom 0.25x-3.5x, Night Vision không giới hạn, ESP Radar kẻ địch & thức ăn, Cảnh báo Thiên Địch & Cứu Nguy Khẩn Cấp, Laser Aim Guide, Auto-Skill khi máu thấp, Auto Boost Macro, Lọc Thức Ăn High-EXP, Boss & Safezone Radar, Anti-Tab Throttle & Modern White-Blue HUD.
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

    console.log('[EvoWorld-Mod-v2] 🚀 Đang khởi động Mod Suite Toàn Diện v2.0...');

    // =========================================================================
    // 1. CẤU HÌNH & TRẠNG THÁI (STATE & SETTINGS)
    // =========================================================================
    const STORAGE_KEY = 'evoworld_mod_settings_v2';
    const defaultSettings = {
        // Visual & Zoom
        freeZoom: true,
        customZoom: 1.0,
        minZoom: 0.25,
        maxZoom: 3.5,
        noDarkness: true,
        showHitboxes: false,

        // ESP & Radar
        predatorAlert: true,
        foodRadar: true,
        espPlayers: true,
        espDistance: true,
        laserAim: true,
        highExpFilter: true,
        showSafeZones: true,

        // Automation & Combat Assist
        autoSkillEmergency: true,
        autoSkillHpPercent: 35,
        autoBoostMacro: false,
        emergencyWaterAlert: true,
        emergencyWaterThreshold: 25,

        // System
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

    // Biến toàn cục hứng Engine instance, Socket & Game state
    let gameInstance = null;
    let isHooked = false;
    let lastAutoSkillTime = 0;
    let lastBoostToggleTime = 0;
    let autoBoostActive = false;
    let isHoldingRightClick = false;

    // =========================================================================
    // 2. ANTI-TAB THROTTLE (Chạy ngầm mượt mà không bị trình duyệt bóp FPS)
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
    // 3. ENGINE PROTOTYPE HOOKING (Bắt lõi Engine & cài đặt tính năng sâu)
    // =========================================================================
    function hookEngine(EngineClass) {
        if (!EngineClass || !EngineClass.prototype || EngineClass.prototype.__evo_mod_v2_hooked) return;
        EngineClass.prototype.__evo_mod_v2_hooked = true;
        console.log('[EvoWorld-Mod] 🎯 Đang hook vào Engine.prototype v2...');

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

        // 3.3 Hook drawObjects để render lớp ESP Overlay & Trajectory sau khi game vẽ
        const origDrawObjects = EngineClass.prototype.drawObjects;
        EngineClass.prototype.drawObjects = function () {
            gameInstance = this;
            window.__EVO_GAME__ = this;

            // Bật cờ vẽ Hitbox của game
            this.drawColliders = !!settings.showHitboxes;

            // Gọi hàm render gốc của game
            origDrawObjects.apply(this, arguments);

            // Chạy automation loop & render custom overlays
            try {
                runAutomationLoop(this);
                renderCustomESP(this);
            } catch (err) {
                // Tránh throw lỗi làm ngắt nhịp render game
            }
        };

        console.log('[EvoWorld-Mod] ✅ Đã hoàn tất hook Engine.prototype v2!');
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
    // 4. NIGHT VISION / NO DARKNESS (Bỏ tối / Sáng không giới hạn)
    // =========================================================================
    const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (img) {
        if (settings.noDarkness) {
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
    // 6. AUTOMATION & COMBAT ASSIST (Tự động hóa & Hỗ trợ chiến đấu)
    // =========================================================================
    function triggerSkill() {
        if (typeof window.skillUse === 'function') {
            window.skillUse();
            return true;
        }
        // Fallback phím Space
        window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 32, which: 32, code: 'Space', bubbles: true }));
        setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 32, which: 32, code: 'Space', bubbles: true }));
        }, 50);
        return true;
    }

    function triggerBoost(enable) {
        if (typeof window.boost === 'function') {
            window.boost(enable);
        } else {
            // Fallback click chuột trái
            if (enable) {
                window.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
            } else {
                window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
            }
        }
    }

    // Tự động kích hoạt khi vào chu kỳ update frame
    function runAutomationLoop(engine) {
        const me = engine.me;
        if (!me || me.deleted || window.imDead || !window.joinedGame) return;

        const now = Date.now();

        // 6.1 Auto-Skill khẩn cấp khi máu thấp (Emergency Skill)
        if (settings.autoSkillEmergency && now - lastAutoSkillTime > 2500) {
            let hpRatio = 1.0;
            if (typeof me.health === 'number' && typeof me.maxHealth === 'number' && me.maxHealth > 0) {
                hpRatio = me.health / me.maxHealth;
            } else if (typeof me.hp === 'number' && typeof me.maxHp === 'number' && me.maxHp > 0) {
                hpRatio = me.hp / me.maxHp;
            }

            if (hpRatio <= (settings.autoSkillHpPercent / 100)) {
                const skillReady = !me.skill || !me.skill.cooldown;
                if (skillReady) {
                    console.log('[EvoWorld-Mod] ⚠️ Máu nguy hiểm (' + Math.round(hpRatio * 100) + '%), Tự động kích hoạt Kỹ Năng!');
                    triggerSkill();
                    lastAutoSkillTime = now;
                }
            }
        }

        // 6.2 Macro Auto Boost nhấp nhả thông minh khi giữ phím Shift hoặc chuột phải
        if (settings.autoBoostMacro && isHoldingRightClick) {
            if (now - lastBoostToggleTime > 120) {
                autoBoostActive = !autoBoostActive;
                triggerBoost(autoBoostActive);
                lastBoostToggleTime = now;
            }
        }
    }

    // Bắt sự kiện giữ chuột phải để kích hoạt Auto Boost Macro
    window.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
            isHoldingRightClick = true;
        }
    });
    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            isHoldingRightClick = false;
            triggerBoost(false);
        }
    });

    // =========================================================================
    // 7. ESP OVERLAY, LASER AIM, RADAR NƯỚC & THIÊN ĐỊCH
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

        let nearestWater = null;
        let minWaterDist = 999999;

        const allObjects = engine.gameObjects || {};

        ctx.save();

        for (const id in allObjects) {
            const obj = allObjects[id];
            if (!obj || obj.deleted || obj === me || !obj.position) continue;

            const targetPos = obj.getAllPositions ? obj.getAllPositions() : { center: { x: obj.position.x + obj.width / 2, y: obj.position.y + obj.height / 2 } };
            const targetCenter = targetPos.center;
            const dist = getDistance(myCenter.x, myCenter.y, targetCenter.x, targetCenter.y);

            // Nhận diện nguồn nước / mây nước
            if (obj.type === 2 || obj.type === 3 || obj.name === 'water' || obj.name === 'cloud' || (obj.texture && typeof obj.texture.indexOf === 'function' && obj.texture.indexOf('water') !== -1)) {
                if (dist < minWaterDist) {
                    minWaterDist = dist;
                    nearestWater = { obj, dist, center: targetCenter };
                }
            }

            // Nhận diện vùng ẩn nấp Safe Zone
            if (settings.showSafeZones && (obj.type === 4 || obj.name === 'hide' || (obj.texture && typeof obj.texture.indexOf === 'function' && obj.texture.indexOf('hide') !== -1))) {
                if (dist < 1500) {
                    const renderPos = engine.getRenderPosition(targetCenter.x, targetCenter.y);
                    ctx.strokeStyle = '#38bdf8';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 4]);
                    ctx.strokeRect(renderPos.x - 30, renderPos.y - 30, 60, 60);
                    ctx.font = '10px sans-serif';
                    ctx.fillStyle = '#38bdf8';
                    ctx.textAlign = 'center';
                    ctx.fillText('Nơi Nấp [Safe]', renderPos.x, renderPos.y - 35);
                    ctx.setLineDash([]);
                }
            }

            // Phân loại Thiên Địch / Thức Ăn
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
                const strokeColor = isThreat ? '#ff2b2b' : (isFood ? '#00e676' : '#38bdf8');

                // Vòng tròn ESP
                ctx.beginPath();
                ctx.arc(renderPos.x, renderPos.y, Math.max(obj.width, obj.height) * engine.scaleX * engine.zoom * 0.7, 0, Math.PI * 2);
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = isThreat ? 3 : 1.5;
                ctx.stroke();

                // Tên & Khoảng cách
                ctx.font = `bold ${Math.max(10, Math.round(11 * (engine.zoom || 1)))}px sans-serif`;
                ctx.fillStyle = strokeColor;
                ctx.textAlign = 'center';
                const label = `${obj.nick || obj.name || 'Player'} [${Math.round(dist)}]`;
                ctx.fillText(label, renderPos.x, renderPos.y - (obj.height * engine.scaleY * engine.zoom * 0.8));

                // Hiển thị thanh máu đối thủ nếu có dữ liệu
                if (obj.health && obj.maxHealth) {
                    const barW = 50 * engine.zoom;
                    const barH = 5 * engine.zoom;
                    const barX = renderPos.x - barW / 2;
                    const barY = renderPos.y - (obj.height * engine.scaleY * engine.zoom * 0.8) - 12;
                    const pct = Math.max(0, Math.min(1, obj.health / obj.maxHealth));

                    ctx.fillStyle = 'rgba(0,0,0,0.6)';
                    ctx.fillRect(barX, barY, barW, barH);
                    ctx.fillStyle = isThreat ? '#ef4444' : '#22c55e';
                    ctx.fillRect(barX, barY, barW * pct, barH);
                }
            }
        }

        // 7.1 Laser Aim Guide (Tia ngắm săn mồi chuẩn xác)
        if (settings.laserAim && me.rotation !== undefined) {
            const rot = me.rotation;
            const aimDist = 280 * (engine.zoom || 1);
            const aimEndX = myRenderPos.x + Math.cos(rot) * aimDist;
            const aimEndY = myRenderPos.y + Math.sin(rot) * aimDist;

            ctx.strokeStyle = 'rgba(2, 132, 199, 0.75)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 3]);
            ctx.beginPath();
            ctx.moveTo(myRenderPos.x, myRenderPos.y);
            ctx.lineTo(aimEndX, aimEndY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Tâm ngắm ở đầu mũi tia laser
            ctx.beginPath();
            ctx.arc(aimEndX, aimEndY, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#0284c7';
            ctx.fill();
        }

        // 7.2 Cảnh báo Thiên Địch Gần Nhất (Danger Line & Alert Banner)
        if (settings.predatorAlert && nearestPredator) {
            const pred = nearestPredator;
            const predRenderPos = engine.getRenderPosition(pred.center.x, pred.center.y);

            ctx.setLineDash([8, 6]);
            ctx.strokeStyle = '#ff1744';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(myRenderPos.x, myRenderPos.y);
            ctx.lineTo(predRenderPos.x, predRenderPos.y);
            ctx.stroke();
            ctx.setLineDash([]);

            if (pred.dist < 1400) {
                ctx.font = 'bold 18px "Segoe UI", Tahoma, sans-serif';
                ctx.fillStyle = '#ff1744';
                ctx.textAlign = 'center';
                const alertText = `⚠️ THIÊN ĐỊCH: ${pred.obj.nick || pred.obj.name} [${Math.round(pred.dist)}px]!`;
                ctx.fillText(alertText, engine.canvas.width / 2, 70);
            }
        }

        // 7.3 Radar Thức Ăn Gần Nhất (Green Line)
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

        // 7.4 Cảnh Báo Nước Khẩn Cấp (Emergency Water Warning & Guide Path)
        if (settings.emergencyWaterAlert) {
            let waterLevel = 100;
            if (typeof window.lastWater === 'number') waterLevel = window.lastWater;
            if (waterLevel <= settings.emergencyWaterThreshold) {
                ctx.font = 'bold 17px "Segoe UI", Tahoma, sans-serif';
                ctx.fillStyle = '#0ea5e9';
                ctx.textAlign = 'center';
                ctx.fillText(`💧 NƯỚC SẮP CẠN (${Math.round(waterLevel)}%)!`, engine.canvas.width / 2, 100);

                if (nearestWater) {
                    const waterRenderPos = engine.getRenderPosition(nearestWater.center.x, nearestWater.center.y);
                    ctx.setLineDash([4, 4]);
                    ctx.strokeStyle = '#0284c7';
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.moveTo(myRenderPos.x, myRenderPos.y);
                    ctx.lineTo(waterRenderPos.x, waterRenderPos.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        }

        ctx.restore();
    }

    // =========================================================================
    // 8. GIAO DIỆN ĐIỀU KHIỂN NỔI (MOD CONTROLLER UI - WHITE/BLUE THEME)
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
                width: 320px;
                background: #ffffff;
                border: 1px solid #cbd5e1;
                border-radius: 14px;
                box-shadow: 0 12px 30px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
                overflow: hidden;
                transition: transform 0.2s ease, opacity 0.2s ease;
            }
            .evo-header {
                background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
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
                background: rgba(255, 255, 255, 0.25);
            }
            .evo-content {
                padding: 14px 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                max-height: 80vh;
                overflow-y: auto;
            }
            .evo-section-title {
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #64748b;
                border-bottom: 1px solid #f1f5f9;
                padding-bottom: 4px;
                margin-top: 4px;
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
                width: 38px;
                height: 20px;
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
                border-radius: 20px;
            }
            .evo-slider-toggle:before {
                position: absolute;
                content: "";
                height: 14px;
                width: 14px;
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
                    <span>⚡ EvoWorld Ultimate Suite</span>
                    <button class="evo-btn-minimize" id="evo-btn-close" title="Ẩn menu">✕</button>
                </div>
                <div class="evo-content">
                    <div class="evo-section-title">🔍 TẦM NHÌN & VISUAL</div>
                    <div class="evo-row">
                        <span class="evo-label">Free Zoom Toàn Cảnh</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-zoom" ${settings.freeZoom ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-slider-container">
                        <div class="evo-row">
                            <span style="font-size: 11px; color: #64748b;">Mức Zoom:</span>
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
                        <span class="evo-label">📦 Hiện Hitbox Va Chạm</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-hitbox" ${settings.showHitboxes ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-section-title">🎯 RADAR & TÁC CHIẾN</div>
                    <div class="evo-row">
                        <span class="evo-label">⚠️ Cảnh Báo Thiên Địch</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-predator" ${settings.predatorAlert ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">🍎 Radar Thức Ăn Gần</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-food" ${settings.foodRadar ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">🏹 Laser Aim Guide (Tia Ngắm)</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-laser" ${settings.laserAim ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">🛡️ ESP Safe Zone (Bụi Ẩn Nấp)</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-safezone" ${settings.showSafeZones ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">👥 ESP Người Chơi & Máu</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-esp" ${settings.espPlayers ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-section-title">🤖 TỰ ĐỘNG HÓA & SINH TỒN</div>
                    <div class="evo-row">
                        <span class="evo-label">✨ Auto-Skill Khi Máu Thấp</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-autoskill" ${settings.autoSkillEmergency ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">🚀 Chuột Phải Auto-Boost</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-autoboost" ${settings.autoBoostMacro ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">💧 Radar Dẫn Nước Khẩn Cấp</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-water" ${settings.emergencyWaterAlert ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>

                    <div class="evo-row">
                        <span class="evo-label">⚡ Anti-Tab Throttle (Treo Ngầm)</span>
                        <label class="evo-switch">
                            <input type="checkbox" id="evo-chk-throttle" ${settings.antiThrottle ? 'checked' : ''}>
                            <span class="evo-slider-toggle"></span>
                        </label>
                    </div>
                </div>
                <div class="evo-footer">
                    <span>Phím tắt: <b>H</b> bật/tắt</span>
                    <span class="evo-badge">v2.0.0</span>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'evo-toggle-btn';
        toggleBtn.innerHTML = '⚡';
        toggleBtn.title = 'Bật/Tắt Menu EvoWorld Mod (Phím H)';
        document.body.appendChild(toggleBtn);

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

        setMenuVisible(settings.menuVisible);

        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (e.key === 'h' || e.key === 'H') {
                setMenuVisible(panel.style.display === 'none');
            }
        });

        // Bắt các element tương tác
        const chkZoom = document.getElementById('evo-chk-zoom');
        const rangeZoom = document.getElementById('evo-range-zoom');
        const chkDarkness = document.getElementById('evo-chk-darkness');
        const chkHitbox = document.getElementById('evo-chk-hitbox');
        const chkPredator = document.getElementById('evo-chk-predator');
        const chkFood = document.getElementById('evo-chk-food');
        const chkLaser = document.getElementById('evo-chk-laser');
        const chkSafezone = document.getElementById('evo-chk-safezone');
        const chkEsp = document.getElementById('evo-chk-esp');
        const chkAutoSkill = document.getElementById('evo-chk-autoskill');
        const chkAutoBoost = document.getElementById('evo-chk-autoboost');
        const chkWater = document.getElementById('evo-chk-water');
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
        if (chkHitbox) chkHitbox.onchange = (e) => { settings.showHitboxes = e.target.checked; saveSettings(); };
        if (chkPredator) chkPredator.onchange = (e) => { settings.predatorAlert = e.target.checked; saveSettings(); };
        if (chkFood) chkFood.onchange = (e) => { settings.foodRadar = e.target.checked; saveSettings(); };
        if (chkLaser) chkLaser.onchange = (e) => { settings.laserAim = e.target.checked; saveSettings(); };
        if (chkSafezone) chkSafezone.onchange = (e) => { settings.showSafeZones = e.target.checked; saveSettings(); };
        if (chkEsp) chkEsp.onchange = (e) => { settings.espPlayers = e.target.checked; saveSettings(); };
        if (chkAutoSkill) chkAutoSkill.onchange = (e) => { settings.autoSkillEmergency = e.target.checked; saveSettings(); };
        if (chkAutoBoost) chkAutoBoost.onchange = (e) => { settings.autoBoostMacro = e.target.checked; saveSettings(); };
        if (chkWater) chkWater.onchange = (e) => { settings.emergencyWaterAlert = e.target.checked; saveSettings(); };
        if (chkThrottle) chkThrottle.onchange = (e) => { settings.antiThrottle = e.target.checked; saveSettings(); };

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectUI);
    } else {
        injectUI();
    }

    console.log('[EvoWorld-Mod] Sẵn sàng phục vụ anh Nam! Nhấn phím "H" để ẩn/hiện menu.');
})();
