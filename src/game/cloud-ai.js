'use strict';

// Cloud AI decision via OpenAI-compatible HTTP API (proxied through main process to avoid CORS)

const PHASE_NAMES = { preflop: '翻牌前', flop: '翻牌圈', turn: '转牌圈', river: '河牌圈' };

function buildPrompt(gameState, availableActions) {
  const { player, communityCards, pot, currentBet, roundBet, handHistory, bigBlind, phase } = gameState;
  const holeStr    = player.holeCards.map(c => `${c.rankName}${c.suitSymbol}`).join(' ');
  const boardStr   = communityCards.length ? communityCards.map(c => `${c.rankName}${c.suitSymbol}`).join(' ') : '无';
  const toCall     = currentBet - roundBet;
  const phaseName  = PHASE_NAMES[phase] || phase;

  let actionsStr;
  if (availableActions.includes('check') && !availableActions.includes('call')) {
    actionsStr = 'fold（弃牌）, check（过牌）';
    if (availableActions.includes('raise')) {
      actionsStr += `, raise（加注，需指定amount）`;
    }
  } else {
    actionsStr = `fold（弃牌）, call（跟注 ${toCall}）`;
    if (availableActions.includes('raise')) {
      const minR = currentBet + bigBlind;
      actionsStr += `, raise（加注，min:${minR} max:${player.chips + player.roundBet}，需指定amount）`;
    }
  }

  const history = (handHistory || []).slice(-30).join('\n');

  return `## 德州扑克决策请求

阶段：${phaseName}
公共牌：${boardStr}
你的手牌：${holeStr}
底池：${pot}
当前最高下注：${currentBet}
你本轮已投入：${roundBet}
需要跟注金额：${toCall}
你的剩余筹码：${player.chips}

## 本局行动历史（最近30条）
${history || '无'}

## 可选操作
${actionsStr}

请以JSON格式回复你的决策，例如：
{"action":"raise","amount":120}
或 {"action":"call"} 或 {"action":"fold"} 或 {"action":"check"}
只输出JSON，不要其他内容。`;
}

function parseResponse(text, availableActions, gameState) {
  try {
    const m = text.match(/\{[\s\S]*?\}/);
    if (!m) throw new Error('no JSON');
    const obj = JSON.parse(m[0]);
    const action = (obj.action || '').toLowerCase().trim();

    if (!availableActions.includes(action)) {
      return availableActions.includes('check') ? { action: 'check' } : { action: 'fold' };
    }

    if (action === 'raise') {
      const { currentBet, bigBlind, player, roundBet } = gameState;
      const minRaise = currentBet + bigBlind;
      const maxRaise = player.chips + (roundBet || 0);
      const amount   = Math.max(minRaise, Math.min(parseInt(obj.amount) || minRaise, maxRaise));
      return { action: 'raise', amount };
    }
    if (action === 'call') {
      return { action: 'call', amount: Math.max(0, gameState.currentBet - (gameState.roundBet || 0)) };
    }
    return { action };
  } catch (e) {
    return availableActions.includes('check') ? { action: 'check' } : { action: 'fold' };
  }
}

async function getCloudAIDecision(aiConfig, gameState, availableActions) {
  const { url, apiKey, model } = aiConfig;
  const messages = [
    {
      role: 'system',
      content: '你是一个专业德州扑克AI。严格按照JSON格式输出决策，不要输出任何其他内容。'
    },
    {
      role: 'user',
      content: buildPrompt(gameState, availableActions)
    }
  ];

  try {
    const responseText = await window.api.aiRequest({ url, apiKey, model, messages });
    return parseResponse(responseText, availableActions, gameState);
  } catch (e) {
    console.error('Cloud AI error:', e);
    return availableActions.includes('check') ? { action: 'check' } : { action: 'fold' };
  }
}

if (typeof module !== 'undefined') module.exports = { getCloudAIDecision };
