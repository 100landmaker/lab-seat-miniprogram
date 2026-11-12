const db = require('./db');

/**
 * 本地知识库（智能问答）
 *
 * 后续喂数据：直接往 KNOWLEDGE 数组追加条目即可，页面代码无需改动。
 * 每条格式：
 * {
 *   keywords: ['关键词1', '关键词2'], // 问题里包含越多、关键词越长，得分越高
 *   question: '标准问题',
 *   answer: '回答内容'
 * }
 */
const KNOWLEDGE = [
  {
    keywords: ['怎么预约', '如何预约', '预约座位', '预约流程', '怎么约', '订座'],
    question: '怎么预约座位？',
    answer: '在首页点「预约选座」：先选日期（未来 7 天），再选 1 小时时段（08:00-22:00），最后点空闲座位确认预约。同一时段每人只能预约 1 个座位。'
  },
  {
    keywords: ['开放时间', '几点开门', '几点关门', '营业时间', '什么时候开放', '开放'],
    question: '机房开放时间？',
    answer: '机房每天 08:00-22:00 开放，预约按 1 小时一个时段，共 14 个时段。'
  },
  {
    keywords: ['取消预约', '怎么取消', '能取消吗', '退约', '取消'],
    question: '预约后可以取消吗？',
    answer: '可以。进入「我的预约」→「待使用」，点预约卡片上的「取消」即可。预约开始后就不能取消了，请提前操作。'
  },
  {
    keywords: ['签到', '二维码', '扫码', '签到码', '扫不出'],
    question: '怎么签到？',
    answer: '到机房后扫描教师端大屏上的二维码签到；扫不出来时，可以手动输入二维码下方的 6 位签到码。签到后才能选座。'
  },
  {
    keywords: ['迟到', '超时', '晚到', '没去'],
    question: '预约后迟到怎么办？',
    answer: '预约不会自动占座，到机房后仍需扫码签到并选座。如果确定来不了，请在开始前到「我的预约」取消，把座位让给其他同学。'
  },
  {
    keywords: ['故障', '电脑坏了', '电脑故障', '维修', '坏了'],
    question: '座位电脑故障怎么办？',
    answer: '故障座位在座位图上会显示「故障」且不可选。遇到设备问题请联系机房老师处理，不要自行搬动设备。'
  },
  {
    keywords: ['限制', '最多', '几个', '次数', '同时约'],
    question: '预约有什么限制？',
    answer: '同一时段每人只能预约 1 个座位；同一个座位在同一时段只能被 1 人预约；只能预约未来 7 天内的时段；已开始的时段不能预约。'
  },
  {
    keywords: ['退座', '释放座位', '离开', '不坐了'],
    question: '怎么退座？',
    answer: '在首页「我的座位」卡片点「退座」，或在座位详情里点「退出这个座位」。退座会同步结束你的签到。'
  },
  {
    keywords: ['换座', '换座位', '改约', '换一个'],
    question: '可以换座位吗？',
    answer: '请先在「我的预约」取消原预约，再到「预约选座」重新选座；如果已经签到占座，需要先在首页退座再重新选。'
  },
  {
    keywords: ['老师', '教师端', '管理', '强制', '代退'],
    question: '教师端能做什么？',
    answer: '教师端可以查看全部座位和学生名单、生成教室签到二维码、按日期查看预约并取消预约，也可以帮学生强制退座。'
  },
  {
    keywords: ['注册', '账号', '登录', '密码', '忘记密码'],
    question: '账号相关问题',
    answer: '在登录页可以注册学生或教师账号，密码至少 6 位。忘记密码目前需要联系机房老师或管理员重置。'
  }
];

const QUICK_QUESTIONS = [
  '怎么预约座位？',
  '现在还有多少空位？',
  '我的预约有哪些？',
  '机房开放时间？',
  '预约后可以取消吗？'
];

function matchKB(text) {
  let best = null;
  let bestScore = 0;

  KNOWLEDGE.forEach(item => {
    let score = 0;
    item.keywords.forEach(keyword => {
      if (text.indexOf(keyword) > -1) score += keyword.length;
    });
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  });

  return bestScore > 0 ? best : null;
}

function freeSeatAnswer(user) {
  return db.getRoom(user.id).then(res => {
    const s = res.stats;
    return `当前 ${res.room.name} 空闲 ${s.free} 个座位（共 ${s.total} 个，使用中 ${s.occupied} 个，故障 ${s.broken} 个）。\n想保留座位的话，可以到「预约选座」按日期和时段预约。`;
  });
}

function myReservationAnswer(user) {
  return db.getMyReservations(user.id).then(res => {
    if (!res.current.length) {
      return '你目前没有待使用的预约。可以到「预约选座」选日期、时段和座位。';
    }
    const lines = res.current.slice(0, 3).map(r =>
      `${r.date} ${r.start}-${r.end} ${r.seatCode}（${r.stateText}）`
    );
    return `你当前有 ${res.current.length} 个待使用预约：\n${lines.join('\n')}`;
  });
}

function delay(text) {
  return new Promise(resolve => {
    setTimeout(() => resolve({ text }), 260);
  });
}

/**
 * 回答一个问题
 * @param {string} text 用户问题
 * @param {object} user 当前登录用户
 * @returns {Promise<{text: string}>}
 */
function ask(text, user) {
  const q = String(text || '').trim();
  if (!q) return Promise.resolve({ text: '请输入你的问题。' });

  if (/(空位|空闲|有没有座|还有座|余座|座位情况|还有位置)/.test(q)) {
    return freeSeatAnswer(user).then(answer => ({ text: answer }));
  }

  if (/(我的预约|预约记录|我约了|查预约|约了哪些)/.test(q)) {
    return myReservationAnswer(user).then(answer => ({ text: answer }));
  }

  const hit = matchKB(q);
  if (hit) return delay(hit.answer);

  return delay('这个问题知识库里还没有收录。你可以换个问法，或让管理员在 utils/kb.js 里补充这条知识。');
}

module.exports = {
  KNOWLEDGE,
  QUICK_QUESTIONS,
  ask
};
