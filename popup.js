function setStatus(kind, message) {
  const el = document.getElementById('status')
  if (!el) return
  el.dataset.kind = kind || ''
  el.textContent = message || ''
}

async function sendAttach(port) {
  const res = await chrome.runtime.sendMessage({ type: 'attachActiveTab', port })
  if (res?.ok) setStatus('ok', `Attached to port ${port}`)
  else setStatus('error', res?.error || 'Attach failed')
}

async function sendDetach() {
  const res = await chrome.runtime.sendMessage({ type: 'detachActiveTab' })
  if (res?.ok) setStatus('ok', 'Detached')
  else setStatus('error', res?.error || 'Detach failed')
}

document.getElementById('attach-coding').addEventListener('click', () => void sendAttach(18789))
document.getElementById('attach-research').addEventListener('click', () => void sendAttach(19001))
document.getElementById('detach').addEventListener('click', () => void sendDetach())
