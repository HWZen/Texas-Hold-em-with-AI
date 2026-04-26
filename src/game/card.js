'use strict';

// Card ranks: 2-14 (14 = Ace). Suits: hearts, diamonds, clubs, spades.

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const ALL_RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_DISPLAY = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' };
const SUIT_SYMBOL  = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

class Card {
  constructor(rank, suit) {
    this.rank = rank;
    this.suit = suit;
  }

  get rankName()   { return RANK_DISPLAY[this.rank] || String(this.rank); }
  get suitSymbol() { return SUIT_SYMBOL[this.suit]; }
  toString()       { return `${this.rankName}${this.suitSymbol}`; }
}

class Deck {
  constructor() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of ALL_RANKS) {
        this.cards.push(new Card(rank, suit));
      }
    }
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }

  deal(n) {
    if (n === undefined || n === 1) return this.cards.pop();
    const result = [];
    for (let i = 0; i < n; i++) result.push(this.cards.pop());
    return result;
  }
}

if (typeof module !== 'undefined') module.exports = { Card, Deck, SUITS, ALL_RANKS };
