# NETPIE Robot: ESP8266 / STM32 / Hosted Dashboard

## Architecture

Browser (HTTPS) <--WSS--> Node.js gateway <--MQTT--> NETPIE <--MQTT--> ESP8266 <--UART--> STM32.

The ESP8266 **does not host the website**. The Node gateway serves `public/index.html` and holds a separate NETPIE credential. Do not place NETPIE device credentials in public frontend assets. Run this project as **one persistent Node service** (Render/Railway/VPS), not as a Vercel static site alone.

## NETPIE setup

1. Create an application/group and TWO device keys under the same group on NETPIE: ESP device and gateway device. Do not reuse a client ID across simultaneous MQTT connections.
2. Set the ESP `NETPIE_CLIENT_ID`, `NETPIE_TOKEN` and `NETPIE_SECRET` (if required) in `esp8266_netpie.ino`.
3. Copy `.env.example` to `.env`, populate *gateway* credentials and a strong `DASHBOARD_PASSWORD`.
4. Both use matching `ROBOT_NAMESPACE=robot01` topics:
   - `@msg/robot01/cmd` (gateway publishes single-character `F`, `B`, `L`, `R`, or `S`; never retained)
   - `@msg/robot01/state` (ESP publishes direction)
   - `@msg/robot01/telemetry` (ESP publishes JSON sensor readings)
5. Install ESP8266 Arduino libraries: `PubSubClient`, `SoftwareSerial`, `Adafruit GFX`, `Adafruit SSD1306` (plus ESP8266 board core). Upload the `.ino` sketch. STM32 stays on USART1 @ 57600, 8N1.
6. On the server, run `npm install` and `npm start`. Browse to `http://localhost:3000` for local development; set up HTTPS/WSS for public deployment.
7. Deploy Node service with environment variables on your hosting provider. Ensure the host is always running; sleeping hosts will interrupt control.

## UART protocol retained

ESP8266 RX GPIO12/D6 from STM32 USART1 TX, ESP8266 TX GPIO13/D7 to STM32 USART1 RX, common GND. Movement is ONE character. STM32 telemetry is newline-delimited:

`00125.75,-045.5,+012.7,-176.6\n`

## Safety / security limits

- Start with LEDs only. MQTT through the Internet adds variable latency; the 400 ms gateway and 500 ms ESP software watchdogs are not safety-rated. Add an independent hardware motor enable/stop circuit before real motor control.
- The code does **not** make NETPIE command topics private from other authorized devices in the same NETPIE group. Limit device-group membership and permissions.
- NETPIE's documented endpoint is `mqtt.netpie.io` port 1883 (MQTT) or 1884 (MQTTS). This starter uses **unencrypted MQTT/1883** for compatibility during prototyping. Move to broker-validated TLS (and a CA certificate on ESP8266) before internet-connected production use. A separate persistent Node gateway uses TLS when `MQTT_TLS=true`.
- Never retain movement commands. Commands are repeated while held, so the ESP stops if commands cease. TCP/MQTT can buffer stale commands; for physical motors add a session/sequence/timestamp scheme and test delayed-message behavior.
- Dashboard access uses a password over HTTPS/WSS; this is a minimal prototype, not a hardened public multi-user authentication service. Add rate limiting, account sessions and stronger authorization if publicly exposed.
- OLED I2C defaults to standard ESP8266 pins SDA=D2/GPIO4 and SCL=D1/GPIO5. Software UART remains D6/D7.

Official NETPIE MQTT docs: https://docs.netpie.io/mqtt-api.html
