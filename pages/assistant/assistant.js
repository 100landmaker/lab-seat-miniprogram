const db = require('../../utils/db');
const kb = require('../../utils/kb');
const ai = require('../../utils/ai');

Page({
  data: {
    user: null,
    initial: '',
    messages: [],
    quick: [],
    input: '',
    scrollTo: '',
    sending: false,
    aiReady: false,
    kbCount: 0,
    showSettings: false,
    form: {
      enabled: false,
      baseUrl: '',
      model: '',
      apiKey: ''
    }
  },

  seq: 0,

  onLoad() {
    const user = db.getSession();
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    const config = ai.getConfig();
    this.setData({
      user,
      initial: user.name.slice(0, 1),
      quick: kb.QUICK_QUESTIONS,
      aiReady: ai.isReady(config),
      kbCount: kb.count(),
      form: {
        enabled: !!config.enabled,
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey
      }
    });

    this.pushBot('你好，我是实验室座位助手。我会先检索本地知识库，配置大模型后会自动结合 RAG 资料回答。可以问我预约规则、开放时间、空位情况，或查看你的预约。');
  },

  push(role, text, extra) {
    const id = ++this.seq;
    const message = Object.assign({
      id,
      role,
      text,
      refs: [],
      mode: 'local'
    }, extra || {});

    this.setData({
      messages: this.data.messages.concat([message]),
      scrollTo: 'm' + id
    });
  },

  pushBot(text, result) {
    const res = result || {};
    this.push('bot', text, {
      refs: res.refs || [],
      mode: res.mode || 'local'
    });
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
      .then(res => this.pushBot(res.text, res))
      .catch(() => this.pushBot('查询出错了，请稍后再试。'))
      .then(() => this.setData({ sending: false }));
  },

  /* ---------------- AI 设置 ---------------- */

  openSettings() {
    const config = ai.getConfig();
    this.setData({
      showSettings: true,
      form: {
        enabled: !!config.enabled,
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey
      }
    });
  },

  closeSettings() {
    this.setData({ showSettings: false });
  },

  onSwitch(e) {
    this.setData({ 'form.enabled': e.detail.value });
  },

  onField(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  saveSettings() {
    const form = this.data.form;
    const baseUrl = String(form.baseUrl || '').trim();
    const model = String(form.model || '').trim();
    const apiKey = String(form.apiKey || '').trim();

    if (form.enabled && (!baseUrl || !model || !apiKey)) {
      wx.showToast({ title: '请填写接口地址、模型和密钥', icon: 'none' });
      return;
    }

    const config = ai.saveConfig({
      enabled: !!form.enabled,
      baseUrl,
      model,
      apiKey
    });

    this.setData({ showSettings: false, aiReady: ai.isReady(config) });
    wx.showToast({
      title: config.enabled ? '已启用大模型' : '已切换本地模式',
      icon: 'none'
    });
  },

  goReserve() {
    wx.navigateTo({ url: '/pages/reserve/reserve' });
  },

  goMyBook() {
    wx.navigateTo({ url: '/pages/mybook/mybook' });
  }
});
