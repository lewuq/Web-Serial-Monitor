# Web Serial Monitor

**🌐 [English](README.md) | [中文](README_CN.md)**

Web Serial Monitor is a browser-based serial terminal and real-time data plotting tool. It connects directly to serial devices through the Web Serial API, detects numeric fields in incoming text, and lets you bind any detected field to a plot without depending on a specific microcontroller or development board.

## Version history

| Version | Updated | Highlights |
| --- | --- | --- |
| V0.3.1 | 2026-09-11 | Improved laptop-height responsiveness, kept connection controls visible, and fixed plot, History, and Terminal overlap through viewport-aware sizing. |
| V0.3 | 2026-09-11 | Refined visual design, flexible Telemetry Studio layouts, resizable and zoomable plots, a 3D Euler-angle IMU, an expanded component library including PID control, and upgraded Terminal data controls. |
| V0.2 | 2026-09-11 | Telemetry Studio, bilingual UI, light/dark themes, deterministic text parsing, dynamic plots, continuous terminal rendering, and a draggable component canvas. |
| V0.1 | 2026-09-09 | Initial browser-based serial connection, terminal, and real-time numeric plotting. |

## Features

- Connect to serial devices directly from a supported browser.
- Select common baud rates from 9,600 to 921,600 baud.
- View live RX, TX, and system messages in the terminal.
- Send text or hexadecimal commands to the connected device.
- Plot numeric serial data in real time with zoom, drag-to-pan, and history navigation.
- Detect and bind an arbitrary number of numeric fields.
- Add, remove, or automatically add all available plots.
- Keep continuous terminal output in a bounded buffer, with copy support, UTF-8/GBK decoding, and text/HEX display.
- Parse delimited numbers, labeled key/value logs, grouped sensor logs, and JSON automatically.
- Pause or clear the plot without disconnecting the device.
- Use a built-in demo stream without hardware.
- Preview reusable Button, 3D IMU, Dashboard, Gauge, Status, Slider, PID Controller, and Numeric Readout components.
- Drag component examples into a custom component canvas.
- Switch between light and dark themes.

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

Labels become selectable plot bindings automatically. Both `name=value` and `name:value` are supported. Numeric values may be integers, decimals, signed values, or scientific notation.

### JSON numeric data

```json
{"temp":24,"power":{"voltage":3.3,"current":0.18}}
```

Nested keys become bindings such as `power.voltage` and `power.current`.

### Labeled IMU data

```text
[17:00:39.525] accel(m/s^2) x=-2.076970 y=-5.401797 z=8.956334  gyro(rad/s) x=-0.719293 y=6.750670 z=0.113315
```

This format creates the bindings `accel.x`, `accel.y`, `accel.z`, `gyro.x`, `gyro.y`, and `gyro.z`.

## Getting started

### Run locally

Requirements: Node.js 22.13 or newer and pnpm.

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
6. Use the terminal input to send a command when needed.
7. Click **Disconnect** before unplugging the device.

All serial communication and plotting happen in the browser. The application does not require a device-specific firmware library.
