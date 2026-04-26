'use strict';

// Local AI decision engine for Texas Hold'em
// Depends on handEvaluator and Card being available (globals in browser, required in Node).
/* eslint-disable no-var */
if (typeof module !== 'undefined') {
  var _card = require('./card.js');
  var Card  = _card.Card;
  var _he   = require('./hand-evaluator.js');
  var handEvaluator = _he.handEvaluator;
}

const MONTE_CARLO_SIMS = 180;

const PARAMS = {
  aggressive:   { eq_raise: 0.57, eq_call: 0.34, eq_open: 0.43, semi_bluff: 0.10 },
  balanced:     { eq_raise: 0.62, eq_call: 0.35, eq_open: 0.48, semi_bluff: 0.06 },
  conservative: { eq_raise: 0.70, eq_call: 0.42, eq_open: 0.58, semi_bluff: 0.03 }
};

// ── Chen Score ────────────────────────────────────────────────────────────────
const BASE_SCORE = { 14:10, 13:8, 12:7, 11:6, 10:5, 9:4.5, 8:4, 7:3.5, 6:3, 5:2.5, 4:2, 3:1.5, 2:1 };

function chenScore(holeCards) {
  const [hi, lo] = holeCards.map(c => c.rank).sort((a, b) => b - a);
  let score = BASE_SCORE[hi] || 1;

  if (hi === lo) {
    score = Math.max(score * 2, 5);
  } else {
    if (holeCards[0].suit === holeCards[1].suit) score += 2;
    const gap = hi - lo - 1;
    if      (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >  3) score -= 5;
    if (gap <= 1 && lo < 12) score += 1;
  }
  return Math.max(0, score);
}

// ── Preflop hand profile ──────────────────────────────────────────────────────
function preflopHandProfile(holeCards) {
  const sorted = holeCards.map(c => c.rank).sort((a, b) => b - a);
  const hi = sorted[0], lo = sorted[1];
  const suited          = holeCards[0].suit === holeCards[1].suit;
  const isPair          = hi === lo;
  const connected       = (hi - lo === 1);
  const one_gap         = (hi - lo === 2);
  const broadway_count  = holeCards.filter(c => c.rank >= 10).length;
  const ace_high        = hi === 14;
  const wheel_ace       = ace_high && lo <= 5;
  const score           = chenScore(holeCards);

  let tier;
  if      (isPair && hi >= 11)                          tier = 'premium';
  else if (isPair && hi >= 8)                           tier = 'strong';
  else if (isPair && hi >= 5)                           tier = 'playable';
  else if (suited && connected && hi >= 10)             tier = 'strong';
  else if (ace_high && broadway_count === 2)            tier = suited ? 'premium' : 'strong';
  else if (ace_high && suited && lo >= 10)              tier = 'strong';
  else if (suited && wheel_ace)                         tier = lo >= 4 ? 'strong' : 'playable';
  else if (ace_high && lo >= 9)                         tier = 'playable';
  else if (broadway_count === 2)                        tier = (suited || connected) ? 'playable' : 'marginal';
  else if (suited && connected && hi >= 7)              tier = 'playable';
  else if (suited && one_gap && hi >= 9)                tier = 'marginal';
  else if (score >= 8)                                  tier = 'playable';
  else if (score >= 6)                                  tier = 'marginal';
  else                                                  tier = 'trash';

  return { tier, suited, isPair, connected, score, hi, lo };
}

// ── Monte Carlo equity ────────────────────────────────────────────────────────
function monteCarloEquity(holeCards, communityCards, numOpponents, simulations) {
  simulations = simulations || MONTE_CARLO_SIMS;
  numOpponents = Math.max(1, numOpponents);

  const usedSet = new Set([...holeCards, ...communityCards].map(c => `${c.rank}_${c.suit}`));
  const remaining = [];
  for (const suit of ['hearts', 'diamonds', 'clubs', 'spades']) {
    for (let rank = 2; rank <= 14; rank++) {
      if (!usedSet.has(`${rank}_${suit}`)) remaining.push({ rank, suit });
    }
  }

  const boardNeeded = 5 - communityCards.length;
  const cardsPerSim = numOpponents * 2 + boardNeeded;
  if (remaining.length < cardsPerSim) return 0.5;

  let wins = 0;

  for (let s = 0; s < simulations; s++) {
    // Fisher-Yates shuffle on remaining
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = remaining[i]; remaining[i] = remaining[j]; remaining[j] = tmp;
    }

    let idx = 0;
    const oppHands = [];
    for (let o = 0; o < numOpponents; o++) {
      oppHands.push([remaining[idx++], remaining[idx++]]);
    }

    const board = communityCards.concat(remaining.slice(idx, idx + boardNeeded));
    const myBest = handEvaluator.bestHand(holeCards.concat(board));

    let iWin = true, tie = false;
    for (const oh of oppHands) {
      const oppBest = handEvaluator.bestHand(oh.concat(board));
      const cmp = handEvaluator.compareHands(myBest, oppBest);
      if (cmp < 0) { iWin = false; break; }
      if (cmp === 0) tie = true;
    }
    if (iWin) wins += tie ? 0.5 : 1;
  }

  return wins / simulations;
}

// ── Postflop features ─────────────────────────────────────────────────────────
function postflopFeatures(holeCards, communityCards) {
  const allCards = holeCards.concat(communityCards);
  const made_rank = handEvaluator.bestHand(allCards).rank;

  let pair_type = null;
  if (made_rank <= 0) {
    const maxBoard = Math.max(...communityCards.map(c => c.rank));
    if (holeCards.some(c => c.rank === maxBoard)) {
      pair_type = 'top_pair';
    } else if (holeCards.some(h => communityCards.some(b => b.rank === h.rank))) {
      pair_type = 'middle_or_bottom_pair';
    }
  }

  const suitCounts = {};
  for (const c of allCards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  const flush_draw = Object.values(suitCounts).some(n => n === 4);

  const uniqueRanks = [...new Set(allCards.map(c => c.rank))].sort((a, b) => a - b);
  let straight_draw = false, gutshot = false;
  for (let i = 0; i <= uniqueRanks.length - 4; i++) {
    const w = uniqueRanks.slice(i, i + 4);
    const span = w[3] - w[0];
    if (span === 3) straight_draw = true;
    else if (span === 4) gutshot = true;
  }

  return { made_rank, pair_type, flush_draw, straight_draw, gutshot };
}

// ── Target raise total ────────────────────────────────────────────────────────
function targetRaiseTotal(currentBet, minIncrement, pot, maxBet, roundBet, chips) {
  const increment = Math.max(
    minIncrement,
    Math.floor(Math.max(pot, 1) * (0.45 + Math.random() * 0.30))
  );
  let total = currentBet + increment;
  total = Math.min(total, maxBet, roundBet + chips);
  return total > currentBet ? total : currentBet;
}

// ── Main decide function ──────────────────────────────────────────────────────
function decide({ holeCards, communityCards, currentBet, roundBet, maxBet, pot, numActive, lastRaise, bigBlind, aiType, chips }) {
  const params = PARAMS[aiType] || PARAMS.balanced;
  const toCall = currentBet - roundBet;
  const minIncrement = Math.max(lastRaise || bigBlind, bigBlind);

  if (communityCards.length === 0) {
    // ── Preflop ──────────────────────────────────────────────────────────
    const { tier } = preflopHandProfile(holeCards);

    if (toCall === 0) {
      if (['premium', 'strong', 'playable'].includes(tier)) {
        const amount = targetRaiseTotal(currentBet, minIncrement, pot, maxBet, roundBet, chips);
        if (amount > currentBet) return { action: 'raise', amount };
      }
      return { action: 'check' };
    }

    if (['premium', 'strong'].includes(tier)) {
      if (Math.random() < 0.45) {
        const amount = targetRaiseTotal(currentBet, minIncrement, pot, maxBet, roundBet, chips);
        if (amount > currentBet) return { action: 'raise', amount };
      }
      return { action: 'call', amount: toCall };
    }
    if (tier === 'playable' && toCall <= Math.max(bigBlind * 3, pot * 0.35)) {
      return { action: 'call', amount: toCall };
    }
    if (tier === 'marginal' && toCall <= bigBlind * 2 && Math.random() < 0.4) {
      return { action: 'call', amount: toCall };
    }
    return { action: 'fold' };
  }

  // ── Postflop ──────────────────────────────────────────────────────────────
  const equity = monteCarloEquity(holeCards, communityCards, Math.max(1, numActive - 1), MONTE_CARLO_SIMS);
  const feats  = postflopFeatures(holeCards, communityCards);

  let pe = equity;
  if (feats.flush_draw)              pe += 0.10;
  if (feats.straight_draw)           pe += 0.08;
  if (feats.pair_type === 'top_pair') pe += 0.05;
  pe = Math.min(pe, 1.0);

  if (toCall > 0) {
    const pot_odds = toCall / Math.max(pot + toCall, 1);
    const callThreshold = Math.max(params.eq_call, pot_odds + 0.04);
    if (pe >= callThreshold) {
      if (pe >= params.eq_raise && Math.random() < 0.3) {
        const amount = targetRaiseTotal(currentBet, minIncrement, pot, maxBet, roundBet, chips);
        if (amount > currentBet) return { action: 'raise', amount };
      }
      return { action: 'call', amount: toCall };
    }
    return { action: 'fold' };
  }

  if (pe >= params.eq_raise) {
    const amount = targetRaiseTotal(currentBet, minIncrement, pot, maxBet, roundBet, chips);
    if (amount > currentBet) return { action: 'raise', amount };
  }
  if (pe >= params.eq_open && Math.random() < 0.55) {
    const amount = targetRaiseTotal(currentBet, minIncrement, pot, maxBet, roundBet, chips);
    if (amount > currentBet) return { action: 'raise', amount };
  }
  return { action: 'check' };
}

if (typeof module !== 'undefined') {
  module.exports = { decide, preflopHandProfile, chenScore, monteCarloEquity, postflopFeatures };
}
