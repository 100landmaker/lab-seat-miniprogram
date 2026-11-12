const db = require('../../utils/db');

Page({
  data: {
    user: null,
    room: null,
    stats: { total: 0, free: 0, occupied: 0, broken: 0 },
    seats: [],
    occupied: [],
    list: [],
    tab: 'grid',
    keyword: '',
    detail: null,
    showDetail: false,
    loading: true,
    // 签到相关
    qr: null,
    qrUrl: '',
    secondsLeft: 0,
    refreshSeconds: 60,
    intervalOptions: [30, 60, 120, 300],
    checkins: [],
    checkinStats: { inCount: 0, seatedCount: 0, outCount: 0 }
  },

  onLoad() {
    const user = db.getSession();
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    if (user.role !== 'teacher') {
      wx.reLaunch({ url: '/pages/student/student' });
      return;
    }
    this.setData({ user, refreshSeconds: db.getConfig().refreshSeconds });
  },

  onShow() {
    if (!this.data.user) return;
    this.refresh();
    this.startTimer();
  },

  onHide() {
    this.stopTimer();
  },

  onUnload() {
    this.stopTimer();
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  refresh() {
    this.setData({ loading: true });

    return Promise.all([db.getRoom(this.data.user.id), db.getOccupied(), db.getCheckins()])
      .then(([roomRes, occupied, checkinRes]) => {
        const seats = roomRes.room.seats.map(seat => {
          let stateText = '空闲';
          if (seat.status === 'broken') stateText = '电脑故障';
          else if (seat.status === 'occupied') stateText = seat.occupant.name;

          return Object.assign({}, seat, {
            stateText,
            short: seat.no < 10 ? '0' + seat.no : '' + seat.no,
            initial: seat.occupant ? seat.occupant.name.slice(0, 1) : ''
          });
        });

        const occupiedList = occupied.map(item =>
          Object.assign({}, item, { initial: item.name.slice(0, 1) })
        );

        const checkins = checkinRes.list.map(item =>
          Object.assign({}, item, { initial: item.name.slice(0, 1) })
        );

        this.setData({
          room: roomRes.room,
          stats: roomRes.stats,
          seats,
          occupied: occupiedList,
          list: this.filterList(occupiedList, this.data.keyword),
          checkins,
          checkinStats: {
            inCount: checkinRes.inCount,
            seatedCount: checkinRes.seatedCount,
            outCount: checkinRes.outCount
          },
          loading: false
        });

        this.buildQr();
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  /* ---------------- 二维码与倒计时 ---------------- */

  buildQr() {
    const qr = db.getQrSession();
    this.setData({
      qr,
      secondsLeft: qr.secondsLeft,
      refreshSeconds: qr.refreshSeconds,
      qrUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=' + encodeURIComponent(qr.payload)
    });
  },

  startTimer() {
    this.stopTimer();
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.checkinTimer = setInterval(() => this.loadCheckins(), 5000);
  },

  stopTimer() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.checkinTimer) clearInterval(this.checkinTimer);
    this.tickTimer = null;
    this.checkinTimer = null;
  },

  tick() {
    const qr = this.data.qr;
    if (!qr) return;

    const left = Math.ceil((qr.expiresAt - Date.now()) / 1000);
    if (left <= 0) {
      this.buildQr();
      return;
    }
    if (left !== this.data.secondsLeft) {
      this.setData({ secondsLeft: left });
    }
  },

  loadCheckins() {
    db.getCheckins().then(res => {
      const checkins = res.list.map(item =>
        Object.assign({}, item, { initial: item.name.slice(0, 1) })
      );
      this.setData({
        checkins,
        checkinStats: {
          inCount: res.inCount,
          seatedCount: res.seatedCount,
          outCount: res.outCount
        }
      });
    });
  },

  onInterval(e) {
    const seconds = Number(e.currentTarget.dataset.sec);
    db.setRefreshSeconds(seconds);
    this.buildQr();
    wx.showToast({ title: `改为每 ${seconds} 秒刷新`, icon: 'none' });
  },

  /* ---------------- 页面交互 ---------------- */

  filterList(list, keyword) {
    const kw = (keyword || '').trim();
    if (!kw) return list;
    return list.filter(item => item.name.indexOf(kw) > -1 || item.code.indexOf(kw) > -1);
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onSearch(e) {
    const keyword = e.detail.value;
    this.setData({
      keyword,
      list: this.filterList(this.data.occupied, keyword)
    });
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

  forceFromDetail() {
    const detail = this.data.detail;
    if (!detail || !detail.occupant) return;
    this.confirmForce(detail.code, detail.occupant.name);
  },

  forceFromList(e) {
    const { code, name } = e.currentTarget.dataset;
    this.confirmForce(code, name);
  },

  confirmForce(code, name) {
    wx.showModal({
      title: '强制退座',
      content: `确认帮 ${name} 释放 ${code} 座位？该学生的签到也会同步结束。`,
      confirmText: '确认释放',
      confirmColor: '#C9362B',
      success: res => {
        if (!res.confirm) return;
        db.forceRelease(code)
          .then(() => {
            this.setData({ showDetail: false });
            wx.showToast({ title: '已释放座位', icon: 'success' });
            this.refresh();
          })
          .catch(err => wx.showToast({ title: err.message || '操作失败', icon: 'none' }));
      }
    });
  },

  logout() {
    wx.showModal({
      title: '切换账号',
      content: '退出后需要重新登录，确定吗？',
      success: res => {
        if (!res.confirm) return;
        db.clearSession();
        getApp().globalData.user = null;
        wx.reLaunch({ url: '/pages/login/login' });
      }
    });
  }
});
