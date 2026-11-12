const db = require('../../utils/db');

Page({
  data: {
    role: 'student',
    mode: 'login',
    name: '',
    username: '',
    password: '',
    loading: false
  },

  switchRole(e) {
    this.setData({ role: e.currentTarget.dataset.role });
  },

  toRegister() {
    this.setData({ mode: 'register' });
  },

  toLogin() {
    this.setData({ mode: 'login' });
  },

  onName(e) {
    this.setData({ name: e.detail.value });
  },

  onUsername(e) {
    this.setData({ username: e.detail.value });
  },

  onPassword(e) {
    this.setData({ password: e.detail.value });
  },

  submit() {
    if (this.data.loading) return;

    const { role, mode, name, username, password } = this.data;
    if (!username.trim()) {
      wx.showToast({ title: '请输入账号', icon: 'none' });
      return;
    }
    if (password.length < 6) {
      wx.showToast({ title: '密码至少 6 位', icon: 'none' });
      return;
    }

    this.setData({ loading: true });

    const action = mode === 'login'
      ? db.login(username.trim(), password)
      : db.register({ name, username: username.trim(), password, role });

    action
      .then(user => {
        db.setSession(user);
        const app = getApp();
        app.globalData.user = user;
        wx.showToast({ title: mode === 'login' ? '登录成功' : '注册成功', icon: 'success' });
        setTimeout(() => {
          wx.reLaunch({
            url: user.role === 'teacher' ? '/pages/teacher/teacher' : '/pages/student/student'
          });
        }, 500);
      })
      .catch(err => {
        wx.showToast({ title: err.message || '操作失败', icon: 'none' });
      })
      .then(() => {
        this.setData({ loading: false });
      });
  }
});
