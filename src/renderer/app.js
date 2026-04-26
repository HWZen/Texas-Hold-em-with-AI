'use strict';

// ── Constants ─────────────────────────────────────────────────────────────
const AI_DELAY_MIN   = 350;
const AI_DELAY_RANGE = 500;

// ── State ──────────────────────────────────────────────────────────────────
let engine        = null;
let appSettings   = null;
let histRendered  = 0;
let isProcessing  = false;

// ── Init ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  appSettings = await window.api.getSettings();
  buildSettingsUI();
  showScreen('start');
});

// ── Screen management ───────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`${name}-screen`);
  if (el) el.classList.add('active');
}

// ── New game ────────────────────────────────────────────────────────────────
function startNewGame() {
  engine       = new GameEngine(appSettings);
  histRendered = 0;
  document.getElementById('history-log').innerHTML = '';

  buildSeats(document.getElementById('table'), appSettings.playerCount);
  showScreen('game');

  engine.startNewHand();
  fullRedraw();
  scheduleNext();
}

// ── Load game ───────────────────────────────────────────────────────────────
async function loadGame() {
  const saved = await window.api.loadGame();
  if (!saved) { alert('没有找到存档！'); return; }

  engine       = new GameEngine(appSettings);
  histRendered = 0;
  engine.deserializeState(saved);
  appSettings  = engine.settings;
  document.getElementById('history-log').innerHTML = '';

  buildSeats(document.getElementById('table'), engine.state.players.length);
  showScreen('game');
  fullRedraw();
  scheduleNext();
}

// ── Save game ───────────────────────────────────────────────────────────────
async function saveGame() {
  if (!engine) return;
  await window.api.saveGame(engine.serializeState());
  alert('游戏已保存！');
}

// ── Full UI redraw ─────────────────────────────────────────────────────────
function fullRedraw() {
  if (!engine) return;
  const st = engine.state;

  // Top bar
  document.getElementById('info-round').textContent  = st.roundNumber;
  document.getElementById('info-phase').textContent  = phaseLabel(st.phase);
  document.getElementById('info-pot').textContent    = st.pot;

  // Phase badge & pot on table
  document.getElementById('phase-badge').textContent = phaseLabel(st.phase);
  document.getElementById('pot-display').textContent = `底池: ${st.pot}`;

  // Community cards
  updateCommunityCards(
    document.getElementById('community-cards'),
    st.communityCards
  );

  // AI seats
  const aiPlayers = st.players.filter(p => !p.isHuman);
  for (let slot = 1; slot < st.players.length && slot < 8; slot++) {
    const seatEl = document.getElementById(`seat-${slot}`);
    const player = st.players[slot]; // players[0]=human, rest are AI
    if (!player || !seatEl) continue;
    const isCurrent = (st.currentPlayerIndex === slot) &&
      !['showdown','game_over','waiting'].includes(st.phase);
    updateSeat(seatEl, player, st, isCurrent);
  }

  // Human player
  const human = st.players.find(p => p.isHuman);
  if (human) {
    updateHumanCards(document.getElementById('human-cards'), human, st);
    document.getElementById('human-name').textContent  = human.name;
    document.getElementById('human-chips').textContent = `💰 ${human.chips}`;
    document.getElementById('human-bet').textContent   = human.roundBet > 0 ? `本轮下注: ${human.roundBet}` : '';

    // Dealer/blind badges for human
    const hi = st.players.indexOf(human);
    document.getElementById('human-dealer-badge').textContent =
      hi === st.dealerIndex     ? 'D'  :
      hi === st.smallBlindIndex ? 'SB' :
      hi === st.bigBlindIndex   ? 'BB' : '';
  }

  // History
  histRendered = appendHistory(
    document.getElementById('history-log'),
    st.handHistory,
    histRendered
  );

  // Action buttons
  const isHumanTurn = human &&
    human.status === 'active' &&
    st.currentPlayerIndex === st.players.indexOf(human) &&
    !['showdown','game_over','waiting'].includes(st.phase) &&
    !isProcessing;

  const actArea   = document.getElementById('action-btns');
  const raiseCtrl = document.getElementById('raise-controls');
  const thinkEl   = document.getElementById('ai-thinking');

  if (isHumanTurn) {
    thinkEl.style.display = 'none';
    renderActionButtons(
      actArea,
      raiseCtrl,
      engine.getValidActions(human.id),
      humanAction,
      st.currentBet,
      human.chips
    );
  } else {
    actArea.innerHTML = '';
    raiseCtrl.style.display = 'none';
    if (['showdown','game_over','waiting'].includes(st.phase)) {
      thinkEl.style.display = 'none';
    } else if (!human || human.status === 'folded' || human.status === 'out') {
      thinkEl.textContent   = '观战中…';
      thinkEl.style.display = 'inline';
    } else {
      thinkEl.textContent   = 'AI 思考中…';
      thinkEl.style.display = 'inline';
    }
  }

  // Game over
  const goOverlay = document.getElementById('game-over-overlay');
  if (st.phase === 'game_over') {
    const winner = st.players.find(p => p.chips > 0);
    document.getElementById('game-over-msg').textContent =
      winner ? `${winner.name} 赢得了比赛！` : '游戏结束';
    goOverlay.classList.add('active');
  } else {
    goOverlay.classList.remove('active');
  }

  // Showdown overlay
  if (st.phase === 'showdown' && st.showdownData) {
    renderShowdown(
      document.getElementById('showdown-overlay'),
      document.getElementById('showdown-results'),
      st.showdownData,
      st.communityCards
    );
  } else {
    document.getElementById('showdown-overlay').classList.remove('active');
  }
}

// ── Human action handler ────────────────────────────────────────────────────
function humanAction(action, amount) {
  if (!engine || isProcessing) return;
  const human = engine.state.players.find(p => p.isHuman);
  if (!human) return;
  document.getElementById('raise-controls').style.display = 'none';
  engine.processAction(human.id, action, amount);
  fullRedraw();
  scheduleNext();
}

// ── AI turn scheduler ───────────────────────────────────────────────────────
function scheduleNext() {
  if (!engine) return;
  const st = engine.state;

  if (st.phase === 'game_over') { fullRedraw(); return; }

  if (st.phase === 'showdown') {
    // Hide showdown after 3 s and start next hand
    setTimeout(() => {
      if (!engine) return;
      document.getElementById('showdown-overlay').classList.remove('active');
      histRendered = 0;
      document.getElementById('history-log').innerHTML = '';
      engine.startNewHand();
      fullRedraw();
      scheduleNext();
    }, 3200);
    return;
  }

  if (st.phase === 'waiting') return;

  // Auto-advance when all players are all-in
  if (engine.shouldAutoAdvance()) {
    setTimeout(() => {
      engine.advancePhase();
      fullRedraw();
      scheduleNext();
    }, 900);
    return;
  }

  const cur = engine.getCurrentPlayer();
  if (!cur) return;

  if (cur.isHuman) {
    // Human's turn — render buttons and wait
    fullRedraw();
    return;
  }

  // AI turn
  isProcessing = true;
  fullRedraw();
  const delay = AI_DELAY_MIN + Math.random() * AI_DELAY_RANGE;
  setTimeout(() => performAITurn(cur), delay);
}

// ── AI action logic ─────────────────────────────────────────────────────────
async function performAITurn(player) {
  if (!engine) { isProcessing = false; return; }
  const st        = engine.state;
  const validActs = engine.getValidActions(player.id);
  const actNames  = validActs.map(a => a.action);

  let decision;

  if (player.aiMode === 'cloud' && player.aiConfig) {
    try {
      const gameStateForAI = {
        player,
        communityCards: st.communityCards,
        pot:            st.pot,
        currentBet:     st.currentBet,
        roundBet:       player.roundBet,
        handHistory:    st.handHistory,
        bigBlind:       appSettings.bigBlind,
        phase:          st.phase
      };
      decision = await getCloudAIDecision(player.aiConfig, gameStateForAI, actNames);
    } catch (e) {
      console.error('Cloud AI error:', e);
      decision = actNames.includes('check') ? { action: 'check' } : { action: 'fold' };
    }
  } else {
    decision = decide({
      holeCards:      player.holeCards,
      communityCards: st.communityCards,
      currentBet:     st.currentBet,
      roundBet:       player.roundBet,
      maxBet:         player.chips + player.roundBet,
      pot:            st.pot,
      numActive:      st.players.filter(p => p.status === 'active').length,
      lastRaise:      st.lastRaise,
      bigBlind:       appSettings.bigBlind,
      aiType:         player.aiType || 'balanced',
      chips:          player.chips
    });
  }

  // Validate decision against available actions
  decision = normalizeDecision(decision, validActs, actNames);

  engine.processAction(player.id, decision.action, decision.amount);
  isProcessing = false;
  fullRedraw();
  setTimeout(() => scheduleNext(), 80);
}

function normalizeDecision(decision, validActs, actNames) {
  if (!actNames.includes(decision.action)) {
    return actNames.includes('check') ? { action: 'check' } : { action: 'fold' };
  }
  if (decision.action === 'raise') {
    const ra = validActs.find(a => a.action === 'raise');
    if (!ra) {
      return actNames.includes('call')
        ? { action: 'call', amount: validActs.find(a => a.action === 'call').amount }
        : (actNames.includes('check') ? { action: 'check' } : { action: 'fold' });
    }
    const amt = Math.max(ra.minAmount, Math.min(decision.amount || ra.minAmount, ra.maxAmount));
    return { action: 'raise', amount: amt };
  }
  if (decision.action === 'call') {
    const ca = validActs.find(a => a.action === 'call');
    return { action: 'call', amount: ca ? ca.amount : decision.amount };
  }
  return decision;
}

// ── Phase label ──────────────────────────────────────────────────────────────
function phaseLabel(phase) {
  return { waiting:'等待', preflop:'翻牌前', flop:'翻牌', turn:'转牌',
           river:'河牌', showdown:'摊牌', game_over:'游戏结束' }[phase] || phase;
}

// ── Settings UI ──────────────────────────────────────────────────────────────
function buildSettingsUI() {
  const s = appSettings;

  // Basic fields
  document.getElementById('setting-player-count').value  = s.playerCount;
  document.getElementById('setting-initial-chips').value = s.initialChips;
  document.getElementById('setting-small-blind').value   = s.smallBlind;
  document.getElementById('setting-big-blind').value     = s.bigBlind;

  // AI player rows
  const container = document.getElementById('ai-players-container');
  container.innerHTML = '';

  const AI_NAMES = ['Alice','Bob','Charlie','Diana','Eve','Frank','Grace'];
  for (let i = 0; i < 7; i++) {
    const ps  = s.players[i] || { name: AI_NAMES[i], aiMode: 'local', aiType: 'balanced', aiConfig: null };
    const row = document.createElement('div');
    row.className = 'ai-player-row';
    row.id = `ai-row-${i}`;

    const cfg = ps.aiConfig || {};
    row.innerHTML = `
      <div class="row-top">
        <span style="min-width:22px;color:#aaa;font-size:12px">${i+1}.</span>
        <input class="settings-input" style="width:80px" id="ai-name-${i}" value="${ps.name||AI_NAMES[i]}" placeholder="名称">
        <select class="settings-select" id="ai-mode-${i}">
          <option value="local"  ${ps.aiMode==='local'  ?'selected':''}>本地AI</option>
          <option value="cloud"  ${ps.aiMode==='cloud'  ?'selected':''}>云端AI</option>
        </select>
        <select class="settings-select" id="ai-type-${i}">
          <option value="balanced"     ${ps.aiType==='balanced'    ?'selected':''}>均衡</option>
          <option value="aggressive"   ${ps.aiType==='aggressive'  ?'selected':''}>激进</option>
          <option value="conservative" ${ps.aiType==='conservative'?'selected':''}>保守</option>
        </select>
      </div>
      <div class="cloud-config ${ps.aiMode==='cloud'?'visible':''}" id="cloud-cfg-${i}">
        <div class="config-row">
          <label>API URL</label>
          <input type="text" id="ai-url-${i}"    value="${cfg.url   ||''}" placeholder="https://api.openai.com/v1/chat/completions">
        </div>
        <div class="config-row">
          <label>API Key</label>
          <input type="password" id="ai-key-${i}" value="${cfg.apiKey||''}" placeholder="sk-...">
        </div>
        <div class="config-row">
          <label>模型</label>
          <input type="text" id="ai-model-${i}" value="${cfg.model ||''}" placeholder="gpt-4o">
          <button class="btn sm" onclick="validateAIConfig(${i})">测试</button>
          <span class="validate-result" id="val-result-${i}"></span>
        </div>
      </div>`;

    container.appendChild(row);

    // Toggle cloud config visibility
    document.getElementById(`ai-mode-${i}`).addEventListener('change', function() {
      const cc = document.getElementById(`cloud-cfg-${i}`);
      if (this.value === 'cloud') cc.classList.add('visible');
      else cc.classList.remove('visible');
    });
  }
}

async function validateAIConfig(i) {
  const url    = document.getElementById(`ai-url-${i}`).value.trim();
  const apiKey = document.getElementById(`ai-key-${i}`).value.trim();
  const model  = document.getElementById(`ai-model-${i}`).value.trim();
  const resEl  = document.getElementById(`val-result-${i}`);
  resEl.textContent = '测试中…'; resEl.className = 'validate-result';
  const res = await window.api.validateAI({ url, apiKey, model });
  resEl.textContent = res.success ? '✓ 成功' : `✗ ${res.message}`;
  resEl.className   = 'validate-result ' + (res.success ? 'ok' : 'err');
}

function saveSettings() {
  const pc = parseInt(document.getElementById('setting-player-count').value) || 5;
  appSettings.playerCount  = Math.max(2, Math.min(8, pc));
  appSettings.initialChips = parseInt(document.getElementById('setting-initial-chips').value) || 10000;
  appSettings.smallBlind   = parseInt(document.getElementById('setting-small-blind').value) || 10;
  appSettings.bigBlind     = parseInt(document.getElementById('setting-big-blind').value) || 20;

  const players = [];
  for (let i = 0; i < 7; i++) {
    const aiMode  = document.getElementById(`ai-mode-${i}`)?.value  || 'local';
    const aiType  = document.getElementById(`ai-type-${i}`)?.value  || 'balanced';
    const name    = document.getElementById(`ai-name-${i}`)?.value  || `AI${i+1}`;
    const url     = document.getElementById(`ai-url-${i}`)?.value   || '';
    const apiKey  = document.getElementById(`ai-key-${i}`)?.value   || '';
    const model   = document.getElementById(`ai-model-${i}`)?.value || '';
    players.push({
      id: `ai_${i}`, name, aiMode, aiType,
      aiConfig: aiMode === 'cloud' ? { url, apiKey, model } : null
    });
  }
  appSettings.players = players;

  window.api.saveSettings(appSettings).then(() => {
    document.getElementById('settings-modal').classList.remove('active');
  });
}

function openSettings()  { buildSettingsUI(); document.getElementById('settings-modal').classList.add('active'); }
function closeSettings() { document.getElementById('settings-modal').classList.remove('active'); }
