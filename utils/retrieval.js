/**
 * 轻量 RAG 检索层
 *
 * 不依赖向量数据库：中文按「单字 + 二元组」切分，结合关键词命中做相关度排序。
 * 后续如果接入向量检索或后端检索服务，只需替换 retrieve() 的实现，页面无需改动。
 */

const CUSTOM_KEY = 'lab_kb_custom_v1';

// 支持外部喂数据：把同结构的条目写进 storage 即可参与检索
function getCustomEntries() {
  const list = wx.getStorageSync(CUSTOM_KEY);
  return Array.isArray(list) ? list : [];
}

function tokenize(text) {
  const clean = String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');

  const grams = [];
  for (let i = 0; i < clean.length; i++) {
    grams.push(clean.charAt(i));
    if (i < clean.length - 1) grams.push(clean.slice(i, i + 2));
  }
  return grams;
}

function overlapScore(queryGrams, docGrams) {
  if (!queryGrams.length || !docGrams.length) return 0;

  const pool = {};
  docGrams.forEach(gram => {
    pool[gram] = (pool[gram] || 0) + 1;
  });

  let hit = 0;
  queryGrams.forEach(gram => {
    if (pool[gram]) {
      hit += 1;
      pool[gram] -= 1;
    }
  });

  return hit / Math.sqrt(queryGrams.length * docGrams.length);
}

function scoreEntry(query, entry) {
  const text = String(query || '').toLowerCase();

  let keywordScore = 0;
  (entry.keywords || []).forEach(keyword => {
    const word = String(keyword || '').toLowerCase();
    if (word && text.indexOf(word) > -1) {
      keywordScore += 3 + word.length;
    }
  });
  keywordScore = Math.min(1, keywordScore / 12);

  const sim = overlapScore(
    tokenize(query),
    tokenize(`${entry.question || ''} ${entry.answer || ''}`)
  );

  return keywordScore * 0.7 + sim * 0.3;
}

/**
 * 检索最相关的知识条目
 * @param {string} query 用户问题
 * @param {Array} corpus 知识条目数组
 * @param {number} topK 返回条数
 * @returns {Array} 按相关度降序的条目（带 score）
 */
function retrieve(query, corpus, topK) {
  const limit = topK || 3;
  const list = Array.isArray(corpus) ? corpus : [];

  return list
    .map(entry => Object.assign({}, entry, { score: scoreEntry(query, entry) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = {
  getCustomEntries,
  retrieve,
  tokenize
};
