'use strict';

// Hand ranks (higher = better)
const HR = {
  ROYAL_FLUSH:    8,
  STRAIGHT_FLUSH: 7,
  FOUR_OF_A_KIND: 6,
  FULL_HOUSE:     5,
  FLUSH:          4,
  STRAIGHT:       3,
  THREE_OF_A_KIND:2,
  TWO_PAIR:       1,
  ONE_PAIR:       0,
  HIGH_CARD:     -1
};

const HAND_NAME_MAP = {
  [HR.ROYAL_FLUSH]:    '皇家同花顺',
  [HR.STRAIGHT_FLUSH]: '同花顺',
  [HR.FOUR_OF_A_KIND]: '四条',
  [HR.FULL_HOUSE]:     '葫芦',
  [HR.FLUSH]:          '同花',
  [HR.STRAIGHT]:       '顺子',
  [HR.THREE_OF_A_KIND]:'三条',
  [HR.TWO_PAIR]:       '两对',
  [HR.ONE_PAIR]:       '一对',
  [HR.HIGH_CARD]:      '高牌'
};

class HandEvaluator {
  // Evaluate a 5-card hand → {rank, tiebreakers:[...]}
  evaluateFive(cards) {
    const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);

    const isFlush = suits.every(s => s === suits[0]);
    const isNormalStraight = this._isNormalStraight(ranks);
    const isWheel = this._isWheel(ranks); // A-2-3-4-5

    // Count occurrences, sorted by (count desc, rank desc)
    const rankCount = {};
    for (const r of ranks) rankCount[r] = (rankCount[r] || 0) + 1;

    const groups = Object.entries(rankCount)
      .map(([r, c]) => [Number(r), c])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

    const topCounts = groups.map(g => g[1]);
    const topRanks  = groups.map(g => g[0]);

    // Royal Flush
    if (isFlush && isNormalStraight && ranks[0] === 14 && ranks[1] === 13) {
      return { rank: HR.ROYAL_FLUSH, tiebreakers: [14] };
    }
    // Straight Flush
    if (isFlush && isNormalStraight) return { rank: HR.STRAIGHT_FLUSH, tiebreakers: [ranks[0]] };
    if (isFlush && isWheel)          return { rank: HR.STRAIGHT_FLUSH, tiebreakers: [5] };

    // Four of a Kind
    if (topCounts[0] === 4) return { rank: HR.FOUR_OF_A_KIND, tiebreakers: topRanks };

    // Full House
    if (topCounts[0] === 3 && topCounts[1] === 2) return { rank: HR.FULL_HOUSE, tiebreakers: topRanks };

    // Flush
    if (isFlush) return { rank: HR.FLUSH, tiebreakers: ranks };

    // Straight
    if (isNormalStraight) return { rank: HR.STRAIGHT, tiebreakers: [ranks[0]] };
    if (isWheel)          return { rank: HR.STRAIGHT, tiebreakers: [5] };

    // Three of a Kind
    if (topCounts[0] === 3) return { rank: HR.THREE_OF_A_KIND, tiebreakers: topRanks };

    // Two Pair
    if (topCounts[0] === 2 && topCounts[1] === 2) return { rank: HR.TWO_PAIR, tiebreakers: topRanks };

    // One Pair
    if (topCounts[0] === 2) return { rank: HR.ONE_PAIR, tiebreakers: topRanks };

    // High Card
    return { rank: HR.HIGH_CARD, tiebreakers: ranks };
  }

  _isNormalStraight(sortedDesc) {
    if (sortedDesc.length !== 5) return false;
    for (let i = 0; i < 4; i++) {
      if (sortedDesc[i] - sortedDesc[i + 1] !== 1) return false;
    }
    return true;
  }

  _isWheel(sortedDesc) {
    return sortedDesc[0] === 14 &&
           sortedDesc[1] === 5 &&
           sortedDesc[2] === 4 &&
           sortedDesc[3] === 3 &&
           sortedDesc[4] === 2;
  }

  // Best 5-card hand from 5-7 cards → {rank, tiebreakers}
  bestHand(cards) {
    if (!cards || cards.length === 0) return { rank: HR.HIGH_CARD, tiebreakers: [0] };
    if (cards.length <= 5) return this.evaluateFive(cards);

    let best = null;
    const combos = this._combinations(cards, 5);
    for (const combo of combos) {
      const result = this.evaluateFive(combo);
      if (!best || this._cmp(result, best) > 0) best = result;
    }
    return best;
  }

  _combinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    if (arr.length === k) return [[...arr]];
    const result = [];
    for (let i = 0; i <= arr.length - k; i++) {
      for (const rest of this._combinations(arr.slice(i + 1), k - 1)) {
        result.push([arr[i], ...rest]);
      }
    }
    return result;
  }

  _cmp(r1, r2) {
    if (r1.rank !== r2.rank) return r1.rank > r2.rank ? 1 : -1;
    const len = Math.min(r1.tiebreakers.length, r2.tiebreakers.length);
    for (let i = 0; i < len; i++) {
      if (r1.tiebreakers[i] !== r2.tiebreakers[i]) {
        return r1.tiebreakers[i] > r2.tiebreakers[i] ? 1 : -1;
      }
    }
    return 0;
  }

  // Compare two evaluated hand objects
  compareHands(h1, h2) { return this._cmp(h1, h2); }

  handName(rank) { return HAND_NAME_MAP[rank] || '未知'; }
}

const handEvaluator = new HandEvaluator();

if (typeof module !== 'undefined') {
  module.exports = { HandEvaluator, handEvaluator, HR, HAND_NAME_MAP };
}
