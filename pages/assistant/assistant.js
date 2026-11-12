const db = require('../../utils/db');
const kb = require('../../utils/kb');

Page({
  data: {
    user: null,
    initial: '',
    messages: [],
    quick: [],
    input: '',
    scrollTo: '',
    sending: false
  },

  seq: 0,

  onLoad() {
    const user = db.getSession();
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    this.setData({
      user,
      initial: user.name.slice(0, 1),
      quick: kb.QUICK_QUESTIONS
    });

    this.pushBot('你好，我是实验室座位助手。可以问我预约规则、开放时间、空位情况，也可以帮你查预约。');
  },

  push(role, text) {
    const id = ++this.seq;
    this.setData({
      messages: this.data.messages.concat([{ id, role, text }]),
      scrollTo: 'm' + id
    });
  },

  pushBot(text) {
    this.push('bot', text);
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onConfirm(e) {
    this.sendText(e.detail.value);
  },

  sendTap() {
    this.sendText(this.data.input);
  },

  onQuick(e) {
    this.sendText(e.currentTarget.dataset.text);
  },

  sendText(raw) {
    const text = String(raw || '').trim();
    if (!text || this.data.sending) return;

    this.push('user', text);
    this.setData({ input: '', sending: true });

    kb.ask(text, this.data.user)
      .then(res => this.pushBot(res.text))
      .catch(() => this.pushBot('查询出错了，请稍后再试。'))
      .then(() => this.setData({ sending: false }));
  },

  goReserve() {
    wx.navigateTo({ url: '/pages/reserve/reserve' });
  },

  goMyBook() {
    wx.navigateTo({ url: '/pages/mybook/mybook' });
  }
});
