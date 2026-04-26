'use strict';

// ── Card rendering ─────────────────────────────────────────────────────────

const RANK_DISPLAY_UI = { 14:'A', 13:'K', 12:'Q', 11:'J', 10:'T' };
const SUIT_SYMBOL_UI  = { hearts:'♥', diamonds:'♦', clubs:'♣', spades:'♠' };
const RED_SUITS       = new Set(['hearts', 'diamonds']);

function rankName(r)   { return RANK_DISPLAY_UI[r] || String(r); }
function suitSymbol(s) { return SUIT_SYMBOL_UI[s] || s; }

function makeCardEl(card, small, faceDown) {
  const el = document.createElement('div');
  el.className = 'card deal-anim' + (small ? ' small' : '') + (faceDown ? ' face-down' : '');

  if (!faceDown && card) {
    const isRed = RED_SUITS.has(card.suit);
    el.classList.add(isRed ? 'red' : 'black');
    const rn = rankName(card.rank);
    const ss = suitSymbol(card.suit);
    el.innerHTML = `
      <div class="card-top">${rn}<br><span style="font-size:.85em">${ss}</span></div>
      <div class="card-center">${ss}</div>
      <div class="card-bottom">${rn}<br><span style="font-size:.85em">${ss}</span></div>`;
  }
  return el;
}

// ── Player seat positions (relative to #table 660×340) ────────────────────
// Positions are [left%, top%] from top-left of the table div.
// 8 slots: index 0 = human (bottom-center, shown in #human-area instead),
// indices 1-7 = AI seats around the oval.
const SEAT_POSITIONS = [
  [50,  112], // 0: bottom-center (human — not rendered inside table)
  [82,   96], // 1: bottom-right
  [95,   54], // 2: right
  [82,   12], // 3: top-right
  [50,   -4], // 4: top-center
  [18,   12], // 5: top-left
  [ 5,   54], // 6: left
  [18,   96], // 7: bottom-left
];

// ── Build static seat elements once ───────────────────────────────────────

function buildSeats(tableEl, playerCount) {
  // Remove existing seats
  tableEl.querySelectorAll('.player-seat').forEach(el => el.remove());

  // Slots 1 … playerCount-1 are for AI players
  for (let slot = 1; slot < playerCount && slot < SEAT_POSITIONS.length; slot++) {
    const [leftPct, topPct] = SEAT_POSITIONS[slot];
    const seat = document.createElement('div');
    seat.className = 'player-seat';
    seat.id = `seat-${slot}`;
    seat.style.left = `${leftPct}%`;
    seat.style.top  = `${(topPct / 340) * 100}%`;
    tableEl.appendChild(seat);
  }
}

// ── Update a single seat ────────────────────────────────────────────────────

function updateSeat(seatEl, player, state, isCurrentPlayer) {
  if (!seatEl) return;
  seatEl.innerHTML = '';
  seatEl.className = `player-seat status-${player.status}`;

  // Cards (face-down for AI, hidden if folded/out)
  const cardsWrap = document.createElement('div');
  cardsWrap.className = 'seat-cards';
  if (player.status !== 'out' && player.status !== 'folded') {
    if (state.phase === 'showdown' && player.holeCards.length === 2) {
      for (const c of player.holeCards) cardsWrap.appendChild(makeCardEl(c, true, false));
    } else if (player.holeCards.length > 0) {
      cardsWrap.appendChild(makeCardEl(null, true, true));
      cardsWrap.appendChild(makeCardEl(null, true, true));
    }
  }

  // Info box
  const box = document.createElement('div');
  box.className = 'player-box' + (isCurrentPlayer ? ' is-current' : '');

  // Dealer/blind markers
  if (state.dealerIndex === state.players.indexOf(player)) {
    const m = document.createElement('div'); m.className='marker dealer'; m.textContent='D';
    box.appendChild(m);
  } else if (state.smallBlindIndex === state.players.indexOf(player)) {
    const m = document.createElement('div'); m.className='marker sb'; m.textContent='SB';
    box.appendChild(m);
  } else if (state.bigBlindIndex === state.players.indexOf(player)) {
    const m = document.createElement('div'); m.className='marker bb'; m.textContent='BB';
    box.appendChild(m);
  }

  const nameEl   = document.createElement('div'); nameEl.className='player-name';   nameEl.textContent=player.name;
  const chipsEl  = document.createElement('div'); chipsEl.className='player-chips';  chipsEl.textContent=`💰 ${player.chips}`;
  const betEl    = document.createElement('div'); betEl.className='player-bet';
  if (player.roundBet > 0) betEl.textContent=`下注: ${player.roundBet}`;

  const statusEl = document.createElement('div'); statusEl.className='player-status-label';
  if (player.status==='folded')  statusEl.textContent='弃牌';
  if (player.status==='all-in')  statusEl.textContent='全押';
  if (player.status==='out')     statusEl.textContent='出局';

  box.append(nameEl, chipsEl, betEl, statusEl);

  if (cardsWrap.children.length > 0) seatEl.appendChild(cardsWrap);
  seatEl.appendChild(box);
}

// ── Update community cards ──────────────────────────────────────────────────

function updateCommunityCards(containerEl, cards) {
  containerEl.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    if (i < cards.length) {
      containerEl.appendChild(makeCardEl(cards[i], false, false));
    } else {
      // Placeholder
      const ph = document.createElement('div');
      ph.className = 'card';
      ph.style.cssText = 'background:rgba(0,0,0,.2);border-color:rgba(255,255,255,.1);';
      containerEl.appendChild(ph);
    }
  }
}

// ── Update human's own cards ────────────────────────────────────────────────

function updateHumanCards(containerEl, player, state) {
  containerEl.innerHTML = '';
  if (player.holeCards && player.holeCards.length > 0) {
    for (const c of player.holeCards) {
      const faceDown = (player.status === 'folded' && state.phase !== 'showdown');
      containerEl.appendChild(makeCardEl(c, false, faceDown));
    }
  }
}

// ── Showdown overlay ────────────────────────────────────────────────────────

function renderShowdown(overlayEl, resultsEl, showdownData, communityCards) {
  resultsEl.innerHTML = '<h3>🃏 摊牌结果</h3>';
  if (!showdownData) return;
  for (const entry of showdownData) {
    const row = document.createElement('div');
    row.className = 'showdown-row';

    const nameEl = document.createElement('div'); nameEl.className='showdown-name'; nameEl.textContent=entry.player.name;

    const cardsEl = document.createElement('div'); cardsEl.className='showdown-cards';
    if (entry.player.holeCards) {
      for (const c of entry.player.holeCards) cardsEl.appendChild(makeCardEl(c, true, false));
    }

    const handEl = document.createElement('div');
    handEl.className = 'showdown-hand';
    handEl.textContent = entry.hand ? handEvaluator.handName(entry.hand.rank) : '—';

    const winEl = document.createElement('div'); winEl.className='showdown-win';
    winEl.textContent = entry.win > 0 ? `+${entry.win}` : '';

    row.append(nameEl, cardsEl, handEl, winEl);
    resultsEl.appendChild(row);
  }
  overlayEl.classList.add('active');
}

// ── History log ─────────────────────────────────────────────────────────────

function appendHistory(logEl, entries, lastRenderedCount) {
  const toAdd = entries.slice(lastRenderedCount);
  for (const text of toAdd) {
    const div = document.createElement('div');
    div.className = 'history-entry' +
      (text.startsWith('---') ? ' phase-sep' : '') +
      (text.includes('赢得') ? ' win-entry' : '');
    div.textContent = text;
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;
  return entries.length;
}

// ── Action buttons ──────────────────────────────────────────────────────────

function renderActionButtons(areaEl, raiseEl, validActions, onAction, currentBet, chips) {
  areaEl.innerHTML = '';
  raiseEl.style.display = 'none';

  if (!validActions || validActions.length === 0) return;

  for (const va of validActions) {
    const btn = document.createElement('button');
    btn.className = 'btn';

    if (va.action === 'fold') {
      btn.textContent = '弃牌';
      btn.classList.add('danger');
      btn.onclick = () => onAction('fold');
    } else if (va.action === 'check') {
      btn.textContent = '过牌';
      btn.classList.add('success');
      btn.onclick = () => onAction('check');
    } else if (va.action === 'call') {
      btn.textContent = `跟注 ${va.amount}`;
      btn.classList.add('success');
      btn.onclick = () => onAction('call', va.amount);
    } else if (va.action === 'all-in') {
      btn.textContent = `全押 ${va.amount}`;
      btn.classList.add('gold');
      btn.onclick = () => onAction('all-in', va.amount);
    } else if (va.action === 'raise') {
      btn.textContent = '加注';
      btn.onclick = () => {
        raiseEl.style.display = 'flex';
        const inp = document.getElementById('raise-amount-input');
        if (inp) {
          inp.min   = va.minAmount;
          inp.max   = va.maxAmount;
          inp.value = va.minAmount;
        }
        const slider = document.getElementById('raise-slider');
        if (slider) {
          slider.min   = va.minAmount;
          slider.max   = va.maxAmount;
          slider.value = va.minAmount;
        }
      };

      const confirmBtn = document.getElementById('raise-confirm-btn');
      if (confirmBtn) {
        confirmBtn.onclick = () => {
          const inp = document.getElementById('raise-amount-input');
          const val = parseInt(inp ? inp.value : va.minAmount);
          const clamped = Math.max(va.minAmount, Math.min(va.maxAmount, val || va.minAmount));
          onAction('raise', clamped);
          raiseEl.style.display = 'none';
        };
      }
    }
    areaEl.appendChild(btn);
  }
}
