# opencode-telegram-connector

Approve/deny opencode tool calls (bash, read, edit, task) directly from Telegram with inline Approve/Deny buttons.

- **15s timeout** — if Telegram doesn't respond, bash falls back to a terminal prompt
- **Per-tool icons** — instantly see what tool is requesting permission
- **Zero terminal prompts** — set permissions to `"allow"` and let Telegram be the gate

---

## Installation

### 1. Create a Telegram bot

Open Telegram, talk to [@BotFather](https://t.me/BotFather) and create a new bot:

```
/newbot
```

Name it something like `opencode-gatekeeper`. Save the **bot token** — it looks like:

```
1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
```

### 2. Get your chat ID

Message your bot once (any message), then open this URL in your browser (replace `<YOUR_TOKEN>`):

```
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```

Find your `chat_id` in the JSON response (it's a number like `123456789`).

### 3. Install the plugin

Add the plugin to your global or project `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-telegram-connector"],
  "permission": {
    "bash": "allow",
    "read": "allow",
    "edit": "allow",
    "task": "allow"
  }
}
```

> Setting permissions to `"allow"` is required — this skips opencode's built-in terminal prompts so Telegram is the sole gatekeeper.

### 4. Set environment variables

Add these to your shell config (`~/.bashrc`, `~/.zshrc`, or `.env`):

```bash
export TELEGRAM_BOT_TOKEN="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
export TELEGRAM_CHAT_ID="123456789"
```

### 5. Restart opencode

Quit and restart opencode. You should see this message in your Telegram chat:

```
opencode Telegram Connector is now active.
```

---

## Usage

Whenever opencode tries to run a tool, the plugin sends a message to Telegram with Approve/Deny buttons:

| Tool   | Icon | Telegram message shows       |
|--------|------|------------------------------|
| bash   | 🛠   | The shell command            |
| read   | 📖   | The file path being read     |
| edit   | ✏️   | The file path being edited   |
| task   | 🧠   | The task description/prompt  |

Tap **Approve** to allow or **Deny** to block the action.

### Timeout behavior

- **0–15s**: Waiting for your tap on Telegram
- **After 15s**: If no response, bash shows a terminal prompt (`Allow? (y/n):`). Other tools are automatically denied.
- The terminal fallback itself waits **60s** for your input.

### Telegram commands

| Command     | Description                        |
|-------------|------------------------------------|
| `/pending`  | List all active permission requests |
| `/help`     | Show help message                  |

---

## Security

- The bot token grants full control of your bot. **Keep it secret.**
- Only messages from your configured `TELEGRAM_CHAT_ID` are processed (callback queries and text commands).
- All communication is over **HTTPS** with Telegram's API.
- Telegraphic approval means an attacker who compromises your Telegram can approve commands — protect your Telegram account with 2FA.

---

## Configuration reference

### `opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-telegram-connector"],
  "permission": {
    "bash": "allow",
    "read": "allow",
    "edit": "allow",
    "task": "allow"
  }
}
```

### Environment variables

| Variable            | Required | Description                     |
|---------------------|----------|---------------------------------|
| `TELEGRAM_BOT_TOKEN`| Yes      | Bot token from @BotFather       |
| `TELEGRAM_CHAT_ID`  | Yes      | Your Telegram user/chat ID      |

---

## Development

```bash
git clone https://github.com/YOUR_USERNAME/opencode-telegram-connector.git
cd opencode-telegram-connector
npm install
```

Link locally for testing:

```bash
npm link
# Then in your opencode config:
# "plugin": ["opencode-telegram-connector"]
```

---

## License

MIT
