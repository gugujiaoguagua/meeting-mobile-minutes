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
WECOM_API_BASE_URL=https://qyapi.weixin.qq.com/cgi-bin
WECOM_SYNC_ROOT_DEPARTMENT_ID=1
WECOM_PRESIDENT_USERID=
WECOM_USERID_FROM_EMP_ID=0
WECOM_USER_MAP_FILE=config/wecom-user-map.example.json
WECOM_USER_MAP_JSON=
```

`WECOM_USER_MAP_FILE` 当前来自企业微信人员账号人工复核表的 `直接确认` 范围，只包含 `confirmed/high` 人员；`姓名抽检` 和 `需补充` 未纳入。

同步企业微信组织架构：

```bash
curl -X POST https://your-domain.example.com/api/wecom/org-sync \
  -H "Cookie: meeting_user_id=总裁用户ID"
```

同步逻辑：

- 先从 `WECOM_TOKEN_API_URL` 读取 JSON 返回中的 `Message` 作为 access_token。
- 再调用企业微信 `/department/list` 获取部门，默认根部门 `id=1`。
- 循环部门调用 `/user/list` 获取成员，写入当前启用的数据源：`MEETING_STATE_STORE=db/postgres` 写数据库，否则写 `.local-data/meeting-loop-state.json`。
- 系统内部用户 ID 采用 `emp-企业微信userid`；发送消息优先使用企业微信同步记录或人工映射，不再默认从内部 `emp-` ID 推断企业微信 userid。

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

## 企业微信接收消息回调

在企业微信应用后台的“接收消息”里选择 API 接收：

```bash
URL=https://your-domain.example.com/api/wecom/callback
Token=企业微信后台生成或手填的回调Token
EncodingAESKey=企业微信后台生成的EncodingAESKey
```

服务器 `.env` 同步填写：

```bash
WECOM_CALLBACK_TOKEN=同企业微信后台 Token
WECOM_CALLBACK_ENCODING_AES_KEY=同企业微信后台 EncodingAESKey
WECOM_CALLBACK_RECEIVE_ID=企业ID，可留空复用 WECOM_CORP_ID
```

说明：

- `WECOM_AGENT_ID` 是企业微信应用 ID，用于主动发送应用消息。
- `WECOM_CALLBACK_TOKEN` 是回调签名密钥，不是 access_token。
- `WECOM_TOKEN_API_URL` 返回的 `Message` 或 `access_token` 只能用于主动调用企业微信接口，不能作为接收消息回调 Token。
