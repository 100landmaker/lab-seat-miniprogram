/**
 * 本地数据层：用 wx.setStorage 模拟后端接口
 * 签到二维码采用「时间窗口 + 校验码」方案：同一间机房的不同设备可在离线状态下校验
 * 接入真实后端后，把 validateCode 交给服务端即可
 */
const DB_KEY = 'lab_db_v1';
const SESSION_KEY = 'lab_session_v1';
const CHECKIN_KEY = 'lab_checkins_v1';
const CONFIG_KEY = 'lab_config_v1';
const SECRET = 'lab-seat-2026';

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function timeNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 初始数据：6 排 × 8 列 = 48 个座位
function seed() {
  const occupiedSeed = { 5: '张一鸣', 12: '李思远', 20: '王浩', 27: '陈雨欣', 38: '赵敏', 43: '孙悦' };
  const broken = [7, 18, 31, 44];
  const seats = [];

  for (let i = 1; i <= 48; i++) {
    const isBroken = broken.indexOf(i) > -1;
    const occupiedBy = occupiedSeed[i];

    seats.push({
      no: i,
      code: 'A-' + pad(i),
      row: Math.ceil(i / 8),
      col: ((i - 1) % 8) + 1,
      status: isBroken ? 'broken' : (occupiedBy ? 'occupied' : 'free'),
      pcStatus: isBroken ? 'fault' : 'ok',
      occupant: occupiedBy
        ? { userId: 'seed-' + i, name: occupiedBy, time: '2026-11-06 09:12' }
        : null
    });
  }

  return {
    users: [
      { id: 'u-stu-1', username: 'xiaoming', password: '123456', name: '周嘉林', role: 'student' },
      { id: 'u-tea-1', username: 'teacher', password: '123456', name: '王老师', role: 'teacher' }
    ],
    room: {
      id: 'A301',
      name: 'A301 计算机机房',
      rows: 6,
      cols: 8,
      seats
    }
  };
}

function getDB() {
  let data = wx.getStorageSync(DB_KEY);
  if (!data || !data.users) {
    data = seed();
    wx.setStorageSync(DB_KEY, data);
  }
  return data;
}

function save(data) {
  wx.setStorageSync(DB_KEY, data);
}

// 模拟网络延迟，页面可以正常显示 loading
function run(fn) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      }
    }, 120);
  });
}

function init() {
  getDB();
}

/* ---------------- 账号 ---------------- */

function login(username, password) {
  return run(() => {
    const data = getDB();
    const user = data.users.find(u => u.username === username && u.password === password);
    if (!user) {
      throw new Error('账号或密码不正确');
    }
    return { id: user.id, name: user.name, role: user.role, username: user.username };
  });
}

function register(payload) {
  return run(() => {
    const data = getDB();
    const username = payload.username.trim();
    const name = payload.name.trim();

    if (!name) throw new Error('请输入姓名');
    if (username.length < 3) throw new Error('账号至少 3 个字符');
    if (payload.password.length < 6) throw new Error('密码至少 6 位');
    if (data.users.some(u => u.username === username)) {
      throw new Error('该账号已注册，请直接登录');
    }

    const user = {
      id: 'u-' + Date.now(),
      username,
      password: payload.password,
      name,
      role: payload.role
    };
    data.users.push(user);
    save(data);

    return { id: user.id, name: user.name, role: user.role, username: user.username };
  });
}

function getSession() {
  return wx.getStorageSync(SESSION_KEY) || null;
}

function setSession(user) {
  wx.setStorageSync(SESSION_KEY, user);
}

function clearSession() {
  wx.removeStorageSync(SESSION_KEY);
}

/* ---------------- 二维码签到 ---------------- */

function getConfig() {
  const cfg = wx.getStorageSync(CONFIG_KEY);
  return Object.assign({ refreshSeconds: 60 }, cfg || {});
}

function setRefreshSeconds(seconds) {
  const cfg = getConfig();
  cfg.refreshSeconds = seconds;
  wx.setStorageSync(CONFIG_KEY, cfg);
  return cfg;
}

function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return String(h % 900000 + 100000);
}

// 生成当前时间窗口内的签到二维码（教师端展示）
function getQrSession() {
  const config = getConfig();
  const s = config.refreshSeconds || 60;
  const roomId = getDB().room.id;
  const w = Math.floor(Date.now() / (s * 1000));
  const code = hashCode(roomId + '|' + w + '|' + SECRET);
  const expiresAt = (w + 1) * s * 1000;

  return {
    roomId,
    refreshSeconds: s,
    payload: ['LABCHECKIN', roomId, s, w, code].join('|'),
    code,
    expiresAt,
    secondsLeft: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
  };
}

// 校验扫到的二维码内容
function parsePayload(payload) {
  const parts = String(payload || '').split('|');
  if (parts.length !== 5 || parts[0] !== 'LABCHECKIN') {
    throw new Error('不是本教室的签到二维码');
  }

  const roomId = parts[1];
  const s = parseInt(parts[2], 10);
  const w = parseInt(parts[3], 10);
  const code = parts[4];

  if (roomId !== getDB().room.id) throw new Error('不是本教室的签到二维码');
  if (!(s >= 10 && s <= 600)) throw new Error('二维码参数异常');
  if (isNaN(w)) throw new Error('二维码参数异常');

  const expected = hashCode(roomId + '|' + w + '|' + SECRET);
  if (code !== expected) throw new Error('签到码校验失败');

  const expiresAt = (w + 1) * s * 1000;
  if (Date.now() > expiresAt + 15000) {
    throw new Error('二维码已过期，请让老师刷新');
  }

  return true;
}

// 手动输入 6 位签到码：允许当前及前两个时间窗
function validateCode(code) {
  const s = getConfig().refreshSeconds || 60;
  const roomId = getDB().room.id;
  const current = Math.floor(Date.now() / (s * 1000));

  for (let i = 0; i <= 2; i++) {
    if (hashCode(roomId + '|' + (current - i) + '|' + SECRET) === String(code)) {
      return true;
    }
  }
  throw new Error('签到码不正确或已过期');
}

function getCheckinsRaw() {
  return wx.getStorageSync(CHECKIN_KEY) || [];
}

function saveCheckins(list) {
  wx.setStorageSync(CHECKIN_KEY, list);
}

function getMyCheckin(userId) {
  const record = getCheckinsRaw().find(c => c.userId === userId && c.status === 'in');
  return record || null;
}

function checkIn(user, payload, codeOnly) {
  return run(() => {
    if (codeOnly) {
      validateCode(payload);
    } else {
      parsePayload(payload);
    }

    const list = getCheckinsRaw();
    const active = list.find(c => c.userId === user.id && c.status === 'in');
    if (active) {
      if (active.seatCode) throw new Error(`你已签到并占用 ${active.seatCode}`);
      return active;
    }

    const record = {
      id: 'c-' + Date.now(),
      userId: user.id,
      name: user.name,
      time: timeNow(),
      seatCode: null,
      status: 'in'
    };
    list.unshift(record);
    saveCheckins(list);
    return record;
  });
}

function getCheckins() {
  return run(() => {
    const list = getCheckinsRaw();
    return {
      list,
      inCount: list.filter(c => c.status === 'in').length,
      seatedCount: list.filter(c => c.status === 'in' && c.seatCode).length,
      outCount: list.filter(c => c.status === 'out').length
    };
  });
}

/* ---------------- 房间与座位 ---------------- */

function getRoom(userId) {
  return run(() => {
    const data = getDB();
    const seats = data.room.seats;
    const mySeat = seats.find(s => s.occupant && s.occupant.userId === userId) || null;

    const stats = {
      total: seats.length,
      free: seats.filter(s => s.status === 'free').length,
      occupied: seats.filter(s => s.status === 'occupied').length,
      broken: seats.filter(s => s.status === 'broken').length
    };

    return { room: data.room, stats, mySeat, myCheckin: getMyCheckin(userId) };
  });
}

function takeSeat(code, user) {
  return run(() => {
    const checkin = getMyCheckin(user.id);
    if (!checkin) {
      throw new Error('请先扫描教室二维码签到');
    }

    const data = getDB();
    const seats = data.room.seats;
    const seat = seats.find(s => s.code === code);
    if (!seat) throw new Error('座位不存在');

    const mine = seats.find(s => s.occupant && s.occupant.userId === user.id);
    if (mine) throw new Error(`你已占用 ${mine.code}，请先退座`);
    if (seat.status === 'broken') throw new Error('该座位电脑故障，暂不可用');
    if (seat.status === 'occupied') throw new Error('该座位已被占用');

    seat.status = 'occupied';
    seat.occupant = { userId: user.id, name: user.name, time: timeNow() };
    save(data);

    const list = getCheckinsRaw();
    const record = list.find(c => c.userId === user.id && c.status === 'in');
    if (record) {
      record.seatCode = code;
      record.seatTime = seat.occupant.time;
      saveCheckins(list);
    }
    return seat;
  });
}

function markCheckinOut(userId) {
  const list = getCheckinsRaw();
  let changed = false;
  list.forEach(c => {
    if (c.userId === userId && c.status === 'in') {
      c.status = 'out';
      c.seatCode = null;
      c.outTime = timeNow();
      changed = true;
    }
  });
  if (changed) saveCheckins(list);
}

function releaseSeat(code, userId) {
  return run(() => {
    const data = getDB();
    const seat = data.room.seats.find(s => s.code === code);
    if (!seat || !seat.occupant) throw new Error('该座位当前无人使用');
    if (seat.occupant.userId !== userId) throw new Error('只能释放自己的座位');

    seat.status = 'free';
    seat.occupant = null;
    save(data);
    markCheckinOut(userId);
    return true;
  });
}

// 教师强制退座
function forceRelease(code) {
  return run(() => {
    const data = getDB();
    const seat = data.room.seats.find(s => s.code === code);
    if (!seat || !seat.occupant) throw new Error('该座位当前无人使用');

    const name = seat.occupant.name;
    const uid = seat.occupant.userId;
    seat.status = 'free';
    seat.occupant = null;
    save(data);
    markCheckinOut(uid);
    return name;
  });
}

function getOccupied() {
  return run(() => {
    const data = getDB();
    return data.room.seats
      .filter(s => s.status === 'occupied')
      .map(s => ({
        code: s.code,
        row: s.row,
        col: s.col,
        name: s.occupant.name,
        time: s.occupant.time,
        userId: s.occupant.userId,
        pcStatus: s.pcStatus
      }));
  });
}

/* ---------------- 预约选座 ---------------- */

const RESERVE_KEY = 'lab_reservations_v1';
const BOOK_DAYS = 7;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 把「日期 + 时间」转成 Date，便于比较先后
function toTime(dateStr, timeStr) {
  const parts = String(dateStr).split('-').map(Number);
  const hm = String(timeStr).split(':').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], hm[0], hm[1], 0, 0);
}

function weekdayText(d) {
  return '周' + '日一二三四五六'.charAt(d.getDay());
}

// 可选日期：今天起 7 天
function getDateOptions() {
  const today = new Date();
  const list = [];

  for (let i = 0; i < BOOK_DAYS; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    let label = weekdayText(d);
    if (i === 0) label = '今天';
    else if (i === 1) label = '明天';
    else if (i === 2) label = '后天';

    list.push({
      date: dateKey(d),
      label,
      md: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      weekday: weekdayText(d)
    });
  }
  return list;
}

// 可选时段：08:00-22:00，每小时一段
function getSlots() {
  const slots = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    slots.push({
      start: `${pad(h)}:00`,
      end: `${pad(h + 1)}:00`,
      label: `${pad(h)}:00`,
      range: `${pad(h)}:00-${pad(h + 1)}:00`
    });
  }
  return slots;
}

function getReservationsRaw() {
  return wx.getStorageSync(RESERVE_KEY) || [];
}

function saveReservations(list) {
  wx.setStorageSync(RESERVE_KEY, list);
}

// 某日期某时段已被预约的座位
function getSeatBookings(date, start) {
  const map = {};
  getReservationsRaw().forEach(r => {
    if (r.date === date && r.start === start && r.status === 'booked') {
      map[r.seatCode] = r;
    }
  });
  return map;
}

function getMyReservation(userId, date, start) {
  return getReservationsRaw().find(r =>
    r.userId === userId && r.date === date && r.start === start && r.status === 'booked'
  ) || null;
}

function decorateReservation(r) {
  const startAt = toTime(r.date, r.start).getTime();
  const endAt = toTime(r.date, r.end).getTime();
  const now = Date.now();

  let state = 'upcoming';
  let stateText = '待使用';
  if (r.status === 'cancelled') {
    state = 'cancelled';
    stateText = '已取消';
  } else if (now > endAt) {
    state = 'done';
    stateText = '已结束';
  } else if (now >= startAt) {
    state = 'ongoing';
    stateText = '进行中';
  }

  return Object.assign({}, r, {
    state,
    stateText,
    initial: (r.name || '').slice(0, 1)
  });
}

// 预约面板：某时段全部预约 + 我的预约 + 我的订阅
function getSlotBoard(userId, date, start) {
  return run(() => {
    const bookings = getSeatBookings(date, start);
    return {
      bookings,
      mine: getMyReservation(userId, date, start),
      subs: getSlotSubscriptions(userId, date, start)
    };
  });
}

function createReservation(user, seatCode, date, start) {
  return run(() => {
    const dates = getDateOptions();
    if (!dates.some(d => d.date === date)) throw new Error('只能预约未来 7 天内的时段');

    const slot = getSlots().find(s => s.start === start);
    if (!slot) throw new Error('该时段不存在');

    if (toTime(date, start).getTime() <= Date.now()) {
      throw new Error('该时段已开始，请选择后面的时段');
    }

    const data = getDB();
    const seat = data.room.seats.find(s => s.code === seatCode);
    if (!seat) throw new Error('座位不存在');
    if (seat.status === 'broken') throw new Error('该座位电脑故障，暂不可预约');

    const list = getReservationsRaw();
    const mine = list.find(r =>
      r.userId === user.id && r.date === date && r.start === start && r.status === 'booked'
    );
    if (mine) throw new Error(`你在该时段已预约 ${mine.seatCode}`);

    const conflict = list.find(r =>
      r.seatCode === seatCode && r.date === date && r.start === start && r.status === 'booked'
    );
    if (conflict) throw new Error('该座位该时段已被预约');

    const record = {
      id: 'r-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      userId: user.id,
      name: user.name,
      seatCode: seat.code,
      date,
      start: slot.start,
      end: slot.end,
      status: 'booked',
      createdAt: timeNow()
    };
    list.unshift(record);
    saveReservations(list);
    return record;
  });
}

function cancelReservation(id, userId, isTeacher) {
  return run(() => {
    const list = getReservationsRaw();
    const item = list.find(r => r.id === id);
    if (!item) throw new Error('预约不存在');
    if (item.status !== 'booked') throw new Error('该预约已结束');
    if (!isTeacher && item.userId !== userId) throw new Error('只能取消自己的预约');
    if (Date.now() > toTime(item.date, item.end).getTime()) throw new Error('该预约已过期');

    item.status = 'cancelled';
    item.cancelTime = timeNow();
    saveReservations(list);
    releaseSubscriptions(item.seatCode, item.date, item.start);
    return item;
  });
}

// 我的预约：待使用 / 历史
function getMyReservations(userId) {
  return run(() => {
    const all = getReservationsRaw()
      .filter(r => r.userId === userId)
      .map(decorateReservation);

    const current = all
      .filter(r => r.state === 'upcoming' || r.state === 'ongoing')
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

    const history = all
      .filter(r => r.state === 'done' || r.state === 'cancelled')
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));

    return { current, history };
  });
}

// 教师端：按日期查看预约
function getReservationsByDate(date) {
  return run(() => {
    const list = getReservationsRaw()
      .filter(r => r.date === date && r.status === 'booked')
      .map(decorateReservation)
      .sort((a, b) => a.start.localeCompare(b.start));

    const seats = list
      .map(r => r.seatCode)
      .filter((code, index, arr) => arr.indexOf(code) === index);

    return { list, count: list.length, seats: seats.length };
  });
}

/* ---------------- 站内订阅 ---------------- */

const SUB_KEY = 'lab_subscriptions_v1';

function getSubscriptionsRaw() {
  return wx.getStorageSync(SUB_KEY) || [];
}

function saveSubscriptions(list) {
  wx.setStorageSync(SUB_KEY, list);
}

function decorateSubscription(sub) {
  const startAt = toTime(sub.date, sub.start).getTime();
  const endAt = toTime(sub.date, sub.end).getTime();
  const now = Date.now();

  let state = sub.status;
  let stateText = '等待释放';

  if (sub.status === 'cancelled') {
    state = 'cancelled';
    stateText = '已取消';
  } else if (sub.status === 'ready') {
    if (now > endAt) {
      state = 'expired';
      stateText = '已失效';
    } else {
      state = 'ready';
      stateText = '已释放';
    }
  } else if (sub.status === 'waiting' && now >= startAt) {
    state = 'expired';
    stateText = '已失效';
  }

  return Object.assign({}, sub, { state, stateText });
}

// 某个座位当前时段我的订阅（用于预约页展示）
function getSlotSubscriptions(userId, date, start) {
  const map = {};
  getSubscriptionsRaw().forEach(sub => {
    if (
      sub.userId === userId &&
      sub.date === date &&
      sub.start === start &&
      (sub.status === 'waiting' || sub.status === 'ready')
    ) {
      map[sub.seatCode] = decorateSubscription(sub);
    }
  });
  return map;
}

// 预约被取消时，唤醒订阅该座位的同学
function releaseSubscriptions(seatCode, date, start) {
  const list = getSubscriptionsRaw();
  let changed = false;

  list.forEach(sub => {
    if (
      sub.seatCode === seatCode &&
      sub.date === date &&
      sub.start === start &&
      sub.status === 'waiting'
    ) {
      sub.status = 'ready';
      sub.readyAt = timeNow();
      sub.notified = false;
      changed = true;
    }
  });

  if (changed) saveSubscriptions(list);
}

function createSubscription(user, seatCode, date, start) {
  return run(() => {
    const dates = getDateOptions();
    if (!dates.some(d => d.date === date)) throw new Error('只能订阅未来 7 天内的时段');

    const slot = getSlots().find(s => s.start === start);
    if (!slot) throw new Error('该时段不存在');

    if (toTime(date, start).getTime() <= Date.now()) {
      throw new Error('该时段已开始，无法订阅');
    }

    const data = getDB();
    const seat = data.room.seats.find(s => s.code === seatCode);
    if (!seat) throw new Error('座位不存在');
    if (seat.status === 'broken') throw new Error('该座位电脑故障，无需订阅');

    const reservation = getReservationsRaw().find(r =>
      r.seatCode === seatCode && r.date === date && r.start === start && r.status === 'booked'
    );
    if (!reservation) throw new Error('该座位当前可预约，无需订阅');
    if (reservation.userId === user.id) throw new Error('这是你自己的预约');

    const list = getSubscriptionsRaw();
    const exists = list.find(s =>
      s.userId === user.id &&
      s.seatCode === seatCode &&
      s.date === date &&
      s.start === start &&
      (s.status === 'waiting' || s.status === 'ready')
    );
    if (exists) throw new Error('你已经订阅过这个座位');

    const record = {
      id: 's-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      userId: user.id,
      name: user.name,
      seatCode: seat.code,
      date,
      start: slot.start,
      end: slot.end,
      status: 'waiting',
      notified: false,
      createdAt: timeNow()
    };
    list.unshift(record);
    saveSubscriptions(list);
    return decorateSubscription(record);
  });
}

function cancelSubscription(id, userId) {
  return run(() => {
    const list = getSubscriptionsRaw();
    const sub = list.find(s => s.id === id);
    if (!sub) throw new Error('订阅不存在');
    if (sub.userId !== userId) throw new Error('只能取消自己的订阅');
    if (sub.status !== 'waiting' && sub.status !== 'ready') throw new Error('该订阅已结束');

    sub.status = 'cancelled';
    sub.cancelTime = timeNow();
    saveSubscriptions(list);
    return true;
  });
}

// 我的订阅：订阅中 / 历史
function getMySubscriptions(userId) {
  return run(() => {
    const all = getSubscriptionsRaw()
      .filter(s => s.userId === userId)
      .map(decorateSubscription);

    const active = all
      .filter(s => s.state === 'waiting' || s.state === 'ready')
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

    const history = all
      .filter(s => s.state === 'expired' || s.state === 'cancelled')
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));

    return { active, history };
  });
}

// 取走「已释放但还没提醒过」的订阅，并标记已提醒
function consumeReadySubscriptions(userId) {
  return run(() => {
    const list = getSubscriptionsRaw();

    const ready = list
      .filter(s => s.userId === userId && s.status === 'ready' && !s.notified)
      .map(decorateSubscription)
      .filter(s => s.state === 'ready');

    if (ready.length) {
      list.forEach(s => {
        if (s.userId === userId && s.status === 'ready') s.notified = true;
      });
      saveSubscriptions(list);
    }

    return ready;
  });
}

/* ---------------- 用户反馈 ---------------- */

const FEEDBACK_KEY = 'lab_feedback_v1';
const FEEDBACK_TYPES = {
  suggest: '功能建议',
  bug: '故障报错',
  other: '其他问题'
};

function getFeedbacksRaw() {
  return wx.getStorageSync(FEEDBACK_KEY) || [];
}

function addFeedback(user, type, content, contact) {
  return run(() => {
    const text = String(content || '').trim();
    if (text.length < 5) throw new Error('请至少填写 5 个字的描述');
    if (text.length > 300) throw new Error('描述最多 300 字');

    const record = {
      id: 'f-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      userId: user.id,
      name: user.name,
      role: user.role,
      type: FEEDBACK_TYPES[type] ? type : 'other',
      typeText: FEEDBACK_TYPES[type] || FEEDBACK_TYPES.other,
      content: text,
      contact: String(contact || '').trim(),
      status: 'pending',
      createdAt: timeNow()
    };

    const list = getFeedbacksRaw();
    list.unshift(record);
    wx.setStorageSync(FEEDBACK_KEY, list);
    return record;
  });
}

function getFeedbacks() {
  return run(() => getFeedbacksRaw());
}

module.exports = {
  init,
  login,
  register,
  getSession,
  setSession,
  clearSession,
  getConfig,
  setRefreshSeconds,
  getQrSession,
  checkIn,
  getCheckins,
  getMyCheckin,
  getRoom,
  takeSeat,
  releaseSeat,
  forceRelease,
  getOccupied,
  getDateOptions,
  getSlots,
  getSlotBoard,
  createReservation,
  cancelReservation,
  getMyReservations,
  getReservationsByDate,
  createSubscription,
  cancelSubscription,
  getMySubscriptions,
  consumeReadySubscriptions,
  addFeedback,
  getFeedbacks
};
