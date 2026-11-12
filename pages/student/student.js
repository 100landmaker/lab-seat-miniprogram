const db = require('../../utils/db');

Page({
  data: {
    user: null,
    room: null,
    stats: { total: 0, free: 0, occupied: 0, broken: 0 },
    seats: [],
    mySeat: null,
    checkin: null,
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
    this.setData({ user });
  },

  onShow() {
    if (!this.data.user) return;
    this.refresh();
    this.checkSubscriptions();
  },

  // 订阅的座位被释放后，在小程序内提醒
  checkSubscriptions() {
    db.consumeReadySubscriptions(this.data.user.id)
      .then(list => {
        if (!list.length) return;

        const first = list[0];
        const more = list.length > 1 ? `，另有 ${list.length - 1} 个座位也已释放` : '';

        wx.showModal({
          title: '订阅座位已释放',
          content: `${first.date} ${first.start}-${first.end} ${first.seatCode} 已被释放${more}。`,
          confirmText: '去预约',
          cancelText: '稍后',
          success: res => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/reserve/reserve' });
            }
          }
        });
      })
      .catch(() => {});
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  refresh() {
    if (!this.data.user) return Promise.resolve();
    this.setData({ loading: true });

    return db.getRoom(this.data.user.id)
      .then(res => {
        const uid = this.data.user.id;
        const seats = res.room.seats.map(seat => {
          const mine = !!(seat.occupant && seat.occupant.userId === uid);
          let stateText = '空闲可预约';
          if (seat.status === 'broken') stateText = '电脑故障，暂不可用';
          else if (mine) stateText = '我的座位';
          else if (seat.status === 'occupied') stateText = '已被占用';

          return Object.assign({}, seat, {
            mine,
            stateText,
            short: seat.no < 10 ? '0' + seat.no : '' + seat.no,
            initial: seat.occupant ? seat.occupant.name.slice(0, 1) : ''
          });
        });

        this.setData({
          room: res.room,
          stats: res.stats,
          seats,
          mySeat: res.mySeat,
          checkin: res.myCheckin,
          loading: false
        });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
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

  // 扫码签到：扫教室大屏上的二维码
  scanCheckIn() {
    wx.scanCode({
      scanType: ['qrCode'],
      success: res => this.submitCheckin(res.result, false),
      fail: () => {
        wx.showToast({ title: '未识别到二维码', icon: 'none' });
      }
    });
  },

  // 备用：手动输入 6 位签到码
  manualCheckIn() {
    wx.showModal({
      title: '手动签到',
      editable: true,
      placeholderText: '输入二维码下方的 6 位签到码',
      success: res => {
        if (!res.confirm) return;
        const code = (res.content || '').trim();
        if (code.length !== 6) {
          wx.showToast({ title: '请输入 6 位签到码', icon: 'none' });
          return;
        }
        this.submitCheckin(code, true);
      }
    });
  },

  submitCheckin(payload, codeOnly) {
    wx.showLoading({ title: '签到中' });
    db.checkIn(this.data.user, payload, codeOnly)
      .then(record => {
        wx.hideLoading();
        wx.showToast({ title: '签到成功', icon: 'success' });
        this.setData({ checkin: record });
        this.refresh();
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '签到失败', icon: 'none' });
      });
  },

  takeSeat() {
    const { detail, user, checkin } = this.data;
    if (!detail) return;
    if (!checkin) {
      this.setData({ showDetail: false });
      wx.showModal({
        title: '请先签到',
        content: '需要先扫描教室二维码签到，才能选择座位。',
        confirmText: '去签到',
        success: res => {
          if (res.confirm) this.scanCheckIn();
        }
      });
      return;
    }

    wx.showModal({
      title: '确认选座',
      content: `选择 ${detail.code}（${detail.row} 排 ${detail.col} 列）？`,
      confirmText: '确认选座',
      success: res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '选座中' });
        db.takeSeat(detail.code, user)
          .then(() => {
            wx.hideLoading();
            this.setData({ showDetail: false });
            wx.showToast({ title: '选座成功', icon: 'success' });
            this.refresh();
          })
          .catch(err => {
            wx.hideLoading();
            wx.showToast({ title: err.message || '选座失败', icon: 'none' });
          });
      }
    });
  },

  releaseDetail() {
    const { detail, user } = this.data;
    if (!detail) return;
    this.confirmRelease(detail.code, user.id);
  },

  releaseMine() {
    const seat = this.data.mySeat;
    if (!seat) return;
    this.confirmRelease(seat.code, this.data.user.id);
  },

  confirmRelease(code, uid) {
    wx.showModal({
      title: '确认退座',
      content: `退出 ${code} 座位后，其他人可以继续选择。`,
      confirmText: '确认退座',
      confirmColor: '#C9362B',
      success: res => {
        if (!res.confirm) return;
        db.releaseSeat(code, uid)
          .then(() => {
            this.setData({ showDetail: false });
            wx.showToast({ title: '已退座', icon: 'success' });
            this.refresh();
          })
          .catch(err => wx.showToast({ title: err.message || '退座失败', icon: 'none' }));
      }
    });
  },

  goReserve() {
    wx.navigateTo({ url: '/pages/reserve/reserve' });
  },

  goMyBook() {
    wx.navigateTo({ url: '/pages/mybook/mybook' });
  },

  goAssistant() {
    wx.navigateTo({ url: '/pages/assistant/assistant' });
  },

  goSubscriptions() {
    wx.navigateTo({ url: '/pages/subscribe/subscribe' });
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
