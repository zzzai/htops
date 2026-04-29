# Hermes Gateway Update Runbook

## Goal

用仓库内脚本优雅更新 Hermes Agent 网关，避免手工升级时漏掉预检、配置检查和回滚信息。

## Script

```bash
bash /root/htops/ops/update-hermes-gateway.sh
```

## Recommended Flow

先看 dry-run：

```bash
bash /root/htops/ops/update-hermes-gateway.sh --dry-run --allow-dirty
```

确认输出里的以下字段正常：

- `before_version`
- `before_commit`
- `service_name`
- `rollback_file`

再执行正式更新：

```bash
bash /root/htops/ops/update-hermes-gateway.sh
```

## Flags

- `--dry-run`
  - 只做预检和版本采样，不执行更新、不重启服务。
- `--skip-restart`
  - 完成更新和校验，但跳过 `systemctl restart`。
- `--allow-dirty`
  - 允许在 Hermes 源码目录存在未提交改动时继续执行。
  - 默认不建议使用。默认行为是检测到 dirty tree 直接失败。

## What The Script Does

1. 读取 `.env.runtime` 和当前网关服务名
2. 记录更新前版本和 commit
3. 备份 `config.yaml`、`.env`、回滚信息
4. 执行官方 `hermes update`
5. 如官方更新失败，回退到 `git pull --ff-only + submodule update + uv pip install -e ".[all]"`
6. 再跑 `hermes config check` / `hermes doctor`
7. 重启 `hermes-gateway.service`
8. 输出更新后版本、commit 和回滚提示

## Rollback

脚本会输出 `rollback_hint`，也会把回滚元信息写入：

```bash
cat <rollback_file>
```

如果要手工回退，按脚本输出的 `rollback_hint` 执行。
