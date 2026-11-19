# Inkstone Minecraft Plugin

[Inkstone（砚）](https://github.com/Yu-DaTouX/Inkstone) 的 Minecraft 插件：让 agent 开发 Fabric mod 并与运行中的游戏交互。包含 MCP 工具、技能、项目模板与伴随 mod。

## 安装

在砚的「设置 → 能力 → 插件」中安装 Inkstone Minecraft。砚会从本仓库最新 Release 下载 `inkstone-minecraft-plugin.zip`。

## 3D 构件编辑

同一 MCP 提供 `scene_create`、`scene_inspect`、`scene_edit`、`scene_query_structure`、`scene_preview` 和 `scene_export`。几何以米为单位，Z 轴向上、沿 X 拉伸；无需启动 Minecraft。结构查询按指定槽位和镜像规则报告局部异常。渲染和 `.blend` 导出需要 Blender（PATH 或 `SCENE3D_BLENDER` 指定可执行文件）。`SCENE3D_OUTPUT` 可指定输出目录；默认使用插件数据目录。场景和修改历史保存在进程内，退出前请导出。尚不支持转成 Minecraft 方块。

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
