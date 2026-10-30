// ==UserScript==
// @name         EvoWorld.io Pro Mod & Ultimate Cheat Suite (FlyOrDie.io)
// @namespace    https://github.com/nhoxboo/evoworld-mod
// @version      2.2.0
// @description  Bản Nâng Cấp Toàn Diện v2.2: Bypass Tampermonkey sandbox, Auto +30% EXP không cần quảng cáo, Skin Changer (Thần Chết miễn phí), Chọn Con Vật Xuất Phát, Free Zoom 0.25x-3.5x, Night Vision, ESP Radar & Tự động hóa sinh tồn.
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

    // Đưa toàn bộ code vào trang web chính để truy cập trực tiếp biến nội bộ của game
    const pageScript = function () {
        console.log('[EvoWorld-Mod-v2.2] 🚀 Khởi chạy Mod Suite Toàn Diện trong trang chính...');

        // =========================================================================
        // 1. CẤU HÌNH & TRẠNG THÁI (STATE & SETTINGS)
        // =========================================================================
        const STORAGE_KEY = 'evoworld_mod_settings_v2';
        const defaultSettings = {
            // Exp & Join
            auto30Exp: true,
            autoStartCharacter: true,
            startCharacterIndex: 0,
            freeSkinChanger: true,
            forceSkinName: 'grimReaper', // grimReaper by default

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
            laserAim: true,

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
        } catch (e) {}

        function saveSettings() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            } catch (e) {}
        }

        // =========================================================================
        // 2. TỰ ĐỘNG KÍCH HOẠT +30% EXP KHÔNG CẦN XEM QUẢNG CÁO
        // =========================================================================
        function activateExpBonus() {
            if (!settings.auto30Exp) return;
            try {
                if (typeof window.startBonus !== 'undefined') {
                    window.startBonus = true;
                }
                Object.defineProperty(window, 'startBonus', {
                    get: () => true,
                    set: () => {},
                    configurable: true
                });
            } catch (e) {}
        }
        activateExpBonus();
        setInterval(activateExpBonus, 1000);

        // =========================================================================
        // 3. ANTI-TAB THROTTLE
        // =========================================================================
        if (settings.antiThrottle) {
            try {
                Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
                Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
                window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
            } catch (e) {}
        }

        // =========================================================================
        // 4. SKIN CHANGER (BẺ KHÓA SKIN MIẄN PHÍ - THẦN CHẾT / BẤT CỨ SKIN NÀO)
        // =========================================================================
        // Game lưu skin của nhân vật trong modifyObject.skin. Ta sẽ hook vào lớp render để ép override skin theo ý muốn.
        const origModifyObjectSkinSetter = (() => {
            // Luôn ép skin thành forceSkinName khi render
            const hookTarget = () => {};
            return hookTarget;
        })();

        // Bắt event khi game modify object (skin) và ép override ngay lập tức
        window.addEventListener('DOMContentLoaded', () => {
            const observer = new MutationObserver(() => {
                try {
                    if (!settings.freeSkinChanger || !settings.forceSkinName) return;
                    // Ép toàn bộ phần tử ảnh skin hiển thị trên giao diện chính về skin người chơi chọn
                    const skinEls = document.querySelectorAll('[data-skin], .skinPreview, .selectedSkin, img[data-skinn]');
                    skinEls.forEach(el => {
                        try {
                            el.setAttribute('data-skin', settings.forceSkinName);
                            if (el.tagName === 'IMG') {
                                // Có thể ép src trực tiếp nếu cần
                            }
                        } catch (e) {}
                    });
                } catch (e) {}
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });

        // Khi game render nhân vật, hook vào modifyObject để ép skin ngay trước khi vẽ canvas
        const originalModifyObject = window.modifyObject;
        if (typeof window.modifyObject === 'function') {
            window.modifyObject = function (objectId, ...args) {
                const result = originalModifyObject.apply(this, arguments);
                if (settings.freeSkinChanger && settings.forceSkinName) {
                    try {
                        if (window.game && window.game.objects && window.game.objects[objectId]) {
                            const obj = window.game.objects[objectId];
                            if (obj.type === 1 && obj.nick === window.name) {
                                obj.skin = settings.forceSkinName;
                                obj.modifyObject = obj.modifyObject || {};
                                obj.modifyObject.skin = settings.forceSkinName;
                            }
                        }
                    } catch (e) {}
                }
                return result;
            };
        }

        // =========================================================================
        // 5. BẤT CỨ CON VẬT XUẤT PHÁT (START CHARACTER SELECTOR)
        // =========================================================================
        // Game kiểm tra: e.startCharacter = (user.startPoints > 0 || buyStartCharacter) ? startCharacter : 0
        // Ta ép giá trị startCharacter theo index anh chọn
        const origBuildGameJoinData = window.buildGameJoinData;
        if (typeof window.buildGameJoinData === 'function') {
            window.buildGameJoinData = function (e = {}) {
                const data = origBuildGameJoinData.apply(this, arguments);
                if (settings.autoStartCharacter && settings.startCharacterIndex !== undefined) {
                    data.startCharacter = settings.startCharacterIndex;
                    data.buyStartCharacter = true; // Ép cờ mua để server chấp nhận
                }
                return data;
            };
        }

        // Ép trực tiếp biến toàn cục startCharacter nếu có
        Object.defineProperty(window, 'startCharacter', {
            get: () => settings.autoStartCharacter ? settings.startCharacterIndex : 0,
            set: (v) => { /* cho phép ghi nhưng không覆盖 */ },
            configurable: true
        });

        // Ép cờ buyStartCharacter luôn true nếu người dùng muốn chọn nhân vật
        Object.defineProperty(window, 'buyStartCharacter', {
            get: () => settings.autoStartCharacter ? true : (window.buyStartCharacter || false),
            set: (v) => {},
            configurable: true
        });

        // =========================================================================
        // 6. BẮT CON TRỎ GAME INSTANCE TRỰC TIẾP TỪ CANVAS HOOK
        // =========================================================================
        let gameInstance = null;
        let lastAutoSkillTime = 0;
        let lastBoostToggleTime = 0;
        let autoBoostActive = false;
        let isHoldingRightClick = false;

        const origClearRect = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
            origClearRect.apply(this, arguments);

            if (!gameInstance && window.game && typeof window.game.setZoom === 'function') {
                gameInstance = window.game;
                window.__EVO_GAME__ = window.game;
                console.log('[EvoWorld-Mod] 🎯 Đã bắt được gameInstance từ window.game!');
            }
        };

        const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (img) {
            if (settings.noDarkness && img && img.tagName === 'CANVAS') {
                if (img.id === 'darknessCanvas' || (window.darknessCanvas && img === window.darknessCanvas)) {
                    return; // Chặn hoàn toàn lớp vẽ bóng tối
                }
            }
            return origDrawImage.apply(this, arguments);
        };

        const engineScanner = setInterval(() => {
            if (window.game && typeof window.game.setZoom === 'function') {
                gameInstance = window.game;
                window.__EVO_GAME__ = window.game;
                hookGameEngine(window.game);
                clearInterval(engineScanner);
            } else if (window.Engine && window.Engine.prototype) {
                hookEnginePrototype(window.Engine);
                clearInterval(engineScanner);
            }
        }, 50);

        function hookGameEngine(gameObj) {
            if (!gameObj || gameObj.__evo_mod_hooked) return;
            gameObj.__evo_mod_hooked = true;
            console.log('[EvoWorld-Mod] 🚀 Đang hook vào Game Engine Instance...');

            const origSetZoom = gameObj.setZoom;
            gameObj.setZoom = function (val) {
                if (settings.freeZoom) {
                    val = Math.max(settings.minZoom, Math.min(settings.maxZoom, val));
                } else {
                    val = Math.max(1, Math.min(2, val));
                }
                return origSetZoom.call(this, val);
            };

            const origDrawObjects = gameObj.drawObjects;
            gameObj.drawObjects = function () {
                this.drawColliders = !!settings.showHitboxes;
                origDrawObjects.apply(this, arguments);

                try {
                    runAutomationLoop(this);
                    renderCustomESP(this);
                } catch (e) {}
            };
        }

        function hookEnginePrototype(EngineClass) {
            if (!EngineClass || !EngineClass.prototype || EngineClass.prototype.__evo_mod_hooked) return;
            EngineClass.prototype.__evo_mod_hooked = true;
            console.log('[EvoWorld-Mod] 🚀 Đang hook vào Engine.prototype...');

            const origSetZoom = EngineClass.prototype.setZoom;
            EngineClass.prototype.setZoom = function (val) {
                gameInstance = this;
                window.__EVO_GAME__ = this;
                if (settings.freeZoom) {
                    val = Math.max(settings.minZoom, Math.min(settings.maxZoom, val));
                } else {
                    val = Math.max(1, Math.min(2, val));
                }
                return origSetZoom.call(this, val);
            };

            const origDrawObjects = EngineClass.prototype.drawObjects;
            EngineClass.prototype.drawObjects = function () {
                gameInstance = this;
                window.__EVO_GAME__ = this;
                this.drawColliders = !!settings.showHitboxes;
                origDrawObjects.apply(this, arguments);

                try {
                    runAutomationLoop(this);
                    renderCustomESP(this);
                } catch (e) {}
            };
        }

        // =========================================================================
        // 7. ZOOM BẰNG LĂN CHUỘT
        // =========================================================================
        window.addEventListener('wheel', function (e) {
            if (!settings.freeZoom || !gameInstance || !window.joinedGame) return;
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            let newZoom = Math.round(((gameInstance.zoom || 1.0) + delta) * 100) / 100;
            newZoom = Math.max(settings.minZoom, Math.min(settings.maxZoom, newZoom));

            if (typeof window.gameZoom !== 'undefined') window.gameZoom = newZoom;
            gameInstance.setZoom(newZoom);
            settings.customZoom = newZoom;
            updateUIValues();
        }, { passive: true });

        // =========================================================================
        // 8. AUTOMATION & PHẢN XẠ NHANH
        // =========================================================================
        function triggerSkill() {
            if (typeof window.skillUse === 'function') {
                window.skillUse();
                return;
            }
            window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 32, which: 32, code: 'Space', bubbles: true }));
            setTimeout(() => {
                window.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 32, which: 32, code: 'Space', bubbles: true }));
            }, 50);
        }

        function triggerBoost(enable) {
            if (typeof window.boost === 'function') {
                window.boost(enable);
            }
        }

        function runAutomationLoop(engine) {
            const me = engine.me;
            if (!me || me.deleted || window.imDead || !window.joinedGame) return;

            const now = Date.now();

            if (settings.autoSkillEmergency && now - lastAutoSkillTime > 2500) {
                let hpRatio = 1.0;
                if (typeof me.health === 'number' && me.maxHealth > 0) {
                    hpRatio = me.health / me.maxHealth;
                } else if (typeof me.hp === 'number' && me.maxHp > 0) {
                    hpRatio = me.hp / me.maxHp;
                }

                if (hpRatio <= (settings.autoSkillHpPercent / 100)) {
                    triggerSkill();
                    lastAutoSkillTime = now;
                }
            }

            if (settings.autoBoostMacro && isHoldingRightClick) {
                if (now - lastBoostToggleTime > 120) {
                    autoBoostActive = !autoBoostActive;
                    triggerBoost(autoBoostActive);
                    lastBoostToggleTime = now;
                }
            }
        }

        window.addEventListener('mousedown', (e) => {
            if (e.button === 2) isHoldingRightClick = true;
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 2) {
                isHoldingRightClick = false;
                triggerBoost(false);
            }
        });

        // =========================================================================
        // 9. RENDER ESP, RADAR & LASER AIM
        // =========================================================================
        function getDist(x1, y1, x2, y2) {
            const dx = x1 - x2, dy = y1 - y2;
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

            let nearestPredator = null, minPredatorDist = 999999;
            let nearestFood = null, minFoodDist = 999999;
            let nearestWater = null, minWaterDist = 999999;

            const allObjects = engine.gameObjects || {};

            ctx.save();

            for (const id in allObjects) {
                const obj = allObjects[id];
                if (!obj || obj.deleted || obj === me || !obj.position) continue;

                const targetPos = obj.getAllPositions ? obj.getAllPositions() : { center: { x: obj.position.x + obj.width / 2, y: obj.position.y + obj.height / 2 } };
                const targetCenter = targetPos.center;
                const dist = getDist(myCenter.x, myCenter.y, targetCenter.x, targetCenter.y);

                if (obj.name === 'water' || obj.name === 'cloud' || (obj.texture && typeof obj.texture.indexOf === 'function' && obj.texture.indexOf('water') !== -1)) {
                    if (dist < minWaterDist) {
                        minWaterDist = dist;
                        nearestWater = { obj, dist, center: targetCenter };
                    }
                }

                let isPredator = false, isFood = false;
                if (typeof window.checkFoodChain === 'function') {
                    const chain = window.checkFoodChain(me, obj);
                    if (chain.check === -1) isPredator = true;
                    else if (chain.check === 1) isFood = true;
                } else {
                    if (obj.outline === 'red') isPredator = true;
                    if (obj.outline === '#00cc44' || obj.outline === 'orange') isFood = true;
                }

                if (isPredator && dist < minPredatorDist) {
                    minPredatorDist = dist;
                    nearestPredator = { obj, dist, center: targetCenter };
                }

                if (isFood && dist < minFoodDist) {
                    minFoodDist = dist;
                    nearestFood = { obj, dist, center: targetCenter };
                }

                if (settings.espPlayers && obj.type === 1) {
                    const renderPos = engine.getRenderPosition(targetCenter.x, targetCenter.y);
                    const strokeColor = isPredator ? '#ff2b2b' : (isFood ? '#00e676' : '#38bdf8');

                    ctx.beginPath();
                    ctx.arc(renderPos.x, renderPos.y, Math.max(obj.width, obj.height) * engine.scaleX * engine.zoom * 0.7, 0, Math.PI * 2);
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = isPredator ? 3 : 1.5;
                    ctx.stroke();

                    ctx.font = `bold ${Math.max(10, Math.round(11 * (engine.zoom || 1)))}px sans-serif`;
                    ctx.fillStyle = strokeColor;
                    ctx.textAlign = 'center';
                    ctx.fillText(`${obj.nick || obj.name || 'Player'} [${Math.round(dist)}]`, renderPos.x, renderPos.y - (obj.height * engine.scaleY * engine.zoom * 0.8));
                }
            }

            // Laser Aim Guide
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

                ctx.beginPath();
                ctx.arc(aimEndX, aimEndY, 6, 0, Math.PI * 2);
                ctx.fillStyle = '#0284c7';
                ctx.fill();
            }

            // Cảnh báo Thiên Địch
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
                    ctx.fillText(`⚠️ THIÊN ĐỊCH: ${pred.obj.nick || pred.obj.name} [${Math.round(pred.dist)}px]!`, engine.canvas.width / 2, 70);
                }
            }

            // Radar Thức Ăn
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

            // Radar Nước
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
        // 10. GIAO DIỆN ĐIỀU KHIỂN NỔI (WHITE-BLUE THEME)
        // =========================================================================
        function injectUI() {
            if (document.getElementById('evo-mod-container')) return;

            const css = `
                #evo-mod-container {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 99999999;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 13px;
                    color: #1e293b;
                    user-select: none;
                }
                #evo-mod-panel {
                    width: 330px;
                    background: #ffffff;
                    border: 1px solid #cbd5e1;
                    border-radius: 14px;
                    box-shadow: 0 12px 30px -5px rgba(0, 0, 0, 0.15);
                    overflow: hidden;
                }
                .evo-header {
                    background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
                    color: #ffffff;
                    padding: 12px 16px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-weight: 600;
                    cursor: move;
                }
                .evo-btn-minimize {
                    background: none;
                    border: none;
                    color: #ffffff;
                    font-size: 16px;
                    cursor: pointer;
                    padding: 2px 6px;
                    border-radius: 4px;
                }
                .evo-content {
                    padding: 14px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    max-height: 85vh;
                    overflow-y: auto;
                }
                .evo-section-title {
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #64748b;
                    border-bottom: 1px solid #f1f5f9;
                    padding-bottom: 4px;
                    margin-top: 6px;
                }
                .evo-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }
                .evo-label {
                    font-weight: 500;
                    color: #334155;
                    flex: 1;
                }
                .evo-switch {
                    position: relative;
                    width: 38px;
                    height: 20px;
                }
                .evo-switch input { opacity: 0; width: 0; height: 0; }
                .evo-slider-toggle {
                    position: absolute; cursor: pointer;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background-color: #cbd5e1;
                    transition: .25s; border-radius: 20px;
                }
                .evo-slider-toggle:before {
                    position: absolute; content: "";
                    height: 14px; width: 14px; left: 3px; bottom: 3px;
                    background-color: white;
                    transition: .25s; border-radius: 50%;
                }
                input:checked + .evo-slider-toggle { background-color: #0284c7; }
                input:checked + .evo-slider-toggle:before { transform: translateX(18px); }
                .evo-select {
                    width: 100%;
                    padding: 6px 8px;
                    border: 1px solid #cbd5e1;
                    border-radius: 6px;
                    background: #f8fafc;
                    color: #1e293b;
                    font-size: 12px;
                }
                .evo-slider-container {
                    display: flex; flex-direction: column; gap: 6px;
                    background: #f8fafc; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0;
                }
                .evo-slider-bar { width: 100%; cursor: pointer; accent-color: #0284c7; }
                .evo-footer {
                    padding: 10px 16px; background: #f1f5f9; border-top: 1px solid #e2e8f0;
                    font-size: 11px; color: #64748b; display: flex; justify-content: space-between;
                }
                .evo-badge { background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
                #evo-toggle-btn {
                    position: fixed; bottom: 20px; right: 20px;
                    background: #0284c7; color: #ffffff;
                    width: 44px; height: 44px; border-radius: 50%;
                    box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
                    border: none; cursor: pointer; font-size: 20px;
                    display: flex; align-items: center; justify-content: center;
                    z-index: 99999998;
                }
            `;

            const styleEl = document.createElement('style');
            styleEl.textContent = css;
            (document.head || document.documentElement).appendChild(styleEl);

            const container = document.createElement('div');
            container.id = 'evo-mod-container';
            container.innerHTML = `
                <div id="evo-mod-panel">
                    <div class="evo-header" id="evo-drag-handle">
                        <span>⚡ EvoWorld Pro Suite</span>
                        <button class="evo-btn-minimize" id="evo-btn-close">✕</button>
                    </div>
                    <div class="evo-content">
                        <div class="evo-section-title">💎 ĐẶC QUYỀN EXP & SINH TỐ</div>
                        <div class="evo-row">
                            <span class="evo-label">🚀 Free +30% EXP (No Ad)</span>
                            <label class="evo-switch">
                                <input type="checkbox" id="evo-chk-exp" ${settings.auto30Exp ? 'checked' : ''}>
                                <span class="evo-slider-toggle"></span>
                            </label>
                        </div>
                        <div class="evo-row">
                            <span class="evo-label">🎲 Chọn Con Vật Xuất Phát</span>
                            <label class="evo-switch">
                                <input type="checkbox" id="evo-chk-startchar" ${settings.autoStartCharacter ? 'checked' : ''}>
                                <span class="evo-slider-toggle"></span>
                            </label>
                        </div>
                        <div class="evo-row">
                            <span class="evo-label">📋 Chỉ Số Con Vật (StartChar Index)</span>
                            <select class="evo-select" id="evo-sel-startchar">${generateCharacterOptions()}</select>
                        </div>

                        <div class="evo-section-title">👻 SKIN CHANGER (MIẄN PHÍ)</div>
                        <div class="evo-row">
                            <span class="evo-label">🎭 Free Skin Changer</span>
                            <label class="evo-switch">
                                <input type="checkbox" id="evo-chk-skin" ${settings.freeSkinChanger ? 'checked' : ''}>
                                <span class="evo-slider-toggle"></span>
                            </label>
                        </div>
                        <div class="evo-row">
                            <span class="evo-label">🦇 Skin Tên (Ví dụ: grimReaper)</span>
                            <input type="text" class="evo-select" id="evo-skin-name" value="${settings.forceSkinName}" style="padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px; width:100%; font-size:11px;">
                        </div>

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
                                <span style="font-size:11px; color:#64748b;">Mức Zoom:</span>
                                <span id="evo-zoom-val" style="font-weight:700; color:#0284c7;">${settings.customZoom.toFixed(2)}x</span>
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
                            <span class="evo-label">📦 Hiện Hitbox Khung Va Chạm</span>
                            <label class="evo-switch">
                                <input type="checkbox" id="evo-chk-hitbox" ${settings.showHitboxes ? 'checked' : ''}>
                                <span class="evo-slider-toggle"></span>
                            </label>
                        </div>

                        <div class="evo-section-title">🎯 RADAR & SĂN MỒI</div>
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
                            <span class="evo-label">🏹 Laser Aim (Tia Ngắm Mỏ)</span>
                            <label class="evo-switch">
                                <input type="checkbox" id="evo-chk-laser" ${settings.laserAim ? 'checked' : ''}>
                                <span class="evo-slider-toggle"></span>
                            </label>
                        </div>
                        <div class="evo-row">
                            <span class="evo-label">👥 ESP Người Chơi & Tên</span>
                            <label class="evo-switch">
                                <input type="checkbox" id="evo-chk-esp" ${settings.espPlayers ? 'checked' : ''}>
                                <span class="evo-slider-toggle"></span>
                            </label>
                        </div>

                        <div class="evo-section-title">🤖 SINH TỒN & TỰ ĐỘNG</div>
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
                            <span class="evo-label">💧 Dẫn Đường Tìm Nước</span>
                            <label class="evo-switch">
                                <input type="checkbox" id="evo-chk-water" ${settings.emergencyWaterAlert ? 'checked' : ''}>
                                <span class="evo-slider-toggle"></span>
                            </label>
                        </div>
                    </div>
                    <div class="evo-footer">
                        <span>Phím tắt: <b>H</b> bật/tắt</span>
                        <span class="evo-badge">v2.2.0</span>
                    </div>
                </div>
            `;
            (document.body || document.documentElement).appendChild(container);

            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'evo-toggle-btn';
            toggleBtn.innerHTML = '⚡';
            toggleBtn.title = 'Bật/Tắt Menu (Phím H)';
            (document.body || document.documentElement).appendChild(toggleBtn);

            setupUIEvents();
        }

        function generateCharacterOptions() {
            const chars = [
                {label: '0 - Ruồi (Mặc định)', value: '0'},
                {label: '1 - Bướm', value: '1'},
                {label: '2 - Muỗi', value: '2'},
                {label: '3 - Bọ Singsing', value: '3'},
                {label: '4 - Côn Trùng Rồng', value: '4'},
                {label: '5 - Chuông Chuông', value: '5'},
                {label: '6 - Vịt', value: '6'},
                {label: '7 - Chim Xanh', value: '7'},
                {label: '8 - Gà', value: '8'},
                {label: '9 - Tước Xanh', value: '9'},
                {label: '10 - Cú', value: '10'},
                {label: '11 - Chim Chì Đỏ', value: '11'},
                {label: '12 - Bồ Câu', value: '12'},
                {label: '13 - Gà Móng Bân', value: '13'},
                {label: '14 - Thổ Cẩm', value: '14'},
                {label: '15 - Diều Cá', value: '15'},
                {label: '16 - Chim Hoanh', value: '16'},
                {label: '17 - Bụi Chim', value: '17'},
                {label: '18 - Cú Tuyết', value: '18'},
                {label: '19 - Sẻ Mào', value: '19'},
                {label: '20 - Đại Bàng', value: '20'},
                {label: '21 - Chim Vạc', value: '21'},
                {label: '22 - Ồm Chim', value: '22'},
                {label: '23 - Chim Sa Sét', value: '23'},
                {label: '24 - Chim Trầm', value: '24'},
                {label: '25 - Cú Vàng', value: '25'},
                {label: '26 - Cú Tây Bắc', value: '26'},
                {label: '27 - Chim Chim', value: '27'},
                {label: '28 - Chim Xe', value: '28'},
                {label: '29 - Chim Cao Cổ', value: '29'}
            ];
            return chars.map(c => `<option value="${c.value}" ${settings.startCharacterIndex == c.value ? 'selected' : ''}>${c.label}</option>`).join('');
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
                if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
                if (e.key === 'h' || e.key === 'H') {
                    setMenuVisible(panel.style.display === 'none');
                }
            });

            const bindChk = (id, key) => {
                const el = document.getElementById(id);
                if (el) el.onchange = (e) => {
                    settings[key] = e.target.checked;
                    saveSettings();
                    if (key === 'auto30Exp') activateExpBonus();
                };
            };

            bindChk('evo-chk-exp', 'auto30Exp');
            bindChk('evo-chk-startchar', 'autoStartCharacter');
            bindChk('evo-chk-skin', 'freeSkinChanger');
            bindChk('evo-chk-zoom', 'freeZoom');
            bindChk('evo-chk-darkness', 'noDarkness');
            bindChk('evo-chk-hitbox', 'showHitboxes');
            bindChk('evo-chk-predator', 'predatorAlert');
            bindChk('evo-chk-food', 'foodRadar');
            bindChk('evo-chk-laser', 'laserAim');
            bindChk('evo-chk-esp', 'espPlayers');
            bindChk('evo-chk-autoskill', 'autoSkillEmergency');
            bindChk('evo-chk-autoboost', 'autoBoostMacro');
            bindChk('evo-chk-water', 'emergencyWaterAlert');

            const selStartChar = document.getElementById('evo-sel-startchar');
            if (selStartChar) {
                selStartChar.onchange = (e) => {
                    settings.startCharacterIndex = e.target.value;
                    saveSettings();
                };
            }

            const skinNameInput = document.getElementById('evo-skin-name');
            if (skinNameInput) {
                skinNameInput.onchange = (e) => {
                    settings.forceSkinName = e.target.value.trim();
                    saveSettings();
                };
                skinNameInput.oninput = (e) => {
                    settings.forceSkinName = e.target.value.trim();
                    saveSettings();
                };
            }

            const rangeZoom = document.getElementById('evo-range-zoom');
            if (rangeZoom) {
                rangeZoom.oninput = (e) => {
                    const val = parseFloat(e.target.value);
                    settings.customZoom = val;
                    if (gameInstance) gameInstance.setZoom(val);
                    if (typeof window.gameZoom !== 'undefined') window.gameZoom = val;
                    updateUIValues();
                    saveSettings();
                };
            }

            dragElement(document.getElementById('evo-mod-container'), document.getElementById('evo-drag-handle'));
        }

        function updateUIValues() {
            const lblZoom = document.getElementById('evo-zoom-val');
            const rangeZoom = document.getElementById('evo-range-zoom');
            if (lblZoom && settings.customZoom) lblZoom.innerText = `${settings.customZoom.toFixed(2)}x`;
            if (rangeZoom && settings.customZoom) rangeZoom.value = settings.customZoom;
        }

        function dragElement(elmnt, handle) {
            let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
            if (handle) handle.onmousedown = dragMouseDown;
            else elmnt.onmousedown = dragMouseDown;

            function dragMouseDown(e) {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
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
    };

    // Nhúng trực tiếp vào trang chính để vượt qua mọi rào cản sandbox của Tampermonkey
    const scriptEl = document.createElement('script');
    scriptEl.textContent = `(${pageScript.toString()})();`;
    (document.head || document.documentElement).appendChild(scriptEl);
    scriptEl.remove();

})();
