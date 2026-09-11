# Web Serial Monitor

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="readme-language" queryString>

<TabItem value="en" label="English" default>

Web Serial Monitor is a browser-based serial terminal and real-time data plotting tool. It connects directly to serial devices through the Web Serial API, detects numeric fields in incoming text, and lets you bind any detected field to a plot without depending on a specific microcontroller or development board.

## Version history

| Version | Updated | Highlights |
| --- | --- | --- |
| V0.2 | 2026-09-11 | Telemetry Studio, bilingual UI, light/dark themes, deterministic text parsing, dynamic plots, continuous terminal rendering, and a draggable component canvas. |
| V0.1 | 2026-09-09 | Initial browser-based serial connection, terminal, and real-time numeric plotting. |

## Features

- Connect to serial devices directly from a supported browser.
- Select common baud rates from 9,600 to 921,600 baud.
- View live RX, TX, and system messages in the terminal.
- Send text commands to the connected device.
- Plot numeric serial data in real time with zoom, drag-to-pan, and history navigation.
- Detect and bind an arbitrary number of numeric fields.
- Add, remove, or automatically add all available plots.
- Keep continuous terminal output in a bounded buffer, including a live partial-line preview.
- Parse delimited numbers, labeled key/value logs, grouped sensor logs, and JSON automatically.
- Pause or clear the plot without disconnecting the device.
- Use a built-in demo stream without hardware.
- Preview reusable Button, IMU, Dashboard, Gauge, Status, Slider, and Numeric Readout components.
- Drag component examples into a custom component canvas.
- Switch between light and dark themes.

The component library currently provides interactive examples. Binding every component to custom serial fields is planned for a later release.

## Browser requirements

Web Serial requires a Chromium-based desktop browser, such as Google Chrome or Microsoft Edge. The page must be served from `https://` or `localhost`.

Firefox and Safari do not currently provide the Web Serial API. Serial device access always requires an explicit browser permission from the user.

## Supported data formats

Send one data frame per line. Each frame must end with `\n`, `\r`, or `\r\n`.

### Plain numeric values

Values may be separated by commas, spaces, or semicolons:

```text
24.50,3.30,0.18
```

```cpp
Serial.printf("%.2f,%.2f,%.2f\n", temperature, voltage, current);
```

The detected fields are named `Field 1`, `Field 2`, `Field 3`, and so on.

### Labeled key/value data

```text
temperature=24.50 voltage=3.30 current=0.18
```

Labels become selectable plot bindings automatically.

Both `name=value` and `name:value` are supported. Numeric values may be integers, decimals, signed values, or scientific notation.

### JSON numeric data

```json
{"temp":24,"power":{"voltage":3.3,"current":0.18}}
```

Nested keys become bindings such as `power.voltage` and `power.current`.

### Labeled IMU data

```text
[17:00:39.525] accel(m/s^2) x=-2.076970 y=-5.401797 z=8.956334  gyro(rad/s) x=-0.719293 y=6.750670 z=0.113315
```

```cpp
Serial.printf(
  "accel(m/s^2) x=%.6f y=%.6f z=%.6f  "
  "gyro(rad/s) x=%.6f y=%.6f z=%.6f\n",
  ax, ay, az, gx, gy, gz
);
```

This format creates the bindings `accel.x`, `accel.y`, `accel.z`, `gyro.x`, `gyro.y`, and `gyro.z`.

## Getting started

### Run locally

Requirements:

- Node.js 22.13 or newer
- pnpm

```bash
git clone https://github.com/lewuq/Web-Serial-Monitor.git
cd Web-Serial-Monitor
pnpm install
pnpm dev
```

Open the local URL shown in the terminal with Chrome or Edge.

### Production build

```bash
pnpm build
```

## Usage

1. Open the application in Chrome or Edge.
2. Select the baud rate used by your device.
3. Click **Connect device** and choose a serial port in the browser dialog.
4. Wait for newline-terminated data to arrive.
5. Use **Add**, **Add all**, or each plot selector to bind detected fields.
6. Use the terminal input to send a text command when needed.
7. Click **Disconnect** before unplugging the device.

All serial communication and plotting happen in the browser. The application does not require a device-specific firmware library.

## Development

```bash
pnpm lint
pnpm format
pnpm build
```

Issues and pull requests are welcome. When reporting a parsing problem, include a short sample of the serial output and the expected field names.

</TabItem>

<TabItem value="zh" label="中文">

Web Serial Monitor 是一个运行在浏览器中的串口终端与实时数据绘图工具。它通过 Web Serial API 直接连接串口设备，自动识别输入文本中的数值字段，并允许用户将任意字段绑定到曲线。项目不依赖特定的单片机、开发板或固件库。

## 版本迭代

| 版本 | 更新日期 | 主要内容 |
| --- | --- | --- |
| V0.2 | 2026-09-11 | 遥测工作台、中英文界面、明暗主题、确定性文本解析、动态曲线、持续终端渲染和可拖放组件画布。 |
| V0.1 | 2026-09-09 | 首次提供基于浏览器的串口连接、终端和实时数值绘图功能。 |

## 功能特性

- 直接从支持 Web Serial 的浏览器连接串口设备。
- 支持从 9,600 到 921,600 的常用波特率。
- 在终端中持续查看 RX、TX 和系统消息。
- 向已连接的设备发送文本命令。
- 实时绘制串口数值数据，并支持缩放、拖拽平移和历史浏览。
- 自动识别任意数量的数值字段并进行绑定。
- 自由添加、删除曲线，或一次添加全部可用字段。
- 使用有界缓冲区持续显示终端输出，并显示尚未换行的实时数据片段。
- 自动解析分隔数值、带标签键值、分组传感器日志和 JSON 数据。
- 无需断开设备即可暂停或清空绘图。
- 无硬件时可使用内置 Demo 数据流。
- 提供 Button、IMU、Dashboard、Gauge、Status、Slider 和 Numeric Readout 组件示例。
- 支持将组件示例拖入自定义组件画布。
- 支持明亮与暗夜主题。

组件库目前提供可交互示例。将每个组件自由绑定到串口字段的功能计划在后续版本中加入。

## 浏览器要求

Web Serial 需要桌面端 Chromium 浏览器，例如 Google Chrome 或 Microsoft Edge。页面必须通过 `https://` 或 `localhost` 提供。

Firefox 和 Safari 目前不提供 Web Serial API。访问串口设备时，浏览器始终会要求用户明确授权。

## 支持的数据格式

每行发送一帧数据，并使用 `\n`、`\r` 或 `\r\n` 结束。

### 普通数值数据

数值可以使用逗号、空格或分号分隔：

```text
24.50,3.30,0.18
```

```cpp
Serial.printf("%.2f,%.2f,%.2f\n", temperature, voltage, current);
```

识别后的字段名称为 `Field 1`、`Field 2`、`Field 3`，依此类推。

### 带标签的键值数据

```text
temperature=24.50 voltage=3.30 current=0.18
```

标签会自动成为可选择的绘图绑定字段。

同时支持 `name=value` 和 `name:value`。数值可以是整数、小数、带符号数或科学计数法。

### JSON 数值数据

```json
{"temp":24,"power":{"voltage":3.3,"current":0.18}}
```

嵌套键会生成 `power.voltage`、`power.current` 这样的绑定名称。

### 带标签的 IMU 数据

```text
[17:00:39.525] accel(m/s^2) x=-2.076970 y=-5.401797 z=8.956334  gyro(rad/s) x=-0.719293 y=6.750670 z=0.113315
```

```cpp
Serial.printf(
  "accel(m/s^2) x=%.6f y=%.6f z=%.6f  "
  "gyro(rad/s) x=%.6f y=%.6f z=%.6f\n",
  ax, ay, az, gx, gy, gz
);
```

该格式会生成 `accel.x`、`accel.y`、`accel.z`、`gyro.x`、`gyro.y` 和 `gyro.z` 六个绑定字段。

## 开始使用

### 本地运行

环境要求：

- Node.js 22.13 或更高版本
- pnpm

```bash
git clone https://github.com/lewuq/Web-Serial-Monitor.git
cd Web-Serial-Monitor
pnpm install
pnpm dev
```

使用 Chrome 或 Edge 打开终端中显示的本地地址。

### 生产构建

```bash
pnpm build
```

## 使用方法

1. 使用 Chrome 或 Edge 打开应用。
2. 选择与设备一致的波特率。
3. 点击 **Connect device**，并在浏览器弹窗中选择串口。
4. 等待以换行符结尾的数据到达。
5. 使用 **Add**、**Add all** 或每条曲线的选择框绑定检测到的字段。
6. 需要时通过终端输入框发送文本命令。
7. 拔出设备前点击 **Disconnect**。

所有串口通信和绘图均在浏览器中完成，无需安装针对某款设备的固件库。

## 开发

```bash
pnpm lint
pnpm format
pnpm build
```

欢迎提交 Issue 和 Pull Request。报告解析问题时，请附上一小段串口输出示例以及期望生成的字段名称。

</TabItem>

</Tabs>
