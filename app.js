const db = require('./utils/db');

App({
  globalData: {
    user: null
  },

  onLaunch() {
    db.init();
  }
});
