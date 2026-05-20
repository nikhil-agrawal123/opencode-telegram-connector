interface PendingRequest {
  resolve: (status: "allow" | "deny") => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  createdAt: number
  messageId: number
}

const pending = new Map<string, PendingRequest>()
let polling = false
let lastUpdateId = 0

function getBotToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set")
  return t
}

function getChatId(): string {
  const c = process.env.TELEGRAM_CHAT_ID
  if (!c) throw new Error("TELEGRAM_CHAT_ID is not set")
  return c
}

function bot(method: string, body?: Record<string, unknown>) {
  const token = getBotToken()
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    if (!r.ok) throw new Error("Telegram API " + r.status + ": " + (await r.text().catch(() => "")))
    const d = await r.json()
    if (!d.ok) throw new Error("Telegram API error: " + d.description)
    return d
  })
}

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

async function sendMessage(text: string): Promise<number> {
  const d = await bot("sendMessage", { chat_id: getChatId(), text, parse_mode: "HTML", disable_web_page_preview: true })
  return d.result.message_id
}

async function sendPermissionMessage(text: string, requestId: string): Promise<number> {
  const d = await bot("sendMessage", {
    chat_id: getChatId(),
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: "a:" + requestId },
          { text: "Deny", callback_data: "d:" + requestId },
        ],
      ],
    },
  })
  return d.result.message_id
}

async function editMessage(messageId: number, text: string) {
  await bot("editMessageText", {
    chat_id: getChatId(),
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [] },
  })
}

async function pollLoop() {
  while (polling) {
    try {
      const data = await bot("getUpdates", {
        offset: lastUpdateId,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      })

      for (const update of data.result || []) {
        lastUpdateId = update.update_id + 1

        if (update.callback_query) {
          const cq = update.callback_query
          if (String(cq.from.id) !== getChatId() && String(cq.message?.chat?.id) !== getChatId()) continue
          await bot("answerCallbackQuery", { callback_query_id: cq.id })

          const action = (cq.data || "")[0]
          const rid = (cq.data || "").slice(2)
          const req = pending.get(rid)

          if (req) {
            clearTimeout(req.timer)
            req.resolve(action === "a" ? "allow" : "deny")
            pending.delete(rid)
            await editMessage(cq.message.message_id, action === "a" ? "Approved" : "Denied")
          } else {
            await editMessage(cq.message.message_id, "Request expired")
          }
          continue
        }

        const msg = update.message
        if (!msg?.text || String(msg.chat.id) !== getChatId()) continue

        const lower = msg.text.trim().toLowerCase()
        if (lower === "/pending" || lower === "/status") {
          if (pending.size === 0) {
            await sendMessage("No pending permission requests.")
          } else {
            const lines = [pending.size + " pending request(s):", ""]
            let i = 1
            for (const [id, _req] of pending) {
              const s = Math.round((Date.now() - _req.createdAt) / 1000)
              lines.push(i + ". " + id.slice(0, 8) + "... (" + Math.floor(s / 60) + "m " + s % 60 + "s)")
              i++
            }
            await sendMessage(lines.join("\n"))
          }
        } else if (lower === "/start" || lower === "/help") {
          await sendMessage(
            "opencode Telegram Connector\n\n" +
              "Permission requests appear here with Approve/Deny buttons.\n" +
              "Just tap a button to respond.\n\n" +
              "Commands:\n" +
              "/pending - list active requests",
          )
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''")
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

polling = true
pollLoop()

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 1000
  for (const [id, req] of pending) if (req.createdAt < cutoff) pending.delete(id)
}, 60_000)

sendMessage("opencode Telegram Connector is now active.").catch(() => {})

async function waitForTelegram(requestId: string, messageId: number): Promise<"allow" | "deny"> {
  return new Promise<"allow" | "deny">((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error("timeout"))
    }, 15_000)
    pending.set(requestId, { resolve, reject, timer, createdAt: Date.now(), messageId })
  })
}

function fallbackTerminal(cmd: string): string {
  const escaped = escapeShell(cmd)
  return (
    'echo "Telegram did not respond within 15s." && ' +
    'echo "  Command: ' + cmd.slice(0, 200) + '" && ' +
    'read -t 60 -p "Allow? (y/n): " ans && ' +
    'if [ "$ans" = "y" ]; then eval \'' + escaped + "'; else echo 'Command denied'; fi"
  )
}

function formatPermissionMsg(icon: string, tool: string, detail: string): string {
  return "<b>" + icon + " " + tool + "</b>\n\n<code>" + htmlEscape(detail) + "</code>"
}

const TelegramConnector = async () => {
  return {
    "tool.execute.before": async (input: any, output: any) => {
      const tool = input.tool
      let label: string
      let icon: string
      let detail: string
      let denyAction: (() => void) | null = null

      if (tool === "bash") {
        const cmd = output.args?.command || (typeof output.args === "string" ? output.args : null)
        if (!cmd) return
        icon = "\u{1F6E0}"
        label = "bash"
        detail = String(cmd)
        denyAction = () => { if (output.args) output.args.command = 'echo "Command denied via Telegram"' }
      } else if (tool === "read") {
        const fp = output.args?.filePath || (typeof output.args === "string" ? output.args : null)
        if (!fp) return
        icon = "\u{1F4D6}"
        label = "read"
        detail = String(fp)
        denyAction = () => { if (output.args) output.args.filePath = "/dev/null" }
      } else if (tool === "edit") {
        const fp = output.args?.filePath || ""
        icon = "\u{270F}\u{FE0F}"
        label = "edit"
        detail = fp ? String(fp).slice(0, 500) : "(unknown file)"
        denyAction = () => { if (output.args) output.args.filePath = "/dev/null" }
      } else if (tool === "task") {
        const prompt = output.args?.prompt || output.args?.description || ""
        icon = "\u{1F9E0}"
        label = "task"
        detail = String(prompt).slice(0, 300)
        denyAction = () => { if (output.args) output.args.prompt = "echo denied" }
      } else {
        return
      }

      const requestId = uuid()
      const text = formatPermissionMsg(icon, label, detail)

      let messageId: number
      try {
        messageId = await sendPermissionMessage(text, requestId)
      } catch {
        return
      }

      try {
        const result = await waitForTelegram(requestId, messageId)
        if (result === "deny" && denyAction) denyAction()
      } catch {
        if (tool === "bash") {
          editMessage(messageId, "Timed out - fallback to terminal").catch(() => {})
          if (output.args) output.args.command = fallbackTerminal(detail)
        } else {
          editMessage(messageId, "Timed out - denied").catch(() => {})
          if (denyAction) denyAction()
        }
      }
    },
  }
}

export { TelegramConnector }
