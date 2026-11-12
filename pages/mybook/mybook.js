const db = require('../../utils/db');

Page({
  data: {
    user: null,
    tab: 'current',
    current: [],
    history: [],
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
    if (this.data.user) this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true });

    return db.getMyReservations(this.data.user.id)
      .then(res => {
        this.setData({
          current: res.current,
          history: res.history,
          loading: false
        });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  cancel(e) {
    const { id, code } = e.currentTarget.dataset;

    wx.showModal({
      title: '取消预约',
      content: `确认取消 ${code} 的预约？取消后座位会释放给其他同学。`,
      confirmColor: '#C9362B',
      success: res => {
        if (!res.confirm) return;

        db.cancelReservation(id, this.data.user.id, false)
          .then(() => {
            wx.showToast({ title: '已取消预约', icon: 'success' });
            this.load();
          })
          .catch(err => wx.showToast({ title: err.message || '取消失败', icon: 'none' }));
      }
    });
  },

  goReserve() {
    wx.navigateTo({ url: '/pages/reserve/reserve' });
  }
});
