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

function setLastAttachedTab(text) {
  const el = document.getElementById('last-attached-tab')
  if (!el) return
  el.textContent = text || 'none'
}

async function loadDebugLog() {
  const stored = await chrome.storage.local.get(['debugLog'])
  const rows = Array.isArray(stored.debugLog) ? stored.debugLog : []
  const el = document.getElementById('debug-log')
  if (el) el.value = rows.length ? rows.join('\n') : '(no logs yet)'
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
    'chatBrowserBasePorts',
  ])
  const hasToken = Boolean(stored.gatewayToken)
  if (hasToken && !confirm('The export file will contain your gateway token in plaintext. Do not share this file publicly. Continue?')) {
    return
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    relayPort: stored.relayPort ?? null,
    gatewayToken: stored.gatewayToken ?? null,
    relayPortByTabId: stored.relayPortByTabId || {},
    gatewayTokenByTabId: stored.gatewayTokenByTabId || {},
    chatBrowserBasePorts: stored.chatBrowserBasePorts || [],
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'openclaw-relay-settings.json'
  a.click()
  URL.revokeObjectURL(url)
  setBackupStatus('ok', 'Settings exported. Keep this file private — it contains your token.')
}

async function importSettings(file) {
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('Invalid settings file: expected a JSON object')
    }
    const port = data.relayPort != null ? clampPort(data.relayPort) : DEFAULT_PORT
    const token = typeof data.gatewayToken === 'string' ? data.gatewayToken : ''
    const portByTab = (typeof data.relayPortByTabId === 'object' && data.relayPortByTabId && !Array.isArray(data.relayPortByTabId))
      ? data.relayPortByTabId : {}
    const tokenByTab = (typeof data.gatewayTokenByTabId === 'object' && data.gatewayTokenByTabId && !Array.isArray(data.gatewayTokenByTabId))
      ? data.gatewayTokenByTabId : {}
    const basePorts = Array.isArray(data.chatBrowserBasePorts) ? data.chatBrowserBasePorts.filter(p => typeof p === 'number') : []
    await chrome.storage.local.set({
      relayPort: port,
      gatewayToken: token,
      relayPortByTabId: portByTab,
      gatewayTokenByTabId: tokenByTab,
      chatBrowserBasePorts: basePorts,
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
    'gatewayTokenByPort',
    'forkFeatures',
    'chatBrowserBasePorts',
    'lastAttachError',
    'lastAttachedTab',
  ])
  const port = clampPort(stored.relayPort)
  const token = String(stored.gatewayToken || '').trim()
  document.getElementById('port').value = String(port)
  document.getElementById('token').value = token
  const tokenByPort = stored.gatewayTokenByPort || {}
  document.getElementById('quick-token-coding').value = tokenByPort[18789] || token || ''
  document.getElementById('quick-token-research').value = tokenByPort[19001] || token || ''
  updateRelayUrl(port)
  await checkRelayReachable(port, token)
  const basePorts = Array.isArray(stored.chatBrowserBasePorts) && stored.chatBrowserBasePorts.length
    ? stored.chatBrowserBasePorts
    : DEFAULT_CHAT_BASE_PORTS

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

  if (stored.lastAttachedTab?.tabId) {
    setLastAttachedTab(
      `tab ${stored.lastAttachedTab.tabId} · port ${stored.lastAttachedTab.port || '?'} · ${stored.lastAttachedTab.at || ''}`,
    )
  } else {
    setLastAttachedTab('none')
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

  const codingToken = String(document.getElementById('quick-token-coding').value || '').trim()
  const researchToken = String(document.getElementById('quick-token-research').value || '').trim()
  if (codingToken || researchToken) {
    const coding = await checkRelayReachableSilent(18789, codingToken || token)
    const research = await checkRelayReachableSilent(19001, researchToken || token)
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
  const codingToken = String(document.getElementById('quick-token-coding').value || '').trim()
  const researchToken = String(document.getElementById('quick-token-research').value || '').trim()
  if (!codingToken && !researchToken) {
    return setQuickStatus('error', 'Enter at least one gateway token first.')
  }
  const tokenByPort = { 18789: codingToken, 19001: researchToken }
  await chrome.storage.local.set({
    gatewayToken: codingToken || researchToken,
    gatewayTokenByPort: tokenByPort,
    relayPort: 18789,
    chatBrowserBasePorts: DEFAULT_CHAT_BASE_PORTS,
  })
  const coding = await checkRelayReachableSilent(18789, codingToken || researchToken)
  const research = await checkRelayReachableSilent(19001, researchToken || codingToken)
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
  const token =
    port === 18789
      ? String(document.getElementById('quick-token-coding').value || '').trim()
      : String(document.getElementById('quick-token-research').value || '').trim()
  if (!token) return setQuickStatus('error', 'Enter a gateway token first.')
  const url = `http://127.0.0.1:${port}/__openclaw__/canvas/`
  await chrome.runtime.sendMessage({ type: 'openChatWindow', port, token, url })
  await loadDebugLog()
}

async function quickFix() {
  const codingToken = String(document.getElementById('quick-token-coding').value || '').trim()
  const researchToken = String(document.getElementById('quick-token-research').value || '').trim()
  if (!codingToken && !researchToken) {
    return setQuickStatus('error', 'Enter a gateway token first.')
  }
  await chrome.runtime.sendMessage({ type: 'fixChatConnections', tokenByPort: { 18789: codingToken, 19001: researchToken } })
  setQuickStatus('ok', 'Repair triggered. Reopen chat windows if needed.')
  await loadDebugLog()
}


async function loadTokenFromNative() {
  setQuickStatus('ok', 'Requesting token from OpenClaw…')
  const res = await chrome.runtime.sendMessage({ type: 'loadTokenFromNative' })
  if (!res?.ok) {
    setQuickStatus('error', res?.error || 'Unable to load token from OpenClaw.')
    await loadDebugLog()
    return
  }
  const token = res.token || ''
  const coding = token
  const research = token
  document.getElementById('quick-token-coding').value = coding
  document.getElementById('quick-token-research').value = research
  await chrome.storage.local.set({
    gatewayToken: coding || research,
    gatewayTokenByPort: { 18789: coding, 19001: research },
  })
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
// Auto-open settings removed.
document.getElementById('refresh-log').addEventListener('click', () => void loadDebugLog())
document.getElementById('clear-log').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clearDebugLog' })
  await loadDebugLog()
})
document.getElementById('test-log').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'logDebug', message: 'Test log from options page' })
  await loadDebugLog()
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes.debugLog) void loadDebugLog()
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
