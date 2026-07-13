# 邮件提醒后台设置

这个后台使用 Google Apps Script 负责定时、Resend 负责发信。它不会读取或发送你的 Gmail 数据。后台每五分钟检查一次提醒设置，网站关闭后仍会运行，邮件通常会在设定时间后的五分钟内到达。

## 一次性设置

1. 使用准备接收提醒的邮箱注册 [Resend](https://resend.com/)。使用默认的 `onboarding@resend.dev` 发件地址时，只能发给这个 Resend 账号邮箱。
2. 打开 Resend 的 [API Keys](https://resend.com/api-keys)，创建名为 `chonglema-reminder` 的 Key，权限选择 **Sending access**。
3. 立即复制以 `re_` 开头的 API Key；Resend 只会完整显示一次。不要把它发给任何人。
4. 打开 [Google Apps Script](https://script.google.com/) 并新建项目，或者继续使用现有项目。
5. 删除编辑器中的旧代码，把本目录最新版 `Code.gs` 的内容全部复制进去。
6. 修改文件顶部两个配置：
   - `CONFIG.PIN`：至少 12 位、只有自己知道的随机字符串。
   - `CONFIG.RESEND_API_KEY`：粘贴第 3 步的 `re_...` API Key。
7. 保存代码并重新载入 Apps Script 编辑器，让 Google 重新计算权限。新版代码不再包含 `MailApp` 或 Gmail 权限。
8. 在编辑器顶部选择 `setupReminderBackend`，点击“运行”，只授权“连接外部服务”和“管理触发器”。
9. 点击“部署”→“新部署”→ 类型选择“网页应用”。
10. “执行身份”选择“我”，“谁可以访问”选择“任何人”，完成部署并复制以 `/exec` 结尾的网页应用地址。
11. 打开「冲了吗」网站，右上角更多菜单选择“邮件提醒”。
12. 填入 Resend 账号邮箱、提醒时间、网页应用地址和第 6 步的 PIN，然后先发送测试邮件。

如果 Google 仍显示旧的 Gmail 权限，请确认项目中已经完全没有 `MailApp`，保存后关闭并重新打开编辑器。仓库中的 `appsscript.json` 给出了最小权限清单，可在 Apps Script 项目设置中开启“显示 appsscript.json 清单文件”后复制使用。

## 隐私与安全

- 收件邮箱、时间和时区保存在你的 Apps Script 私有项目属性中。
- 安全 PIN 只保存在你的 Apps Script 私有代码与当前填写页面中，网站不会把 PIN 写入本地存储。
- Resend API Key 只放在你的私人 Apps Script 项目中，不会发送给网站。
- Apps Script 只负责调用 Resend API 和管理定时触发器，不会读取 Gmail、Google Drive 或其他账号数据。
- 公开仓库里的 `Code.gs` 必须始终保留占位 PIN 与占位 API Key。

## 修改或停止

- 修改时间：回到网站的“邮件提醒”重新保存。
- 暂停邮件：关闭“启用每日提醒”后保存。
- 完全停止后台：在 Apps Script 左侧“触发器”中删除 `reminderTick`。
- 更新 Apps Script 代码后，需要重新部署一个新版本；网页应用地址通常可以继续使用原部署。

## 常见问题

- 没有收到测试邮件：检查垃圾邮件、Resend Logs、Apps Script 执行记录、网页应用访问权限和安全 PIN。
- Resend 返回 403：默认 `resend.dev` 发件地址只能发送到 Resend 账号自己的邮箱；其他收件人需要验证自己的域名。
- 邮件晚几分钟：后台每五分钟检查一次，这是正常情况。
- 修改 PIN 后无法保存：网站弹窗中的 PIN 也需要同步填写新的值。
