# 排行榜服务

这个 Worker 为 GitHub Pages 前端提供共享排行榜。用户选择公开时，数据库只保存：

- 自定义公开 ID
- 连续忍住天数
- 连续冲的天数
- 当前浏览器身份令牌的 SHA-256 摘要

它不会保存每日打卡日期、完整日历或恢复仓数据。用户选择不公开时，会删除该浏览器此前上传的榜单资料；自定义 ID 和完整记录只留在本机。

部署步骤：

1. 在 Cloudflare 创建名为 `chonglema-leaderboard` 的 D1 数据库。
2. 把数据库 ID 填入 `wrangler.jsonc`。
3. 在本目录执行迁移并部署 Worker。
4. 将 Worker 地址填入 `assets/leaderboard-config.js`。

```bash
npx wrangler d1 migrations apply chonglema-leaderboard --remote
npx wrangler deploy
```

排行榜采用荣誉制。服务器会校验 ID 唯一性并保护同一 ID 的修改权，但不会上传完整打卡历史来核验连续天数。
