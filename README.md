# Inkstone Minecraft Plugin

[Inkstone（砚）](https://github.com/Yu-DaTouX/Inkstone) 的 Minecraft 插件：让 agent 开发 Fabric mod 并与运行中的游戏交互。包含 MCP 工具、技能、项目模板与伴随 mod。

## 安装

在砚的「设置 → 能力 → 插件」中安装 Inkstone Minecraft。砚会从本仓库最新 Release 下载 `inkstone-minecraft-plugin.zip`。

## 开发

```bash
npm run typecheck
npm test
```

伴随 mod 需要 JDK 25：

```bash
cd companion-mod && ./gradlew build
cd mc26 && ./gradlew build
```

推送 `v<版本>` 标签（与 `package.json` 版本一致）会构建伴随 mod 并发布 Release。

Minecraft 启动器另见 [inkstone-minecraft](https://github.com/Yu-DaTouX/inkstone-minecraft)。

## 许可

MIT
