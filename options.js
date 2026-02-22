const DEFAULT_PORT = 18792
const DEFAULT_CHAT_BASE_PORTS = [18789, 19001]

function clampPort(value) {
  const n = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_PORT
  if (n <= 0 || n > 65535) return DEFAULT_PORT
  return n
}

function updateRelayUrl(port) {
  const el = document.getElementById('relay-url')
  if (!el) return
  el.textContent = `http://127.0.0.1:${port}/`
}

function relayHeaders(token) {
  const t = String(token || '').trim()
  if (!t) return {}
  return { 'x-openclaw-relay-token': t }
}

function setStatus(kind, message) {
  const status = document.getElementById('status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

function setTabStatus(kind, message) {
  const status = document.getElementById('tab-status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

function setBackupStatus(kind, message) {
  const status = document.getElementById('backup-status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

function setBuildStatus(kind, message) {
  const status = document.getElementById('build-status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

function setQuickStatus(kind, message) {
  const status = document.getElementById('quick-status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

function setQuickIndicator(id, text) {
  const el = document.getElementById(id)
  if (!el) return
  el.textContent = text
}

function setLastAttachError(text) {
  const el = document.getElementById('last-attach-error')
  if (!el) return
  el.textContent = text || 'none'
}

async function loadDebugLog() {
  const stored = await chrome.storage.local.get(['debugLog'])
  const rows = Array.isArray(stored.debugLog) ? stored.debugLog : []
  const el = document.getElementById('debug-log')
  if (el) el.value = rows.join('\n')
}

function setChatStatus(kind, message) {
  const status = document.getElementById('chat-status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

async function renderAssignments() {
  const container = document.getElementById('tab-assignments')
  if (!container) return
  const stored = await chrome.storage.local.get(['relayPortByTabId', 'gatewayTokenByTabId'])
  const portByTab = stored.relayPortByTabId || {}
  const tokenByTab = stored.gatewayTokenByTabId || {}
  const tabs = await chrome.tabs.query({ currentWindow: true })
  const rows = []
  for (const tab of tabs) {
    if (!tab.id) continue
    if (portByTab[tab.id] === undefined && tokenByTab[tab.id] === undefined) continue
    const port = portByTab[tab.id] ?? ''
    const token = tokenByTab[tab.id] ? '••••' : ''
    rows.push(`#${tab.id} • ${port} ${token} • ${tab.title || tab.url || ''}`)
  }
  container.textContent = rows.length ? rows.join('\n') : 'No per-tab assignments found.'
}

async function exportSettings() {
  const stored = await chrome.storage.local.get([
    'relayPort',
    'gatewayToken',
    'relayPortByTabId',
    'gatewayTokenByTabId',
    'autoOpenChatBrowsers',
    'chatBrowserUrls',
    'chatBrowserBasePorts',
  ])
  const payload = {
    exportedAt: new Date().toISOString(),
    relayPort: stored.relayPort ?? null,
    gatewayToken: stored.gatewayToken ?? null,
    relayPortByTabId: stored.relayPortByTabId || {},
    gatewayTokenByTabId: stored.gatewayTokenByTabId || {},
    autoOpenChatBrowsers: stored.autoOpenChatBrowsers ?? true,
    chatBrowserUrls: stored.chatBrowserUrls || [],
    chatBrowserBasePorts: stored.chatBrowserBasePorts || [],
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'openclaw-relay-settings.json'
  a.click()
  URL.revokeObjectURL(url)
  setBackupStatus('ok', 'Settings exported.')
}

async function importSettings(file) {
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    await chrome.storage.local.set({
      relayPort: data.relayPort ?? DEFAULT_PORT,
      gatewayToken: data.gatewayToken ?? '',
      relayPortByTabId: data.relayPortByTabId || {},
      gatewayTokenByTabId: data.gatewayTokenByTabId || {},
      autoOpenChatBrowsers: data.autoOpenChatBrowsers ?? true,
      chatBrowserUrls: data.chatBrowserUrls || [],
      chatBrowserBasePorts: data.chatBrowserBasePorts || [],
    })
    setBackupStatus('ok', 'Settings imported.')
    await load()
  } catch (err) {
    setBackupStatus('error', `Import failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function checkRelayReachable(port, token) {
  const url = `http://127.0.0.1:${port}/json/version`
  const trimmedToken = String(token || '').trim()
  if (!trimmedToken) {
    setStatus('error', 'Gateway token required. Save your gateway token to connect.')
    return
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1200)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: relayHeaders(trimmedToken),
      signal: ctrl.signal,
    })
    if (res.status === 401) {
      setStatus('error', 'Gateway token rejected. Check token and save again.')
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setStatus('ok', `Relay reachable and authenticated at http://127.0.0.1:${port}/`)
  } catch {
    setStatus(
      'error',
      `Relay not reachable/authenticated at http://127.0.0.1:${port}/. Start OpenClaw browser relay and verify token.`,
    )
  } finally {
    clearTimeout(t)
  }
}

async function checkRelayReachableSilent(port, token) {
  const url = `http://127.0.0.1:${port}/json/version`
  const trimmedToken = String(token || '').trim()
  if (!trimmedToken) return { ok: false, status: 0 }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1200)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: relayHeaders(trimmedToken),
      signal: ctrl.signal,
    })
    return { ok: res.ok, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  } finally {
    clearTimeout(t)
  }
}

async function load() {
  const stored = await chrome.storage.local.get([
    'relayPort',
    'gatewayToken',
    'forkFeatures',
    'autoOpenChatBrowsers',
    'chatBrowserUrls',
    'chatBrowserBasePorts',
    'lastAttachError',
  ])
  const port = clampPort(stored.relayPort)
  const token = String(stored.gatewayToken || '').trim()
  document.getElementById('port').value = String(port)
  document.getElementById('token').value = token
  document.getElementById('quick-token').value = token
  updateRelayUrl(port)
  await checkRelayReachable(port, token)
  const autoOpen = stored.autoOpenChatBrowsers ?? true
  document.getElementById('auto-open').checked = Boolean(autoOpen)
  const basePorts = Array.isArray(stored.chatBrowserBasePorts) && stored.chatBrowserBasePorts.length
    ? stored.chatBrowserBasePorts
    : DEFAULT_CHAT_BASE_PORTS
  document.getElementById('chat-base-ports').value = basePorts.join('\n')
  const urls = Array.isArray(stored.chatBrowserUrls) && stored.chatBrowserUrls.length
    ? stored.chatBrowserUrls
    : basePorts.map((port) => `http://127.0.0.1:${port}/__openclaw__/canvas/`)
  document.getElementById('chat-urls').value = urls.join('\n')

  if (stored.forkFeatures?.version) {
    setBuildStatus('ok', `Fork features enabled: ${stored.forkFeatures.version}`)
  } else {
    setBuildStatus('error', 'Fork features missing — extension may have been overwritten.')
  }

  if (stored.lastAttachError?.message) {
    setLastAttachError(`${stored.lastAttachError.message} (${stored.lastAttachError.at || 'unknown time'})`)
  } else {
    setLastAttachError('none')
  }

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabId = active?.id
  if (tabId) {
    const tabStored = await chrome.storage.local.get(['relayPortByTabId', 'gatewayTokenByTabId'])
    const portByTab = tabStored.relayPortByTabId || {}
    const tokenByTab = tabStored.gatewayTokenByTabId || {}
    const tabPort = clampPort(portByTab[tabId] ?? port)
    const tabToken = String((tokenByTab[tabId] ?? token) || '').trim()
    document.getElementById('tab-port').value = String(tabPort)
    document.getElementById('tab-token').value = tabToken
    setTabStatus('ok', `Loaded settings for tab ${tabId}`)
  }
  await renderAssignments()
  await loadDebugLog()

  const quickToken = String(document.getElementById('quick-token').value || '').trim()
  if (quickToken) {
    const coding = await checkRelayReachableSilent(18789, quickToken)
    const research = await checkRelayReachableSilent(19001, quickToken)
    setQuickIndicator(
      'quick-gateway',
      coding.ok || research.ok ? 'Gateway: connected' : 'Gateway: offline',
    )
    setQuickIndicator('quick-coding', coding.ok ? 'Coding chat: ready' : 'Coding chat: offline')
    setQuickIndicator(
      'quick-research',
      research.ok ? 'Research chat: ready' : 'Research chat: offline',
    )
  } else {
    setQuickIndicator('quick-gateway', 'Gateway: unknown')
    setQuickIndicator('quick-coding', 'Coding chat: unknown')
    setQuickIndicator('quick-research', 'Research chat: unknown')
  }
}

async function save() {
  const portInput = document.getElementById('port')
  const tokenInput = document.getElementById('token')
  const port = clampPort(portInput.value)
  const token = String(tokenInput.value || '').trim()
  await chrome.storage.local.set({ relayPort: port, gatewayToken: token })
  portInput.value = String(port)
  tokenInput.value = token
  updateRelayUrl(port)
  await checkRelayReachable(port, token)
}

async function quickConnect() {
  const token = String(document.getElementById('quick-token').value || '').trim()
  if (!token) return setQuickStatus('error', 'Enter a gateway token first.')
  await chrome.storage.local.set({
    gatewayToken: token,
    relayPort: 18789,
    chatBrowserBasePorts: DEFAULT_CHAT_BASE_PORTS,
    autoOpenChatBrowsers: true,
  })
  const coding = await checkRelayReachableSilent(18789, token)
  const research = await checkRelayReachableSilent(19001, token)
  if (coding.ok && research.ok) {
    setQuickStatus('ok', 'Connected to coding + research gateways.')
  } else if (coding.ok) {
    setQuickStatus('error', 'Connected to coding only. Research gateway not reachable.')
  } else if (research.ok) {
    setQuickStatus('error', 'Connected to research only. Coding gateway not reachable.')
  } else {
    setQuickStatus('error', 'Could not reach gateways. Check token and make sure OpenClaw is running.')
  }
  setQuickIndicator(
    'quick-gateway',
    coding.ok || research.ok ? 'Gateway: connected' : 'Gateway: offline',
  )
  setQuickIndicator('quick-coding', coding.ok ? 'Coding chat: ready' : 'Coding chat: offline')
  setQuickIndicator(
    'quick-research',
    research.ok ? 'Research chat: ready' : 'Research chat: offline',
  )
  await load()
  await loadDebugLog()
}

async function openChatWindow(port) {
  const token = String(document.getElementById('quick-token').value || '').trim()
  if (!token) return setQuickStatus('error', 'Enter a gateway token first.')
  const url = `http://127.0.0.1:${port}/__openclaw__/canvas/`
  await chrome.runtime.sendMessage({ type: 'openChatWindow', port, token, url })
  await loadDebugLog()
}

async function quickFix() {
  const token = String(document.getElementById('quick-token').value || '').trim()
  if (!token) return setQuickStatus('error', 'Enter a gateway token first.')
  await chrome.runtime.sendMessage({ type: 'fixChatConnections', token })
  setQuickStatus('ok', 'Repair triggered. Reopen chat windows if needed.')
  await loadDebugLog()
}

async function saveChatSettings() {
  const autoOpen = Boolean(document.getElementById('auto-open').checked)
  const basePortsRaw = String(document.getElementById('chat-base-ports').value || '')
  const basePorts = basePortsRaw
    .split('\n')
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536)
  const raw = String(document.getElementById('chat-urls').value || '')
  const urls = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  await chrome.storage.local.set({
    autoOpenChatBrowsers: autoOpen,
    chatBrowserUrls: urls,
    chatBrowserBasePorts: basePorts.length ? basePorts : DEFAULT_CHAT_BASE_PORTS,
  })
  setChatStatus('ok', 'Chat browser settings saved.')
}

async function loadTokenFromNative() {
  setQuickStatus('ok', 'Requesting token from OpenClaw…')
  const res = await chrome.runtime.sendMessage({ type: 'loadTokenFromNative' })
  if (!res?.ok) {
    setQuickStatus('error', res?.error || 'Unable to load token from OpenClaw.')
    return
  }
  document.getElementById('quick-token').value = res.token
  await chrome.storage.local.set({ gatewayToken: res.token })
  setQuickStatus('ok', 'Token loaded from OpenClaw.')
  await load()
}

document.getElementById('save').addEventListener('click', () => void save())
document.getElementById('quick-connect').addEventListener('click', () => void quickConnect())
document.getElementById('quick-load-token').addEventListener('click', () => void loadTokenFromNative())
document.getElementById('open-coding').addEventListener('click', () => void openChatWindow(18789))
document.getElementById('open-research').addEventListener('click', () => void openChatWindow(19001))
document.getElementById('open-both').addEventListener('click', async () => {
  await openChatWindow(18789)
  await openChatWindow(19001)
})
document.getElementById('quick-fix').addEventListener('click', () => void quickFix())
document.getElementById('save-chat').addEventListener('click', () => void saveChatSettings())
document.getElementById('refresh-log').addEventListener('click', () => void loadDebugLog())
document.getElementById('clear-log').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clearDebugLog' })
  await loadDebugLog()
})
document.getElementById('assign-tab').addEventListener('click', async () => {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabId = active?.id
  if (!tabId) return setTabStatus('error', 'No active tab found')
  const port = clampPort(document.getElementById('tab-port').value)
  const token = String(document.getElementById('tab-token').value || '').trim()
  const stored = await chrome.storage.local.get(['relayPortByTabId', 'gatewayTokenByTabId'])
  const portByTab = stored.relayPortByTabId || {}
  const tokenByTab = stored.gatewayTokenByTabId || {}
  portByTab[tabId] = port
  tokenByTab[tabId] = token
  await chrome.storage.local.set({ relayPortByTabId: portByTab, gatewayTokenByTabId: tokenByTab })
  setTabStatus('ok', `Assigned tab ${tabId} → port ${port}`)
  await renderAssignments()
})

document.getElementById('clear-tab').addEventListener('click', async () => {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabId = active?.id
  if (!tabId) return setTabStatus('error', 'No active tab found')
  const stored = await chrome.storage.local.get(['relayPortByTabId', 'gatewayTokenByTabId'])
  const portByTab = stored.relayPortByTabId || {}
  const tokenByTab = stored.gatewayTokenByTabId || {}
  delete portByTab[tabId]
  delete tokenByTab[tabId]
  await chrome.storage.local.set({ relayPortByTabId: portByTab, gatewayTokenByTabId: tokenByTab })
  setTabStatus('ok', `Cleared assignment for tab ${tabId}`)
  await renderAssignments()
})

document.getElementById('export-settings').addEventListener('click', () => void exportSettings())
document.getElementById('import-settings').addEventListener('click', () => {
  const input = document.getElementById('import-file')
  input.click()
})
document.getElementById('import-file').addEventListener('change', (ev) => {
  const file = ev.target.files?.[0]
  if (file) void importSettings(file)
})
void load()
