const db = require('../../utils/db');

Page({
  data: {
    user: null,
    types: [
      { key: 'suggest', label: '功能建议' },
      { key: 'bug', label: '故障报错' },
      { key: 'other', label: '其他问题' }
    ],
    type: 'suggest',
    content: '',
    contact: '',
    count: 0,
    submitting: false
  },

  onLoad() {
    const user = db.getSession();
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.setData({ user });
  },

  onType(e) {
    this.setData({ type: e.currentTarget.dataset.key });
  },

  onContent(e) {
    const content = e.detail.value;
    this.setData({ content, count: content.length });
  },

  onContact(e) {
    this.setData({ contact: e.detail.value });
  },

  submit() {
    if (this.data.submitting) return;

    const { user, type, content, contact } = this.data;
    if (content.trim().length < 5) {
      wx.showToast({ title: '请至少填写 5 个字的描述', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    db.addFeedback(user, type, content, contact)
      .then(() => {
        return new Promise(resolve => {
          wx.showModal({
            title: '提交成功',
            content: '感谢反馈，老师可以在教师端看到这条记录。',
            showCancel: false,
            success: () => resolve()
          });
        });
      })
      .then(() => {
        this.setData({ submitting: false });
        wx.navigateBack();
      })
      .catch(err => {
        this.setData({ submitting: false });
        wx.showToast({ title: err.message || '提交失败', icon: 'none' });
      });
  }
});
