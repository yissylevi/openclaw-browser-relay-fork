const DEFAULT_PORT = 18792

const BADGE = {
  on: { text: 'ON', color: '#FF5A36' },
  off: { text: '', color: '#000000' },
  connecting: { text: '…', color: '#F59E0B' },
  error: { text: '!', color: '#B91C1C' },
}

function clampPort(value) {
  const n = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_PORT
  if (n <= 0 || n > 65535) return DEFAULT_PORT
  return n
}

/** @type {Map<string, WebSocket>} */
const relaySockets = new Map()
/** @type {Map<string, Promise<void>>} */
const relayConnectPromises = new Map()

let debuggerListenersInstalled = false

let nextSession = 1

/** @type {Map<number, {state:'connecting'|'connected', sessionId?:string, targetId?:string, attachOrder?:number, relayKey?:string}>} */
const tabs = new Map()
/** @type {Set<number>} */
const attachingTabs = new Set()
/** @type {Map<string, number>} */
const tabBySession = new Map()
/** @type {Map<string, number>} */
const childSessionToTab = new Map()

/** @type {Map<string, Map<number, {resolve:(v:any)=>void, reject:(e:Error)=>void}>>} */
const pendingByRelay = new Map()

const FORK_FEATURES = {
  version: 'openclaw-relay-fork-v1',
  perTabRelay: true,
  allowlist: true,
  retryConnect: true,
}

const DEFAULT_CHAT_BROWSER_URLS = [
  'http://127.0.0.1:18789/__openclaw__/canvas/',
  'http://127.0.0.1:19001/__openclaw__/canvas/',
]

const URL_BLOCKLIST_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'view-source:',
  'chrome-devtools://',
  'https://chrome.google.com/webstore',
  'https://chromewebstore.google.com',
]

const CDP_METHOD_ALLOWLIST = new Set([
  'Runtime.enable',
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Runtime.getProperties',
  'Runtime.releaseObject',
  'Runtime.releaseObjectGroup',
  'Runtime.runIfWaitingForDebugger',
  'Runtime.getIsolateId',
  'Runtime.getHeapUsage',
  'Page.enable',
  'Page.bringToFront',
  'Page.captureSnapshot',
  'Page.getLayoutMetrics',
  'Page.getNavigationHistory',
  'Page.navigate',
  'Page.reload',
  'Page.captureScreenshot',
  'Page.getFrameTree',
  'Page.getResourceTree',
  'Page.getResourceContent',
  'Page.stopLoading',
  'Page.printToPDF',
  'Page.setLifecycleEventsEnabled',
  'Network.enable',
  'Network.disable',
  'Network.getResponseBody',
  'Network.getAllCookies',
  'Network.getCookies',
  'Network.setCookie',
  'Network.deleteCookies',
  'Network.clearBrowserCookies',
  'Network.setExtraHTTPHeaders',
  'Network.setBlockedURLs',
  'Network.emulateNetworkConditions',
  'Network.setCacheDisabled',
  'Network.getSecurityIsolationStatus',
  'Network.getCertificate',
  'Network.setUserAgentOverride',
  'Network.getUserAgentOverride',
  'Network.setBypassServiceWorker',
  'Network.clearBrowserCache',
  'Network.setCookie',
  'Network.getCookies',
  'Network.setCookies',
  'Network.clearBrowserCookies',
  'Target.getTargetInfo',
  'Target.getTargets',
  'Target.attachToTarget',
  'Target.detachFromTarget',
  'Target.setDiscoverTargets',
  'Target.createTarget',
  'Target.closeTarget',
  'Target.activateTarget',
  'DOM.enable',
  'DOM.disable',
  'DOM.getDocument',
  'DOM.querySelector',
  'DOM.querySelectorAll',
  'DOM.getOuterHTML',
  'DOM.getAttributes',
  'DOM.resolveNode',
  'DOM.focus',
  'DOM.scrollIntoViewIfNeeded',
  'CSS.enable',
  'CSS.disable',
  'CSS.getComputedStyleForNode',
  'CSS.getMatchedStylesForNode',
  'CSS.getInlineStylesForNode',
  'Log.enable',
  'Log.disable',
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Emulation.setDeviceMetricsOverride',
  'Emulation.setUserAgentOverride',
  'Emulation.setGeolocationOverride',
  'Emulation.clearGeolocationOverride',
  'Emulation.setTouchEmulationEnabled',
  'Emulation.setLocaleOverride',
  'Emulation.setTimezoneOverride',
])

const CDP_EVENT_ALLOWLIST = new Set([
  'Page.frameNavigated',
  'Page.loadEventFired',
  'Runtime.exceptionThrown',
  'Runtime.consoleAPICalled',
])

const EVENT_RATE_LIMIT_PER_SEC = 20
let eventWindowStart = Date.now()
let eventCountInWindow = 0

async function logDebug(message) {
  const now = new Date().toISOString()
  const stored = await chrome.storage.local.get(['debugLog'])
  const rows = Array.isArray(stored.debugLog) ? stored.debugLog : []
  rows.push(`[${now}] ${message}`)
  const trimmed = rows.slice(-200)
  await chrome.storage.local.set({ debugLog: trimmed })
}

let lastCreateTargetAt = 0
let createTargetCount = 0

// Service worker restart cleanup: detach any orphaned debugger sessions.
try {
  chrome.debugger.getTargets((targets) => {
    for (const t of targets || []) {
      if (t.attached && t.tabId && !tabs.has(t.tabId)) {
        void chrome.debugger.detach({ tabId: t.tabId }).catch(() => {})
      }
    }
  })
} catch {
  // ignore
}

function nowStack() {
  try {
    return new Error().stack || ''
  } catch {
    return ''
  }
}

async function getRelayPort() {
  const stored = await chrome.storage.local.get(['relayPort'])
  const raw = stored.relayPort
  const n = Number.parseInt(String(raw || ''), 10)
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return DEFAULT_PORT
  return n
}

async function getGatewayToken() {
  const stored = await chrome.storage.local.get(['gatewayToken'])
  const token = String(stored.gatewayToken || '').trim()
  return token || ''
}

async function getRelaySettingsForTab(tabId) {
  const stored = await chrome.storage.local.get([
    'relayPort',
    'gatewayToken',
    'relayPortByTabId',
    'gatewayTokenByTabId',
  ])
  const portByTab = stored.relayPortByTabId || {}
  const tokenByTab = stored.gatewayTokenByTabId || {}
  const port = clampPort(portByTab[tabId] ?? stored.relayPort)
  const token = String((tokenByTab[tabId] ?? stored.gatewayToken) || '').trim()
  return { port, token }
}

function relayKeyFor(port, token) {
  return `${port}::${token}`
}

function parsePortFromUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.port) return Number.parseInt(parsed.port, 10)
  } catch {
    return null
  }
  return null
}

function isRestrictedUrl(url) {
  if (!url) return true
  return URL_BLOCKLIST_PREFIXES.some((prefix) => url.startsWith(prefix))
}

async function setTabRelayOverride(tabId, port) {
  const stored = await chrome.storage.local.get(['relayPortByTabId', 'gatewayToken'])
  const portByTab = stored.relayPortByTabId || {}
  portByTab[tabId] = clampPort(port)
  await chrome.storage.local.set({ relayPortByTabId: portByTab })
  const token = String(stored.gatewayToken || '').trim()
  if (token) {
    const tokenByTabStored = await chrome.storage.local.get(['gatewayTokenByTabId'])
    const tokenByTab = tokenByTabStored.gatewayTokenByTabId || {}
    tokenByTab[tabId] = token
    await chrome.storage.local.set({ gatewayTokenByTabId: tokenByTab })
  }
}

async function setTabRelayOverrideWithToken(tabId, port, token) {
  const stored = await chrome.storage.local.get(['relayPortByTabId', 'gatewayTokenByTabId'])
  const portByTab = stored.relayPortByTabId || {}
  const tokenByTab = stored.gatewayTokenByTabId || {}
  portByTab[tabId] = clampPort(port)
  tokenByTab[tabId] = String(token || '').trim()
  await chrome.storage.local.set({ relayPortByTabId: portByTab, gatewayTokenByTabId: tokenByTab })
}

async function attachTabIfNeeded(tabId, relayKey) {
  const existing = tabs.get(tabId)
  if (existing?.state === 'connected') return
  await attachTab(tabId, { relayKey })
}

async function waitForTabComplete(tabId, timeoutMs = 8000) {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (tab?.status === 'complete') return
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      reject(new Error(`Tab ${tabId} load timeout`))
    }, timeoutMs)
    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return
      if (info.status === 'complete') {
        clearTimeout(t)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

async function isDebuggerAttached(tabId) {
  const targets = await chrome.debugger.getTargets().catch(() => [])
  for (const t of targets || []) {
    if (t.tabId === tabId && t.attached) return true
  }
  return false
}

async function isDebuggerAttachedByOther(tabId) {
  const attached = await isDebuggerAttached(tabId)
  if (!attached) return false
  return !tabs.has(tabId)
}

async function attachWithRetry(tabId, relayKey, attempts = 3) {
  const delays = [1200, 2400, 3600]
  for (let i = 0; i < attempts; i += 1) {
    try {
      await logDebug(`attachWithRetry start tab=${tabId} attempt=${i + 1}`)
      await waitForTabComplete(tabId, 8000).catch(() => {})
      if (await isDebuggerAttached(tabId)) {
        if (tabs.has(tabId)) {
          setBadge(tabId, 'on')
          const tabState = tabs.get(tabId)
          const port = tabState?.relayKey ? Number(String(tabState.relayKey).split('::')[0]) : undefined
          if (port) await ensureStatusOverlay(tabId, port, 'attached')
          await logDebug(`attachWithRetry already-attached tab=${tabId}`)
          return
        }
        const err = new Error('Tab already attached by another debugger/extension')
        await chrome.storage.local.set({
          lastAttachError: { tabId, message: err.message, at: new Date().toISOString() },
        })
        setBadge(tabId, 'error')
        await logDebug(`attachWithRetry abort ${err.message} tab=${tabId}`)
        return
      }
      if (i > 0) {
        await new Promise((r) => setTimeout(r, delays[i - 1] || 1200))
      }
      await attachTabIfNeeded(tabId, relayKey)
      if (await isDebuggerAttached(tabId)) {
        setBadge(tabId, 'on')
        const tabState = tabs.get(tabId)
        const port = tabState?.relayKey ? Number(String(tabState.relayKey).split('::')[0]) : undefined
        if (port) await ensureStatusOverlay(tabId, port, 'attached')
        await logDebug(`attachWithRetry success tab=${tabId}`)
        return
      }
      throw new Error('Attach did not complete (debugger still unattached)')
    } catch (err) {
      await chrome.storage.local.set({
        lastAttachError: {
          tabId,
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        },
      })
      await logDebug(
        `attachWithRetry error tab=${tabId} message=${err instanceof Error ? err.message : String(err)}`,
      )
      if (i === attempts - 1) {
        setBadge(tabId, 'error')
      }
    }
  }
}

async function safeAttachActiveTab(port, token) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabId = active?.id
  if (!tabId) throw new Error('No active tab found')

  const tab = await chrome.tabs.get(tabId).catch(() => null)
  const url = tab?.url || ''
  if (isRestrictedUrl(url)) {
    throw new Error(`Cannot attach to restricted URL: ${url || 'unknown'}`)
  }

  if (await isDebuggerAttachedByOther(tabId)) {
    throw new Error('Debugger already attached by another tool (close DevTools and try again).')
  }

  await setTabRelayOverrideWithToken(tabId, port, token)
  await ensureRelayConnection(port, token)
  await attachWithRetry(tabId, relayKeyFor(port, token))
  return { tabId }
}

async function ensureChatBrowsersOpen() {
  const stored = await chrome.storage.local.get([
    'autoOpenChatBrowsers',
    'chatBrowserUrls',
    'chatBrowserBasePorts',
  ])
  const autoOpen = stored.autoOpenChatBrowsers ?? true
  if (!autoOpen) return

  let urls = Array.isArray(stored.chatBrowserUrls) ? stored.chatBrowserUrls : []
  const basePorts = Array.isArray(stored.chatBrowserBasePorts) && stored.chatBrowserBasePorts.length
    ? stored.chatBrowserBasePorts
    : DEFAULT_CHAT_BROWSER_URLS.map((url) => parsePortFromUrl(url)).filter(Boolean)
  if (!urls.length) {
    urls = basePorts.map((port) => `http://127.0.0.1:${Number(port)}/__openclaw__/canvas/`)
    await chrome.storage.local.set({
      chatBrowserUrls: urls,
      chatBrowserBasePorts: basePorts,
      autoOpenChatBrowsers: true,
    })
  }

  const existingTabs = await chrome.tabs.query({})
  for (const url of urls) {
    const normalized = String(url || '').trim()
    if (!normalized) continue
    const alreadyOpen = existingTabs.find((tab) => tab.url && tab.url.startsWith(normalized))
    const port = parsePortFromUrl(normalized)
    if (alreadyOpen?.id && port) {
      await setTabRelayOverride(alreadyOpen.id, port)
      const settings = await getRelaySettingsForTab(alreadyOpen.id)
      if (settings.token) {
        await ensureRelayConnection(settings.port, settings.token)
        await attachWithRetry(alreadyOpen.id, relayKeyFor(settings.port, settings.token))
      }
      continue
    }
    const created = await chrome.windows.create({ url: normalized, focused: false })
    const tabId = created?.tabs?.[0]?.id
    if (tabId && port) {
      await setTabRelayOverride(tabId, port)
      const settings = await getRelaySettingsForTab(tabId)
      if (settings.token) {
        await ensureRelayConnection(settings.port, settings.token)
        await attachWithRetry(tabId, relayKeyFor(settings.port, settings.token))
      }
    }
  }
}

function setBadge(tabId, kind) {
  const cfg = BADGE[kind]
  void chrome.action.setBadgeText({ tabId, text: cfg.text })
  void chrome.action.setBadgeBackgroundColor({ tabId, color: cfg.color })
  void chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }).catch(() => {})
}

async function ensureStatusOverlay(tabId, port, statusText) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (portValue, text) => {
        const id = '__openclaw_status_overlay'
        let el = document.getElementById(id)
        if (!el) {
          el = document.createElement('div')
          el.id = id
          el.style.position = 'fixed'
          el.style.right = '12px'
          el.style.bottom = '12px'
          el.style.zIndex = '2147483647'
          el.style.background = 'rgba(17, 24, 39, 0.92)'
          el.style.color = '#fff'
          el.style.padding = '8px 10px'
          el.style.borderRadius = '10px'
          el.style.font = '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          el.style.boxShadow = '0 6px 24px rgba(0,0,0,0.25)'
          el.style.pointerEvents = 'none'
          document.documentElement.appendChild(el)
        }
        el.textContent = `OpenClaw ${text} · port ${portValue}`
      },
      args: [port, statusText],
    })
  } catch {
    // ignore overlay errors
  }
}

async function removeStatusOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const el = document.getElementById('__openclaw_status_overlay')
        if (el) el.remove()
      },
    })
  } catch {
    // ignore overlay errors
  }
}

async function cleanupInvalidTabAssignments() {
  const stored = await chrome.storage.local.get(['relayPortByTabId', 'gatewayTokenByTabId'])
  const portByTab = stored.relayPortByTabId || {}
  const tokenByTab = stored.gatewayTokenByTabId || {}
  const tabIds = Object.keys(portByTab)
  if (!tabIds.length) return
  for (const id of tabIds) {
    const tabId = Number.parseInt(id, 10)
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    const url = tab?.url || ''
    if (!tab || url.startsWith('chrome-extension://')) {
      delete portByTab[id]
      delete tokenByTab[id]
    }
  }
  await chrome.storage.local.set({ relayPortByTabId: portByTab, gatewayTokenByTabId: tokenByTab })
}

function setPortBadge(tabId, port) {
  if (!port) return
  const text = String(port).slice(-4)
  void chrome.action.setBadgeText({ tabId, text })
  void chrome.action.setBadgeBackgroundColor({ tabId, color: '#0EA5E9' })
  void chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }).catch(() => {})
}

async function ensureRelayConnection(port, gatewayToken) {
  const key = relayKeyFor(port, gatewayToken)
  const existing = relaySockets.get(key)
  if (existing && existing.readyState === WebSocket.OPEN) return

  const existingPromise = relayConnectPromises.get(key)
  if (existingPromise) return await existingPromise

  const connectPromise = (async () => {
    const httpBase = `http://127.0.0.1:${port}`
    const wsUrl = gatewayToken
      ? `ws://127.0.0.1:${port}/extension?token=${encodeURIComponent(gatewayToken)}`
      : `ws://127.0.0.1:${port}/extension`

    // Fast preflight: is the relay server up?
    try {
      await fetch(`${httpBase}/`, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
    } catch (err) {
      throw new Error(`Relay server not reachable at ${httpBase} (${String(err)})`)
    }

    if (!gatewayToken) {
      throw new Error(
        'Missing gatewayToken in extension settings (chrome.storage.local.gatewayToken)',
      )
    }

    const maxRetries = 3
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        console.log(`Relay connect retry ${attempt}/${maxRetries - 1}, waiting 2s…`)
        await new Promise((r) => setTimeout(r, 2000))
      }

      const ws = new WebSocket(wsUrl)
      try {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000)
          ws.onopen = () => {
            clearTimeout(t)
            resolve()
          }
          ws.onerror = () => {
            clearTimeout(t)
            reject(new Error('WebSocket connect failed'))
          }
          ws.onclose = (ev) => {
            clearTimeout(t)
            reject(new Error(`WebSocket closed (${ev.code} ${ev.reason || 'no reason'})`))
          }
        })

        relaySockets.set(key, ws)
        break
      } catch (err) {
        ws.close()
        if (attempt === maxRetries - 1) throw err
      }
    }

    const ws = relaySockets.get(key)
    if (!ws) throw new Error('Relay socket not available after connect')
    ws.onmessage = (event) => void onRelayMessage(key, String(event.data || ''))
    ws.onclose = () => onRelayClosed(key, 'closed')
    ws.onerror = () => onRelayClosed(key, 'error')

    if (!debuggerListenersInstalled) {
      debuggerListenersInstalled = true
      chrome.debugger.onEvent.addListener(onDebuggerEvent)
      chrome.debugger.onDetach.addListener(onDebuggerDetach)
    }
  })()

  relayConnectPromises.set(key, connectPromise)
  try {
    await connectPromise
  } finally {
    relayConnectPromises.delete(key)
  }
}

function onRelayClosed(relayKey, reason) {
  relaySockets.delete(relayKey)

  const pending = pendingByRelay.get(relayKey)
  if (pending) {
    for (const [id, p] of pending.entries()) {
      pending.delete(id)
      p.reject(new Error(`Relay disconnected (${reason})`))
    }
  }

  for (const [tabId, tab] of tabs.entries()) {
    if (tab.relayKey !== relayKey) continue
    void chrome.debugger.detach({ tabId }).catch(() => {})
    setBadge(tabId, 'connecting')
    void chrome.action.setTitle({
      tabId,
      title: 'OpenClaw Browser Relay: disconnected (click to re-attach)',
    })
    tabs.delete(tabId)
  }

  for (const [sessionId, tabId] of tabBySession.entries()) {
    const tab = tabs.get(tabId)
    if (tab && tab.relayKey === relayKey) tabBySession.delete(sessionId)
  }

  for (const [sessionId, tabId] of childSessionToTab.entries()) {
    const tab = tabs.get(tabId)
    if (tab && tab.relayKey === relayKey) childSessionToTab.delete(sessionId)
  }
}

function sendToRelay(relayKey, payload) {
  const ws = relaySockets.get(relayKey)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Relay not connected')
  }
  ws.send(JSON.stringify(payload))
}

async function maybeOpenHelpOnce() {
  try {
    const stored = await chrome.storage.local.get(['helpOnErrorShown'])
    if (stored.helpOnErrorShown === true) return
    await chrome.storage.local.set({ helpOnErrorShown: true })
    await chrome.runtime.openOptionsPage()
  } catch {
    // ignore
  }
}

function requestFromRelay(relayKey, command) {
  const id = command.id
  return new Promise((resolve, reject) => {
    const pending = pendingByRelay.get(relayKey) || new Map()
    pendingByRelay.set(relayKey, pending)
    pending.set(id, { resolve, reject })
    try {
      sendToRelay(relayKey, command)
    } catch (err) {
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

async function onRelayMessage(relayKey, text) {
  /** @type {any} */
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return
  }

  if (msg && msg.method === 'ping') {
    try {
      sendToRelay(relayKey, { method: 'pong' })
    } catch {
      // ignore
    }
    return
  }

  if (msg && typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
    const pending = pendingByRelay.get(relayKey)
    const p = pending?.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(String(msg.error)))
    else p.resolve(msg.result)
    return
  }

  if (msg && typeof msg.id === 'number' && msg.method === 'forwardCDPCommand') {
    try {
      const result = await handleForwardCdpCommand(relayKey, msg)
      sendToRelay(relayKey, { id: msg.id, result })
    } catch (err) {
      sendToRelay(relayKey, { id: msg.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
}

function getTabBySessionId(sessionId) {
  const direct = tabBySession.get(sessionId)
  if (direct) return { tabId: direct, kind: 'main' }
  const child = childSessionToTab.get(sessionId)
  if (child) return { tabId: child, kind: 'child' }
  return null
}

function getTabByTargetId(targetId) {
  for (const [tabId, tab] of tabs.entries()) {
    if (tab.targetId === targetId) return tabId
  }
  return null
}

async function attachTab(tabId, opts = {}) {
  if (attachingTabs.has(tabId)) {
    throw new Error(`Attach already in progress for tab ${tabId}`)
  }
  attachingTabs.add(tabId)
  tabs.set(tabId, { state: 'connecting', relayKey: opts.relayKey })
  try {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  const url = tab?.url || ''
  if (URL_BLOCKLIST_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    throw new Error(`Cannot attach to restricted URL: ${url}`)
  }

  const debuggee = { tabId }
  await chrome.debugger.attach(debuggee, '1.3')
  await chrome.debugger.sendCommand(debuggee, 'Page.enable').catch(() => {})

  const info = /** @type {any} */ (await chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo'))
  const targetInfo = info?.targetInfo
  const targetId = String(targetInfo?.targetId || '').trim()
  if (!targetId) {
    throw new Error('Target.getTargetInfo returned no targetId')
  }

  const sessionId = `cb-tab-${nextSession++}`
  const attachOrder = nextSession

  tabs.set(tabId, { state: 'connected', sessionId, targetId, attachOrder, relayKey: opts.relayKey })
  tabBySession.set(sessionId, tabId)
  void chrome.action.setTitle({
    tabId,
    title: 'OpenClaw Browser Relay: attached (click to detach)',
  })

  if (!opts.skipAttachedEvent) {
    sendToRelay(opts.relayKey, {
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: {
          sessionId,
          targetInfo: { ...targetInfo, attached: true },
          waitingForDebugger: false,
        },
      },
    })
  }

  setBadge(tabId, 'on')
  return { sessionId, targetId }
  } finally {
    attachingTabs.delete(tabId)
  }
}

async function detachTab(tabId, reason) {
  const tab = tabs.get(tabId)
  if (tab?.sessionId && tab?.targetId) {
    try {
      sendToRelay(tab.relayKey, {
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.detachedFromTarget',
          params: { sessionId: tab.sessionId, targetId: tab.targetId, reason },
        },
      })
    } catch {
      // ignore
    }
  }

  if (tab?.sessionId) tabBySession.delete(tab.sessionId)
  tabs.delete(tabId)

  for (const [childSessionId, parentTabId] of childSessionToTab.entries()) {
    if (parentTabId === tabId) childSessionToTab.delete(childSessionId)
  }

  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // ignore
  }

  setBadge(tabId, 'off')
  await removeStatusOverlay(tabId)
  void chrome.action.setTitle({
    tabId,
    title: 'OpenClaw Browser Relay (click to attach/detach)',
  })
}

async function connectOrToggleForActiveTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabId = active?.id
  if (!tabId) return

  const existing = tabs.get(tabId)
  if (existing?.state === 'connected') {
    await detachTab(tabId, 'toggle')
    return
  }

  tabs.set(tabId, { state: 'connecting' })
  setBadge(tabId, 'connecting')
  void chrome.action.setTitle({
    tabId,
    title: 'OpenClaw Browser Relay: connecting to local relay…',
  })

  try {
    const { port, token } = await getRelaySettingsForTab(tabId)
    await ensureRelayConnection(port, token)
    await attachWithRetry(tabId, relayKeyFor(port, token))
    setPortBadge(tabId, port)
  } catch (err) {
    tabs.delete(tabId)
    setBadge(tabId, 'error')
    void chrome.action.setTitle({
      tabId,
      title: 'OpenClaw Browser Relay: relay not running (open options for setup)',
    })
    void maybeOpenHelpOnce()
    // Extra breadcrumbs in chrome://extensions service worker logs.
    const message = err instanceof Error ? err.message : String(err)
    console.warn('attach failed', message, nowStack())
  }
}

async function handleForwardCdpCommand(relayKey, msg) {
  const method = String(msg?.params?.method || '').trim()
  const params = msg?.params?.params || undefined
  const sessionId = typeof msg?.params?.sessionId === 'string' ? msg.params.sessionId : undefined

  if (!CDP_METHOD_ALLOWLIST.has(method)) {
    throw new Error(`CDP method not allowed: ${method}`)
  }

  // Map command to tab
  const bySession = sessionId ? getTabBySessionId(sessionId) : null
  const targetId = typeof params?.targetId === 'string' ? params.targetId : undefined
  const tabId =
    bySession?.tabId ||
    (targetId ? getTabByTargetId(targetId) : null) ||
    (() => {
      // No sessionId: pick the first connected tab (stable-ish).
      for (const [id, tab] of tabs.entries()) {
        if (tab.state === 'connected' && tab.relayKey === relayKey) return id
      }
      return null
    })()

  if (!tabId) throw new Error(`No attached tab for method ${method}`)

  /** @type {chrome.debugger.DebuggerSession} */
  const debuggee = { tabId }

  if (method === 'Runtime.enable') {
    return await chrome.debugger.sendCommand(debuggee, 'Runtime.enable', params)
  }

  if (method === 'Target.createTarget') {
    const now = Date.now()
    if (now - lastCreateTargetAt > 60000) {
      lastCreateTargetAt = now
      createTargetCount = 0
    }
    createTargetCount += 1
    if (createTargetCount > 5) {
      throw new Error('Target.createTarget rate limit exceeded')
    }

    const url = typeof params?.url === 'string' ? params.url : 'about:blank'
    const tab = await chrome.tabs.create({ url, active: false })
    if (!tab.id) throw new Error('Failed to create tab')
    await new Promise((r) => setTimeout(r, 100))
    const attached = await attachTab(tab.id)
    return { targetId: attached.targetId }
  }

  if (method === 'Target.closeTarget') {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toClose = target ? getTabByTargetId(target) : tabId
    if (!toClose) return { success: false }
    try {
      await chrome.tabs.remove(toClose)
    } catch {
      return { success: false }
    }
    return { success: true }
  }

  if (method === 'Target.activateTarget') {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toActivate = target ? getTabByTargetId(target) : tabId
    if (!toActivate) return {}
    const tab = await chrome.tabs.get(toActivate).catch(() => null)
    if (!tab) return {}
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
    }
    await chrome.tabs.update(toActivate, { active: true }).catch(() => {})
    return {}
  }

  const tabState = tabs.get(tabId)
  const mainSessionId = tabState?.sessionId
  const debuggerSession =
    sessionId && mainSessionId && sessionId !== mainSessionId
      ? { ...debuggee, sessionId }
      : debuggee

  return await chrome.debugger.sendCommand(debuggerSession, method, params)
}

function onDebuggerEvent(source, method, params) {
  const tabId = source.tabId
  if (!tabId) return
  const tab = tabs.get(tabId)
  if (!tab?.sessionId) return

  if (!CDP_EVENT_ALLOWLIST.has(method)) return
  const now = Date.now()
  if (now - eventWindowStart >= 1000) {
    eventWindowStart = now
    eventCountInWindow = 0
  }
  eventCountInWindow += 1
  if (eventCountInWindow > EVENT_RATE_LIMIT_PER_SEC) return

  if (method === 'Target.attachedToTarget' && params?.sessionId) {
    childSessionToTab.set(String(params.sessionId), tabId)
  }

  if (method === 'Target.detachedFromTarget' && params?.sessionId) {
    childSessionToTab.delete(String(params.sessionId))
  }

  try {
    sendToRelay(tab.relayKey, {
      method: 'forwardCDPEvent',
      params: {
        sessionId: source.sessionId || tab.sessionId,
        method,
        params,
      },
    })
  } catch {
    // ignore
  }
}

function onDebuggerDetach(source, reason) {
  const tabId = source.tabId
  if (!tabId) return
  if (!tabs.has(tabId)) return
  void detachTab(tabId, reason)
}

// Popup handles attach/detach now; no direct click handler needed.

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabs.has(tabId)) {
    void detachTab(tabId, 'tab-closed')
  }
  void chrome.storage.local.get(['relayPortByTabId', 'gatewayTokenByTabId']).then((stored) => {
    const portByTab = stored.relayPortByTabId || {}
    const tokenByTab = stored.gatewayTokenByTabId || {}
    if (portByTab[tabId] !== undefined) {
      delete portByTab[tabId]
      void chrome.storage.local.set({ relayPortByTabId: portByTab })
    }
    if (tokenByTab[tabId] !== undefined) {
      delete tokenByTab[tabId]
      void chrome.storage.local.set({ gatewayTokenByTabId: tokenByTab })
    }
  })
})

chrome.runtime.onInstalled.addListener(() => {
  // Useful: first-time instructions.
  void chrome.storage.local.set({ forkFeatures: FORK_FEATURES })
  void chrome.runtime.openOptionsPage()
  void cleanupInvalidTabAssignments()
  void ensureChatBrowsersOpen()
})

chrome.runtime.onStartup.addListener(() => {
  void chrome.storage.local.set({ forkFeatures: FORK_FEATURES })
  void cleanupInvalidTabAssignments()
  void ensureChatBrowsersOpen()
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'loadTokenFromNative') {
    ;(async () => {
      const port = chrome.runtime.connectNative('ai.openclaw.token')
      port.onMessage.addListener((m) => {
        if (m && m.token) sendResponse({ ok: true, token: m.token })
        else sendResponse({ ok: false, error: m?.error || 'No token returned' })
      })
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message })
        }
      })
    })()
    return true
  }
  if (msg.type === 'attachActiveTab') {
    ;(async () => {
      const port = clampPort(msg.port)
      const stored = await chrome.storage.local.get(['gatewayToken'])
      const token = String(stored.gatewayToken || '').trim()
      if (!token) throw new Error('Missing gateway token')
      const { tabId } = await safeAttachActiveTab(port, token)
      sendResponse({ ok: true, tabId })
    })().catch((err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
    })
    return true
  }
  if (msg.type === 'detachActiveTab') {
    ;(async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
      const tabId = active?.id
      if (!tabId) throw new Error('No active tab found')
      await detachTab(tabId, 'popup')
      sendResponse({ ok: true })
    })().catch((err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
    })
    return true
  }
  if (msg.type === 'openChatWindow') {
    ;(async () => {
      await logDebug('openChatWindow message received')
      const port = clampPort(msg.port)
      const token = String(msg.token || '').trim()
      const url = String(msg.url || `http://127.0.0.1:${port}/__openclaw__/canvas/`)
      const created = await chrome.windows.create({ url, focused: true })
      const tabId = created?.tabs?.[0]?.id
      if (tabId) {
        await logDebug(`openChatWindow created tab=${tabId} port=${port}`)
        await setTabRelayOverrideWithToken(tabId, port, token)
        await ensureRelayConnection(port, token)
        await attachWithRetry(tabId, relayKeyFor(port, token))
      }
      sendResponse({ ok: true, tabId })
    })().catch((err) => {
      void logDebug(`openChatWindow error ${err instanceof Error ? err.message : String(err)}`)
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
    })
    return true
  }
  if (msg.type === 'fixChatConnections') {
    ;(async () => {
      await logDebug('fixChatConnections message received')
      await ensureChatBrowsersOpen()
      sendResponse({ ok: true })
    })().catch((err) => {
      void logDebug(`fixChatConnections error ${err instanceof Error ? err.message : String(err)}`)
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
    })
    return true
  }
  if (msg.type === 'clearDebugLog') {
    ;(async () => {
      await chrome.storage.local.set({ debugLog: [] })
      sendResponse({ ok: true })
    })().catch((err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
    })
    return true
  }
})
