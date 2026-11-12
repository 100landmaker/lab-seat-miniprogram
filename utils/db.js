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
  getOccupied
};
