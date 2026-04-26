'use strict';

// Full Texas Hold'em game engine (state-machine)
// When loaded as a Node module, pull in dependencies; in browser they are globals.
/* eslint-disable no-var */
if (typeof module !== 'undefined') {
  const _card = require('./card.js');
  const _he   = require('./hand-evaluator.js');
  // In Node.js each file is module-scoped, so globals from other files are not
  // available.  Assign to global so Card / Deck / handEvaluator are accessible
  // throughout this module.  In browser these are already script-tag globals.
  global.Card          = _card.Card;
  global.Deck          = _card.Deck;
  global.handEvaluator = _he.handEvaluator;
}

class GameEngine {
  constructor(settings) {
    this.settings = settings;
    this.state = null;
    this._buildInitialState();
  }

  // ── Build / reset state ───────────────────────────────────────────────────

  _buildInitialState() {
    const { playerCount, initialChips, players: ps } = this.settings;
    const AI_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace'];

    const players = [];
    players.push({
      id: 'human', name: '你', chips: initialChips,
      holeCards: [], roundBet: 0, totalBet: 0,
      status: 'active', isHuman: true,
      aiType: null, aiMode: 'local', aiConfig: null, acted: false
    });

    for (let i = 0; i < Math.min(playerCount - 1, 7); i++) {
      const cfg = (ps && ps[i]) || {};
      players.push({
        id: `ai_${i}`,
        name:     cfg.name    || AI_NAMES[i],
        chips:    initialChips,
        holeCards: [],
        roundBet: 0, totalBet: 0,
        status: 'active', isHuman: false,
        aiType:   cfg.aiType  || 'balanced',
        aiMode:   cfg.aiMode  || 'local',
        aiConfig: cfg.aiConfig || null,
        acted: false
      });
    }

    this.state = {
      phase: 'waiting',
      players,
      deck: null,
      communityCards: [],
      pot: 0,
      sidePots: [],
      currentBet: 0,
      currentPlayerIndex: 0,
      dealerIndex: 0,
      smallBlindIndex: 1,
      bigBlindIndex: 2,
      handHistory: [],
      gameHistory: [],
      lastRaise: this.settings.bigBlind,
      roundNumber: 0,
      actionCount: 0,
      lastAggressorIndex: -1,
      showdownData: null
    };
  }

  // ── Start a new hand ─────────────────────────────────────────────────────

  startNewHand() {
    const st = this.state;
    st.showdownData = null;

    // Eliminate broke players
    for (const p of st.players) {
      if (p.chips <= 0 && p.status !== 'out') p.status = 'out';
    }

    const alive = st.players.filter(p => p.status !== 'out');
    if (alive.length < 2) {
      st.phase = 'game_over';
      return;
    }

    st.roundNumber++;
    st.handHistory   = [];
    st.communityCards = [];
    st.pot           = 0;
    st.sidePots      = [];
    st.currentBet    = 0;
    st.lastRaise     = this.settings.bigBlind;
    st.actionCount   = 0;

    // Reset player state (always clear bets to prevent stale data in side-pot calc)
    for (const p of st.players) {
      p.holeCards = [];
      p.roundBet  = 0;
      p.totalBet  = 0;
      p.acted     = false;
      if (p.status !== 'out') {
        p.status = 'active';
      }
    }

    // Build deck
    st.deck = new Deck();
    st.deck.shuffle();

    // Advance dealer
    const aliveIdx = st.players.map((p, i) => ({ p, i })).filter(x => x.p.status !== 'out').map(x => x.i);
    const prevDealerPos = aliveIdx.indexOf(st.dealerIndex);
    // If current dealer was eliminated, indexOf returns -1; treat as position 0 so next dealer is aliveIdx[1] or [0]
    const newDealerPos  = (Math.max(0, prevDealerPos) + 1) % aliveIdx.length;
    st.dealerIndex = aliveIdx[newDealerPos];

    // Compute blind positions
    const n = aliveIdx.length;
    if (n === 2) {
      st.smallBlindIndex = aliveIdx[newDealerPos];
      st.bigBlindIndex   = aliveIdx[(newDealerPos + 1) % n];
    } else {
      st.smallBlindIndex = aliveIdx[(newDealerPos + 1) % n];
      st.bigBlindIndex   = aliveIdx[(newDealerPos + 2) % n];
    }

    // Deal two hole cards to each active player (clockwise from dealer+1)
    const dealOrder = this._clockwiseFrom(st.dealerIndex, 'active');
    for (let r = 0; r < 2; r++) {
      for (const idx of dealOrder) {
        st.players[idx].holeCards.push(st.deck.deal());
      }
    }

    // Post blinds
    const sbP = st.players[st.smallBlindIndex];
    const bbP = st.players[st.bigBlindIndex];
    const sbAmt = Math.min(sbP.chips, this.settings.smallBlind);
    const bbAmt = Math.min(bbP.chips, this.settings.bigBlind);

    this._deductChips(sbP, sbAmt);
    this._deductChips(bbP, bbAmt);
    st.pot      += sbAmt + bbAmt;
    st.currentBet = bbAmt;

    // Blind players have not freely acted yet (SB acted=true since they can't re-open; BB gets option)
    sbP.acted = true;
    bbP.acted = false; // BB gets option

    st.handHistory.push(`${sbP.name} 小盲注 ${sbAmt}`);
    st.handHistory.push(`${bbP.name} 大盲注 ${bbAmt}`);

    // First to act preflop: player after BB
    const bbPos = aliveIdx.indexOf(st.bigBlindIndex);
    st.currentPlayerIndex = aliveIdx[(bbPos + 1) % n];
    st.lastAggressorIndex = st.bigBlindIndex;
    st.phase = 'preflop';
  }

  // ── Process a player action ───────────────────────────────────────────────

  processAction(playerId, action, amount) {
    const st = this.state;
    const pi = st.players.findIndex(p => p.id === playerId);
    if (pi === -1) return;
    const player = st.players[pi];

    switch (action) {
      case 'fold':
        player.status = 'folded';
        player.acted  = true;
        st.handHistory.push(`${player.name} 弃牌`);
        break;

      case 'check':
        player.acted = true;
        st.handHistory.push(`${player.name} 过牌`);
        break;

      case 'call': {
        const toCall  = Math.min(st.currentBet - player.roundBet, player.chips);
        this._deductChips(player, toCall);
        st.pot += toCall;
        player.acted = true;
        if (player.status === 'all-in') {
          st.handHistory.push(`${player.name} 全押跟注 ${toCall}，本局投入：${player.totalBet}，剩余：0`);
        } else {
          st.handHistory.push(`${player.name} 跟注 ${toCall}，本局投入：${player.totalBet}，剩余：${player.chips}`);
        }
        break;
      }

      case 'raise': {
        // amount = desired new currentBet total
        const needed = Math.max(0, amount - player.roundBet);
        const added  = Math.min(needed, player.chips);
        this._deductChips(player, added);
        st.pot += added;
        const newTotal = player.roundBet; // updated by _deductChips

        if (newTotal > st.currentBet) {
          st.lastRaise          = newTotal - st.currentBet;
          st.currentBet         = newTotal;
          st.lastAggressorIndex = pi;
          // All other active players must act again
          for (const p of st.players) {
            if (p.status === 'active' && p.id !== playerId) p.acted = false;
          }
        }
        player.acted = true;
        if (player.status === 'all-in') {
          st.handHistory.push(`${player.name} 全押加注至 ${newTotal}，本局投入：${player.totalBet}，剩余：0`);
        } else {
          st.handHistory.push(`${player.name} 加注至 ${newTotal}，本局投入：${player.totalBet}，剩余：${player.chips}`);
        }
        break;
      }

      case 'all-in': {
        const allIn = player.chips;
        this._deductChips(player, allIn);
        st.pot += allIn;
        player.acted = true;
        const newTotal = player.roundBet;
        if (newTotal > st.currentBet) {
          st.lastRaise          = newTotal - st.currentBet;
          st.currentBet         = newTotal;
          st.lastAggressorIndex = pi;
          for (const p of st.players) {
            if (p.status === 'active' && p.id !== playerId) p.acted = false;
          }
        }
        st.handHistory.push(`${player.name} 全押 ${allIn}，本局投入：${player.totalBet}，剩余：0`);
        break;
      }
    }

    st.actionCount++;
    this._afterAction();
  }

  _deductChips(player, amount) {
    player.chips    -= amount;
    player.roundBet += amount;
    player.totalBet += amount;
    if (player.chips === 0) player.status = 'all-in';
  }

  _afterAction() {
    const st = this.state;
    const inHand = st.players.filter(p => p.status === 'active' || p.status === 'all-in');

    // Only one player left — they win immediately
    if (inHand.length <= 1) {
      this.doShowdown();
      return;
    }

    // All remaining are all-in or only one active — skip to showdown pipeline
    const active = st.players.filter(p => p.status === 'active');
    if (active.length === 0) {
      this.advancePhase();
      return;
    }

    if (this.isRoundComplete()) {
      this.advancePhase();
      return;
    }

    this._advanceTurn();
  }

  // ── Betting round completion check ───────────────────────────────────────

  isRoundComplete() {
    const active = this.state.players.filter(p => p.status === 'active');
    if (active.length === 0) return true;
    return active.every(p => p.acted && p.roundBet >= this.state.currentBet);
  }

  // ── Advance turn to next active player ───────────────────────────────────

  _advanceTurn() {
    const st = this.state;
    const n  = st.players.length;
    let i    = (st.currentPlayerIndex + 1) % n;
    for (let c = 0; c < n; c++) {
      if (st.players[i].status === 'active') {
        st.currentPlayerIndex = i;
        return;
      }
      i = (i + 1) % n;
    }
    // No active player — advance phase
    this.advancePhase();
  }

  // ── Advance game phase ───────────────────────────────────────────────────

  advancePhase() {
    const st  = this.state;
    const { bigBlind } = this.settings;

    // Reset round state for every player still in the hand
    for (const p of st.players) {
      if (p.status === 'active' || p.status === 'all-in') {
        p.roundBet = 0;
        p.acted    = (p.status === 'all-in'); // all-in players already acted
      }
    }
    st.currentBet = 0;
    st.lastRaise  = bigBlind;

    if (st.phase === 'preflop') {
      const cards = [st.deck.deal(), st.deck.deal(), st.deck.deal()];
      st.communityCards = cards;
      st.phase = 'flop';
      st.handHistory.push(`--- 翻牌: ${cards.map(c => c.toString()).join(' ')} ---`);
    } else if (st.phase === 'flop') {
      const card = st.deck.deal();
      st.communityCards.push(card);
      st.phase = 'turn';
      st.handHistory.push(`--- 转牌: ${card.toString()} ---`);
    } else if (st.phase === 'turn') {
      const card = st.deck.deal();
      st.communityCards.push(card);
      st.phase = 'river';
      st.handHistory.push(`--- 河牌: ${card.toString()} ---`);
    } else if (st.phase === 'river') {
      this.doShowdown();
      return;
    } else {
      return;
    }

    // Set first actor after dealer
    const firstActive = this._firstActiveAfterDealer();
    if (firstActive === -1) {
      // Everyone is all-in — keep advancing (renderer will call advancePhase again with delay)
      return;
    }
    st.currentPlayerIndex = firstActive;
    st.lastAggressorIndex = firstActive;
  }

  // ── Showdown ─────────────────────────────────────────────────────────────

  doShowdown() {
    const st = this.state;
    st.phase = 'showdown';

    const inHand = st.players.filter(p => p.status === 'active' || p.status === 'all-in');

    if (inHand.length === 0) {
      st.gameHistory.push(`第${st.roundNumber}局: 无人在手`);
      return;
    }

    // Last man standing — no showdown needed
    if (inHand.length === 1) {
      const winner = inHand[0];
      winner.chips += st.pot;
      st.handHistory.push(`${winner.name} 赢得底池 ${st.pot} 筹码（其余玩家弃牌）`);
      st.gameHistory.push(`第${st.roundNumber}局: ${winner.name} 赢得 ${st.pot}`);
      st.showdownData = [{ player: winner, hand: null, win: st.pot, winnerOf: [st.pot] }];
      st.pot = 0;
      this._checkGameOver();
      return;
    }

    // Evaluate all hands
    const results = inHand.map(p => ({
      player: p,
      hand: handEvaluator.bestHand([...p.holeCards, ...st.communityCards])
    }));

    st.handHistory.push('--- 摊牌 ---');
    for (const { player, hand } of results) {
      const cards = player.holeCards.map(c => c.toString()).join(' ');
      st.handHistory.push(`${player.name}: ${cards} → ${handEvaluator.handName(hand.rank)}`);
    }

    // Distribute side pots
    const pots  = this._calcSidePots(inHand);
    const winMap = {}; // playerId → total winnings
    for (const r of results) winMap[r.player.id] = 0;

    for (const pot of pots) {
      let best = null;
      for (const r of pot.eligible) {
        const pr = results.find(x => x.player.id === r.id);
        if (!best || handEvaluator.compareHands(pr.hand, best.hand) > 0) best = pr;
      }
      const winners = pot.eligible
        .map(r => results.find(x => x.player.id === r.id))
        .filter(r => handEvaluator.compareHands(r.hand, best.hand) === 0);

      const share = Math.floor(pot.amount / winners.length);
      let rem     = pot.amount - share * winners.length;
      for (const w of winners) {
        const gain = share + (rem-- > 0 ? 1 : 0);
        w.player.chips  += gain;
        winMap[w.player.id] = (winMap[w.player.id] || 0) + gain;
        st.handHistory.push(`${w.player.name} 赢得 ${gain} 筹码 (${handEvaluator.handName(w.hand.rank)})`);
      }
    }

    st.showdownData = results.map(r => ({ player: r.player, hand: r.hand, win: winMap[r.player.id] || 0 }));
    st.gameHistory.push(
      `第${st.roundNumber}局: ` +
      st.showdownData.filter(d => d.win > 0).map(d => `${d.player.name}赢${d.win}`).join('，')
    );
    st.pot = 0;
    this._checkGameOver();
  }

  _checkGameOver() {
    const alive = this.state.players.filter(p => p.chips > 0 || (p.status !== 'out' && p.status !== 'folded'));
    if (alive.length <= 1) this.state.phase = 'game_over';
  }

  // ── Side pot calculation ─────────────────────────────────────────────────

  _calcSidePots(playersInHand) {
    const st = this.state;
    const levels = [...new Set(
      st.players.filter(p => p.totalBet > 0).map(p => p.totalBet)
    )].sort((a, b) => a - b);

    const pots = [];
    let prev = 0;

    for (const level of levels) {
      const inc   = level - prev;
      if (inc <= 0) { prev = level; continue; }
      const count = st.players.filter(p => p.totalBet >= level).length;
      const amt   = inc * count;
      const elig  = playersInHand.filter(p => p.totalBet >= level);
      if (elig.length > 0 && amt > 0) pots.push({ amount: amt, eligible: elig });
      prev = level;
    }

    // Any rounding residual goes to last pot
    const distributed = pots.reduce((s, p) => s + p.amount, 0);
    if (st.pot > distributed && pots.length > 0) {
      pots[pots.length - 1].amount += st.pot - distributed;
    } else if (st.pot > distributed && playersInHand.length > 0) {
      pots.push({ amount: st.pot - distributed, eligible: playersInHand });
    }

    return pots;
  }

  // ── Valid actions for a player ───────────────────────────────────────────

  getValidActions(playerId) {
    const st = this.state;
    const player = st.players.find(p => p.id === playerId);
    if (!player || player.status !== 'active') return [];

    const toCall = st.currentBet - player.roundBet;
    const actions = [];

    if (toCall === 0) {
      actions.push({ action: 'check' });
    } else {
      actions.push({ action: 'fold' });
      if (player.chips <= toCall) {
        actions.push({ action: 'all-in', amount: player.chips });
        return actions;
      }
      actions.push({ action: 'call', amount: toCall });
    }

    const minInc      = Math.max(st.lastRaise || this.settings.bigBlind, this.settings.bigBlind);
    const minRaiseTotal = st.currentBet + minInc;
    const playerMax   = player.chips + player.roundBet;

    if (playerMax >= minRaiseTotal) {
      actions.push({ action: 'raise', minAmount: minRaiseTotal, maxAmount: playerMax });
    } else if (playerMax > st.currentBet && !actions.some(a => a.action === 'all-in')) {
      actions.push({ action: 'all-in', amount: player.chips });
    }

    // Fold always available when there's a bet
    if (toCall > 0 && !actions.some(a => a.action === 'fold')) {
      actions.push({ action: 'fold' });
    }

    return actions;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  getCurrentPlayer() {
    return this.state.players[this.state.currentPlayerIndex] || null;
  }

  shouldAutoAdvance() {
    const st = this.state;
    if (['showdown', 'game_over', 'waiting'].includes(st.phase)) return false;
    return st.players.filter(p => p.status === 'active').length === 0;
  }

  _clockwiseFrom(dealerIndex, statusFilter) {
    const st = this.state;
    const n  = st.players.length;
    const result = [];
    for (let k = 1; k <= n; k++) {
      const i = (dealerIndex + k) % n;
      if (!statusFilter || st.players[i].status === statusFilter) result.push(i);
    }
    return result;
  }

  _firstActiveAfterDealer() {
    const st = this.state;
    const n  = st.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (st.dealerIndex + k) % n;
      if (st.players[i].status === 'active') return i;
    }
    return -1;
  }

  // ── Serialization ────────────────────────────────────────────────────────

  serializeState() {
    const st = this.state;
    return JSON.stringify({
      settings: this.settings,
      phase: st.phase,
      communityCards:  st.communityCards.map(c => ({ rank: c.rank, suit: c.suit })),
      pot:             st.pot,
      currentBet:      st.currentBet,
      currentPlayerIndex: st.currentPlayerIndex,
      dealerIndex:     st.dealerIndex,
      smallBlindIndex: st.smallBlindIndex,
      bigBlindIndex:   st.bigBlindIndex,
      handHistory:     st.handHistory,
      gameHistory:     st.gameHistory,
      lastRaise:       st.lastRaise,
      roundNumber:     st.roundNumber,
      lastAggressorIndex: st.lastAggressorIndex,
      players: st.players.map(p => ({
        id: p.id, name: p.name, chips: p.chips,
        holeCards: p.holeCards.map(c => ({ rank: c.rank, suit: c.suit })),
        roundBet: p.roundBet, totalBet: p.totalBet,
        status: p.status, isHuman: p.isHuman,
        aiType: p.aiType, aiMode: p.aiMode, aiConfig: p.aiConfig, acted: p.acted
      }))
    });
  }

  deserializeState(jsonStr) {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    this.settings = data.settings;

    this.state = {
      phase: data.phase,
      communityCards:  data.communityCards.map(c => new Card(c.rank, c.suit)),
      pot:             data.pot,
      currentBet:      data.currentBet,
      currentPlayerIndex: data.currentPlayerIndex,
      dealerIndex:     data.dealerIndex,
      smallBlindIndex: data.smallBlindIndex,
      bigBlindIndex:   data.bigBlindIndex,
      handHistory:     data.handHistory,
      gameHistory:     data.gameHistory,
      lastRaise:       data.lastRaise,
      roundNumber:     data.roundNumber,
      actionCount:     0,
      lastAggressorIndex: data.lastAggressorIndex,
      sidePots: [],
      deck: null,
      showdownData: null,
      players: data.players.map(p => ({
        ...p,
        holeCards: p.holeCards.map(c => new Card(c.rank, c.suit))
      }))
    };
  }
}

if (typeof module !== 'undefined') module.exports = { GameEngine };
