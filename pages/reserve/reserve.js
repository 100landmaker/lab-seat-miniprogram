const db = require('../../utils/db');

function slotTimestamp(date, start) {
  const parts = String(date).split('-').map(Number);
  const hm = String(start).split(':').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], hm[0], hm[1], 0, 0).getTime();
}

Page({
  data: {
    user: null,
    dates: [],
    date: '',
    slots: [],
    slot: '',
    slotEnd: '',
    seats: [],
    mine: null,
    detail: null,
    showDetail: false,
    loading: true
  },

  onLoad() {
    const user = db.getSession();
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    const dates = db.getDateOptions();
    const date = dates[0].date;
    const slot = this.firstAvailable(date) || db.getSlots()[0].start;

    this.setData({
      user,
      dates,
      date,
      slot,
      slotEnd: this.endOfSlot(slot),
      slots: this.markSlots(date)
    });
  },

  onShow() {
    if (this.data.user) this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  endOfSlot(start) {
    const slot = db.getSlots().find(s => s.start === start);
    return slot ? slot.end : '';
  },

  // 该日期第一个还没开始的时段
  firstAvailable(date) {
    const found = db.getSlots().find(s => slotTimestamp(date, s.start) > Date.now());
    return found ? found.start : '';
  },

  markSlots(date) {
    return db.getSlots().map(s => Object.assign({}, s, {
      disabled: slotTimestamp(date, s.start) <= Date.now()
    }));
  },

  load() {
    const { user, date, slot } = this.data;
    if (!user || !date || !slot) return Promise.resolve();

    this.setData({ loading: true });

    return Promise.all([db.getRoom(user.id), db.getSlotBoard(user.id, date, slot)])
      .then(([roomRes, board]) => {
        const uid = user.id;

        const seats = roomRes.room.seats.map(seat => {
          const booked = board.bookings[seat.code];
          const sub = board.subs ? board.subs[seat.code] : null;
          let state = 'free';
          let tagText = '';
          let bookingName = '';

          if (seat.status === 'broken') {
            state = 'broken';
            tagText = '故障';
          } else if (booked && booked.userId === uid) {
            state = 'mine';
            tagText = '我的';
            bookingName = booked.name;
          } else if (booked) {
            state = 'booked';
            tagText = booked.name.slice(0, 1);
            bookingName = booked.name;
          }

          return Object.assign({}, seat, {
            state,
            tagText,
            bookingName,
            subscribed: !!sub,
            subState: sub ? sub.state : '',
            short: seat.no < 10 ? '0' + seat.no : '' + seat.no
          });
        });

        this.setData({
          seats,
          mine: board.mine,
          slots: this.markSlots(date),
          loading: false
        });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  onDate(e) {
    const date = e.currentTarget.dataset.date;
    if (date === this.data.date) return;

    const keep = slotTimestamp(date, this.data.slot) > Date.now();
    const slot = keep ? this.data.slot : this.firstAvailable(date);

    if (!slot) {
      wx.showToast({ title: '该日期已无可用时段', icon: 'none' });
      return;
    }

    this.setData({ date, slot, slotEnd: this.endOfSlot(slot) });
    this.load();
  },

  onSlot(e) {
    const start = e.currentTarget.dataset.start;
    const slot = this.data.slots.find(s => s.start === start);
    if (!slot || slot.disabled) return;
    if (start === this.data.slot) return;

    this.setData({ slot: start, slotEnd: slot.end });
    this.load();
  },

  openSeat(e) {
    const code = e.currentTarget.dataset.code;
    const detail = this.data.seats.find(s => s.code === code);
    if (!detail) return;
    this.setData({ detail, showDetail: true });
  },

  closeSheet() {
    this.setData({ showDetail: false });
  },

  reserve() {
    const { detail, user, date, slot } = this.data;
    if (!detail || detail.state !== 'free') return;

    wx.showModal({
      title: '确认预约',
      content: `${date} ${slot}-${this.data.slotEnd}\n${detail.code}（${detail.row} 排 ${detail.col} 列）`,
      confirmText: '确认预约',
      success: res => {
        if (!res.confirm) return;

        wx.showLoading({ title: '预约中' });
        db.createReservation(user, detail.code, date, slot)
          .then(() => {
            wx.hideLoading();
            this.setData({ showDetail: false });
            wx.showToast({ title: '预约成功', icon: 'success' });
            this.load();
          })
          .catch(err => {
            wx.hideLoading();
            wx.showToast({ title: err.message || '预约失败', icon: 'none' });
          });
      }
    });
  },

  subscribeSeat() {
    const { detail, user, date, slot } = this.data;
    if (!detail || detail.state !== 'booked' || detail.subscribed) return;

    wx.showModal({
      title: '订阅座位',
      content: `${date} ${slot}-${this.data.slotEnd} ${detail.code} 有人退订时，会在小程序内提醒你。`,
      confirmText: '订阅',
      success: res => {
        if (!res.confirm) return;

        db.createSubscription(user, detail.code, date, slot)
          .then(() => {
            this.setData({ showDetail: false });
            wx.showToast({ title: '订阅成功', icon: 'success' });
            this.load();
          })
          .catch(err => wx.showToast({ title: err.message || '订阅失败', icon: 'none' }));
      }
    });
  },

  cancelMine() {
    const mine = this.data.mine;
    if (!mine) return;

    wx.showModal({
      title: '取消预约',
      content: `确认取消 ${mine.seatCode} 的预约？`,
      confirmColor: '#C9362B',
      success: res => {
        if (!res.confirm) return;

        db.cancelReservation(mine.id, this.data.user.id, false)
          .then(() => {
            this.setData({ showDetail: false });
            wx.showToast({ title: '已取消预约', icon: 'success' });
            this.load();
          })
          .catch(err => wx.showToast({ title: err.message || '取消失败', icon: 'none' }));
      }
    });
  },

  goMyBook() {
    wx.navigateTo({ url: '/pages/mybook/mybook' });
  }
});
