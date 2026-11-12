/**
 * 大模型客户端（OpenAI 兼容接口）
 *
 * 默认对接 DeepSeek，也可以在助手页「AI 设置」里改成任意 OpenAI 兼容服务：
 *   接口地址：https://api.deepseek.com        （自动补 /chat/completions）
 *   模型：deepseek-chat
 *
 * 注意：密钥只保存在本机 storage，仅适合开发/演示；
 * 正式上线请把调用改到自己的后端，避免密钥暴露在小程序包内。
 */

const CONFIG_KEY = 'lab_ai_config_v1';

const DEFAULTS = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
  temperature: 0.3
};

function getConfig() {
  return Object.assign({}, DEFAULTS, wx.getStorageSync(CONFIG_KEY) || {});
}

function saveConfig(patch) {
  const next = Object.assign(getConfig(), patch || {});
  wx.setStorageSync(CONFIG_KEY, next);
  return next;
}

function isReady(config) {
  const cfg = config || getConfig();
  return !!(cfg.enabled && cfg.baseUrl && cfg.model && cfg.apiKey);
}

function endpoint(baseUrl) {
  const url = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (/\/chat\/completions$/.test(url)) return url;
  return url + '/chat/completions';
}

/**
 * 调用大模型
 * @param {Array} messages [{role, content}]
 * @param {object} config 可选，默认读本地配置
 * @returns {Promise<string>}
 */
function chat(messages, config) {
  const cfg = config || getConfig();

  return new Promise((resolve, reject) => {
    wx.request({
      url: endpoint(cfg.baseUrl),
      method: 'POST',
      timeout: 45000,
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey
      },
      data: {
        model: cfg.model,
        messages,
        temperature: Number(cfg.temperature) || 0.3
      },
      success(res) {
        const data = res.data || {};

        if (res.statusCode >= 200 && res.statusCode < 300) {
          const choice = data.choices && data.choices[0];
          const content = choice && choice.message && choice.message.content;
          if (content) {
            resolve(String(content).trim());
          } else {
            reject(new Error('大模型返回内容为空'));
          }
          return;
        }

        const message = (data.error && data.error.message) || ('接口返回 ' + res.statusCode);
        reject(new Error(message));
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络请求失败'));
      }
    });
  });
}

/**
 * 组装带 RAG 上下文的提示词
 * @param {string} question 用户问题
 * @param {Array} contexts 检索到的知识条目
 * @param {string} liveText 实时数据（空位、预约等）
 */
function buildMessages(question, contexts, liveText) {
  const docs = (contexts || []).map((item, index) => {
    return `【资料${index + 1}】${item.question}\n${item.answer}`;
  }).join('\n\n');

  const system = [
    '你是「机房座位预约系统」的智能助手，服务对象是学生和老师。',
    '要求：',
    '1. 优先依据提供的资料回答，不要编造系统没有的功能；',
    '2. 资料不足时明确说明，并给出可行建议；',
    '3. 回答简洁、分点，使用中文；',
    '4. 涉及预约时提醒：可选未来 7 天、每时段 1 小时、同一时段每人限约 1 个座位。'
  ].join('\n');

  const user = [
    '参考资料：',
    docs || '（无）',
    '',
    '实时数据：',
    liveText || '（无）',
    '',
    '用户问题：' + question
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

module.exports = {
  getConfig,
  saveConfig,
  isReady,
  chat,
  buildMessages
};
