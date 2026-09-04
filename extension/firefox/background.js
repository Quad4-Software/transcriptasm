/**
 * Service worker for transcriptasm.
 * Mic capture and Whisper inference run in the bridge tab.
 */

const APP_ORIGIN = "https://transcriptasm.quad4.io";
const BRIDGE_PATH = "/extension-bridge.html";
const BRIDGE_NAME = "transcriptasm-bridge";

const pending = new Map();
let reqSeq = 0;

async function getConfiguredOrigin() {
  const { bridgeOrigin = APP_ORIGIN } = await chrome.storage.sync.get("bridgeOrigin");
  return String(bridgeOrigin || APP_ORIGIN).replace(/\/$/, "");
}

function isAllowedBridgeUrl(url, origin) {
  return (
    url.startsWith(APP_ORIGIN) ||
    url.startsWith(origin) ||
    url.startsWith("http://127.0.0.1") ||
    url.startsWith("http://localhost")
  );
}

async function getBridgePort() {
  if (globalThis.__bridgePort && globalThis.__bridgePort.name === BRIDGE_NAME) {
    return globalThis.__bridgePort;
  }
  await ensureBridgeTab(true);
  for (let i = 0; i < 40; i++) {
    if (globalThis.__bridgePort && globalThis.__bridgePort.name === BRIDGE_NAME) {
      return globalThis.__bridgePort;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

async function ensureBridgeTab(focus = false) {
  const origin = await getConfiguredOrigin();
  const extId = chrome.runtime.id;
  const url = `${origin}${BRIDGE_PATH}?extId=${encodeURIComponent(extId)}`;

  const tabs = await chrome.tabs.query({ url: `${origin}${BRIDGE_PATH}*` });
  if (tabs.length) {
    const existing = tabs[0];
    if (existing.url !== url) {
      await chrome.tabs.update(existing.id, { url, active: focus });
    } else if (focus) {
      await chrome.tabs.update(existing.id, { active: true });
    }
    await chrome.storage.session.set({ bridgeTabId: existing.id });
    return existing.id;
  }
  const tab = await chrome.tabs.create({ url, active: focus });
  await chrome.storage.session.set({ bridgeTabId: tab.id });
  return tab.id;
}

async function bridgeRequest(payload) {
  const port = await getBridgePort();
  if (!port) throw new Error("Bridge not connected. Allow the bridge tab to stay open.");
  const id = `r${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("bridge timeout"));
    }, 600000);
    pending.set(id, { resolve, reject, timer });
    port.postMessage({ ...payload, id });
  });
}

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== BRIDGE_NAME) {
    port.disconnect();
    return;
  }
  const url = port.sender?.url || "";
  getConfiguredOrigin().then((origin) => {
    if (!isAllowedBridgeUrl(url, origin)) {
      port.disconnect();
      return;
    }
    globalThis.__bridgePort = port;
    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "bridge-hello") return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error || "bridge error"));
    });
    port.onDisconnect.addListener(() => {
      if (globalThis.__bridgePort === port) globalThis.__bridgePort = null;
    });
  });
});

async function getSettings() {
  const defaults = {
    bridgeOrigin: APP_ORIGIN,
    modelId: "",
  };
  const stored = await chrome.storage.sync.get(defaults);
  return { ...defaults, ...stored };
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "open-transcriber",
    title: "Open transcriptasm",
    contexts: ["page", "action"],
  });
  chrome.contextMenus.create({
    id: "open-bridge",
    title: "Open transcriptasm bridge (mic)",
    contexts: ["action"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "open-transcriber") {
    await chrome.tabs.create({ url: APP_ORIGIN + "/" });
  } else if (info.menuItemId === "open-bridge") {
    await ensureBridgeTab(true);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "ensure-bridge") {
      await ensureBridgeTab(Boolean(msg.focus));
      await getBridgePort();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "get-settings") {
      sendResponse(await getSettings());
      return;
    }
    if (msg?.type === "save-settings") {
      await chrome.storage.sync.set(msg.settings || {});
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "list-models") {
      const result = await bridgeRequest({ type: "list-models" });
      const models = Array.isArray(result) ? result : (result?.models || []);
      sendResponse({ ok: true, result: { models } });
      return;
    }
    if (msg?.type === "load-model") {
      const result = await bridgeRequest({ type: "load-model", modelId: msg.modelId });
      sendResponse({ ok: true, result });
      return;
    }
    if (msg?.type === "start-record") {
      await ensureBridgeTab(true);
      const result = await bridgeRequest({ type: "start-record" });
      sendResponse({ ok: true, result });
      return;
    }
    if (msg?.type === "stop-record") {
      const result = await bridgeRequest({
        type: "stop-record",
        language: msg.language,
        translate: msg.translate,
        timestamps: msg.timestamps,
      });
      sendResponse({ ok: true, result });
      return;
    }
    if (msg?.type === "cancel-record") {
      const result = await bridgeRequest({ type: "cancel-record" });
      sendResponse({ ok: true, result });
      return;
    }
    if (msg?.type === "open-app") {
      await chrome.tabs.create({ url: APP_ORIGIN + "/" });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "unknown" });
  })().catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
