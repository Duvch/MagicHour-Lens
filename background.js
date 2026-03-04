// ─── MagicHour Lens – Background Service Worker ───

const API_BASE = "https://api.magichour.ai/v1";
const PROXY_BASE = "https://magichour-lens-proxy.divshiv87.workers.dev/v1";
const PROXY_CREDITS_URL = "https://magichour-lens-proxy.divshiv87.workers.dev/api/credits";

// ─── Install ID ───

chrome.runtime.onInstalled.addListener(async (details) => {
  // Generate a stable install ID for free-tier tracking
  const data = await chrome.storage.local.get("installId");
  if (!data.installId) {
    const installId = crypto.randomUUID();
    await chrome.storage.local.set({ installId });
  }

  // Context menu
  chrome.contextMenus.create({
    id: "mh-transform",
    title: "Transform with MagicHour",
    contexts: ["image"],
  });
});

// ─── API Config Helper ───

async function getApiConfig() {
  const data = await chrome.storage.local.get(["apiKey", "installId"]);
  if (data.apiKey) {
    // Direct mode — user's own key
    return {
      baseUrl: API_BASE,
      headers: { Authorization: "Bearer " + data.apiKey },
      isDirect: true,
    };
  }
  // Proxy mode — free tier
  return {
    baseUrl: PROXY_BASE,
    headers: { "X-MH-Install-Id": data.installId || "unknown" },
    isDirect: false,
  };
}

async function getCredits() {
  const data = await chrome.storage.local.get("installId");
  if (!data.installId) return { remaining: 0, limit: 10, used: 0 };
  try {
    const res = await fetch(PROXY_CREDITS_URL, {
      headers: { "X-MH-Install-Id": data.installId },
    });
    if (!res.ok) return { remaining: 0, limit: 10, used: 0 };
    return res.json();
  } catch {
    return { remaining: 0, limit: 10, used: 0 };
  }
}

// ─── Context Menu ───

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "mh-transform" && info.srcUrl) {
    await chrome.storage.local.set({
      _pendingImage: info.srcUrl,
      _pendingTabId: tab.id,
    });

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"],
      });
    } catch (e) {}

    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "selectImage",
        imageUrl: info.srcUrl,
      });
    } catch (e) {}

    try {
      await chrome.action.openPopup();
    } catch (e) {
      console.warn("[MH] Could not open popup:", e.message);
    }
  }
});

// ─── Message Router ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "transformFromPopup") {
    const tabId = msg.tabId;
    sendResponse({ ok: true });

    handleTransform(msg)
      .then((result) => {
        chrome.tabs.sendMessage(tabId, {
          action: "transformComplete",
          resultUrl: result.resultUrl,
        }).catch(() => {});
      })
      .catch((err) => {
        chrome.tabs.sendMessage(tabId, {
          action: "transformError",
          error: err.message,
        }).catch(() => {});
      });

    return false;
  }

  if (msg.action === "transformAllFromPopup") {
    const tabId = msg.tabId;
    const images = msg.images;
    const settings = msg.settings;
    sendResponse({ ok: true });

    for (const img of images) {
      chrome.tabs.sendMessage(tabId, { action: "transformAllStart", index: img.index }).catch(() => {});
    }

    (async () => {
      for (const img of images) {
        try {
          const result = await handleTransform({ imageUrl: img.url, settings });
          chrome.tabs.sendMessage(tabId, {
            action: "transformAllComplete",
            originalUrl: img.url,
            resultUrl: result.resultUrl,
          }).catch(() => {});
        } catch (err) {
          chrome.tabs.sendMessage(tabId, {
            action: "transformAllError",
            originalUrl: img.url,
            error: err.message,
          }).catch(() => {});
        }
      }
    })();

    return false;
  }

  if (msg.action === "autoFaceSwap") {
    (async () => {
      try {
        const config = await getApiConfig();
        const data = await chrome.storage.local.get("autoFaceImage");
        if (!data.autoFaceImage) {
          sendResponse({ error: "Face image not configured." });
          return;
        }
        const sourceFilePath = await uploadFromUrl(config, msg.imageUrl);
        const faceFilePath = await uploadFromUrl(config, data.autoFaceImage);
        const projectId = await apiFaceSwap(config, sourceFilePath, faceFilePath);
        const result = await pollForResult(config, projectId);
        sendResponse({ resultUrl: result.downloads?.[0]?.url });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (msg.action === "transform") {
    handleTransform(msg).then(sendResponse).catch((err) =>
      sendResponse({ error: err.message })
    );
    return true;
  }

  if (msg.action === "getSettings") {
    chrome.storage.local.get(
      ["apiKey", "mode", "stylePrompt", "faceImage", "customPrompt", "model", "clothesImage", "autoFaceSwap", "autoMinSize", "autoFaceImage"],
      sendResponse
    );
    return true;
  }

  if (msg.action === "saveSettings") {
    chrome.storage.local.set(msg.settings, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === "getCredits") {
    getCredits().then(sendResponse);
    return true;
  }
});

// ─── Core Transform Pipeline ───

async function handleTransform({ imageUrl, settings }) {
  // Build config: use user's key if provided, otherwise proxy
  let config;
  if (settings && settings.apiKey) {
    config = {
      baseUrl: API_BASE,
      headers: { Authorization: "Bearer " + settings.apiKey },
      isDirect: true,
    };
  } else {
    config = await getApiConfig();
  }

  const mode = (settings && settings.mode) || "style";

  const sourceFilePath = await uploadFromUrl(config, imageUrl);

  let projectId;

  switch (mode) {
    case "faceswap": {
      if (!settings.faceImage) throw new Error("Upload your face photo in settings first.");
      const faceFilePath = await uploadFromUrl(config, settings.faceImage);
      projectId = await apiFaceSwap(config, sourceFilePath, faceFilePath);
      break;
    }

    case "style":
      projectId = await apiImageEdit(
        config,
        sourceFilePath,
        settings.stylePrompt || "Transform this image into anime style art",
        settings.model
      );
      break;

    case "edit":
      projectId = await apiImageEdit(
        config,
        sourceFilePath,
        settings.customPrompt || "Enhance this image",
        settings.model
      );
      break;

    case "background":
      projectId = await apiBackgroundRemove(config, sourceFilePath);
      break;

    case "upscale":
      projectId = await apiUpscale(config, sourceFilePath);
      break;

    case "clothes": {
      if (!settings.clothesImage) throw new Error("Upload a clothing reference image in settings first.");
      const clothesFilePath = await uploadFromUrl(config, settings.clothesImage);
      projectId = await apiClothesChange(config, sourceFilePath, clothesFilePath);
      break;
    }

    default:
      throw new Error("Unknown mode: " + mode);
  }

  const result = await pollForResult(config, projectId);
  return { resultUrl: result.downloads?.[0]?.url, projectId };
}

// ─── MagicHour API Calls ───

async function apiFaceSwap(config, targetFilePath, sourceFilePath) {
  const res = await apiCall(config, "/face-swap-photo", {
    assets: { target_file_path: targetFilePath, source_file_path: sourceFilePath },
  });
  return res.id;
}

async function apiImageEdit(config, imageFilePath, prompt, model) {
  const res = await apiCall(config, "/ai-image-editor", {
    style: { prompt: prompt },
    assets: { image_file_paths: [imageFilePath] },
    image_count: 1,
    model: model || "qwen-edit",
  });
  return res.id;
}

async function apiBackgroundRemove(config, imageFilePath) {
  const res = await apiCall(config, "/image-background-remover", {
    assets: { image_file_path: imageFilePath },
  });
  return res.id;
}

async function apiUpscale(config, imageFilePath) {
  const res = await apiCall(config, "/ai-image-upscaler", {
    scale_factor: 2,
    style: { enhancement: "Balanced" },
    assets: { image_file_path: imageFilePath },
  });
  return res.id;
}

async function apiClothesChange(config, personFilePath, garmentFilePath) {
  const res = await apiCall(config, "/ai-clothes-changer", {
    assets: { person_file_path: personFilePath, garment_file_path: garmentFilePath },
  });
  return res.id;
}

async function apiCall(config, endpoint, body, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(config.baseUrl + endpoint, {
      method: "POST",
      headers: {
        ...config.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.status >= 500 && attempt < retries) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "API error: " + res.status + " " + res.statusText);
    }
    return res.json();
  }
}

async function pollForResult(config, projectId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const res = await fetch(config.baseUrl + "/image-projects/" + projectId, {
      headers: config.headers,
    });
    if (!res.ok) throw new Error("Poll failed: " + res.statusText);
    const data = await res.json();

    if (data.status === "complete") return data;
    if (data.status === "error" || data.status === "canceled") {
      throw new Error("Transform failed: " + (data.error?.message || data.status));
    }
  }
  throw new Error("Transform timed out after 2 minutes");
}

// ─── File Upload ───

async function uploadFromUrl(config, url) {
  const blob = await fetchAsBlob(url);
  return uploadBlob(config, blob);
}

async function fetchAsBlob(url) {
  if (url.startsWith("data:")) {
    const res = await fetch(url);
    return res.blob();
  }

  const headers = {
    "Accept": "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  };

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    try {
      res = await fetch(url);
    } catch (e2) {
      throw new Error("Cannot fetch image. The site may be blocking direct access.");
    }
  }

  if (!res.ok) throw new Error("Failed to fetch image: " + res.status + " " + res.statusText);
  return res.blob();
}

async function uploadBlob(config, blob) {
  const mimeMap = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
    "image/avif": "avif", "image/tiff": "tiff", "image/bmp": "bmp",
  };
  const ext = mimeMap[blob.type] || "png";

  const res = await fetch(config.baseUrl + "/files/upload-urls", {
    method: "POST",
    headers: {
      ...config.headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items: [{ type: "image", extension: ext }] }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error("Upload URL failed: " + (err.message || res.statusText));
  }

  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error("Failed to get upload URL from MagicHour");

  const putRes = await fetch(item.upload_url, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "image/png" },
    body: blob,
  });
  if (!putRes.ok) throw new Error("Image upload failed: " + putRes.statusText);

  return item.file_path;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
