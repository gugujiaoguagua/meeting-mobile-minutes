# 会议应用腾讯云测试环境部署

## 目标结构

```text
HTTPS 域名
-> 宿主机 Nginx
-> 127.0.0.1:13000
-> Docker Compose 内 Next.js 服务
-> .local-data 持久化状态文件
```

## 本地检查

```powershell
corepack pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File ".\deploy\new-meeting-publish-package.ps1"
```

## 服务器部署

```bash
sudo mkdir -p /opt/meeting-loop-test
sudo chown -R ubuntu:ubuntu /opt/meeting-loop-test
find /opt/meeting-loop-test -mindepth 1 -maxdepth 1 ! -name .local-data -exec rm -rf {} +
tar -xzf /tmp/meeting-loop-test-publish-YYYYMMDD-HHMMSS.tar.gz -C /opt/meeting-loop-test --strip-components=1
cd /opt/meeting-loop-test
chmod +x ./deploy/deploy-meeting-test-env.sh
./deploy/deploy-meeting-test-env.sh
```

## 验证

```bash
curl -I http://127.0.0.1:13000/
curl -sS http://127.0.0.1:13000/api/state | head
```

## 注意

- `.local-data` 是演示数据目录，部署更新时不能删除。
- 默认关闭真实 DeepSeek：`NEXT_PUBLIC_ENABLE_DEEPSEEK_DRAFT=0`。
- 公网只开放 80/443，不能直接开放 13000。
- 阶段 5 数据库切换前先读 `docs/STAGE5_CUTOVER_ROLLBACK.md`；未完成 `db:import`、`db:verify`、`db:cutover:check` 前保持 `MEETING_STATE_STORE=json`。

## 企业微信消息接入配置

提交复核后发送企业微信文本卡片依赖以下环境变量：

```bash
MEETING_PUBLIC_BASE_URL=https://your-domain.example.com
WECOM_AGENT_ID=你的企业微信应用AgentId
WECOM_TOKEN_API_URL=你的企业微信access_token接口
WECOM_USER_MAP_FILE=config/wecom-user-map.example.json
WECOM_USER_MAP_JSON=
```

`WECOM_USER_MAP_FILE` 当前来自企业微信人员账号人工复核表的 `直接确认` 范围，只包含 `confirmed/high` 人员；`姓名抽检` 和 `需补充` 未纳入。

自动识别企业微信点击人需要企业微信网页授权：

```bash
WECOM_CORP_ID=企业ID
WECOM_OAUTH_STATE_SECRET=随机长密钥
```

如果暂时没有网页授权配置，可先用短期签名链接测试自动登录：

```bash
WECOM_DEEPLINK_SECRET=随机长密钥
```

不要在链接中明文传 `userId` 做自动登录。
