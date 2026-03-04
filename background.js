// ─── MagicHour Lens – Background Service Worker ───

const API_BASE = "https://api.magichour.ai/v1";

// ─── Context Menu ───

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "mh-transform",
    title: "Transform with MagicHour",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "mh-transform" && info.srcUrl) {
    // Store the image URL and tab ID so the popup can pick it up
    await chrome.storage.local.set({
      _pendingImage: info.srcUrl,
      _pendingTabId: tab.id,
    });

    // Ensure content script is injected
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

    // Select the image in the content script
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "selectImage",
        imageUrl: info.srcUrl,
      });
    } catch (e) {}

    // Open the extension popup
    try {
      await chrome.action.openPopup();
    } catch (e) {
      // Fallback for older Chrome — just notify user
      console.warn("[MH] Could not open popup:", e.message);
    }
  }
});

// ─── Message Router ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Transform request — from popup or content script
  // Background handles the ENTIRE flow and sends result directly to content script
  if (msg.action === "transformFromPopup") {
    const tabId = msg.tabId;
    sendResponse({ ok: true }); // Acknowledge immediately so popup can close

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

    return false; // Already sent response
  }

  // Transform ALL images on page
  if (msg.action === "transformAllFromPopup") {
    const tabId = msg.tabId;
    const images = msg.images;
    const settings = msg.settings;
    sendResponse({ ok: true });

    // Show loading on all images
    for (const img of images) {
      chrome.tabs.sendMessage(tabId, { action: "transformAllStart", index: img.index }).catch(() => {});
    }

    // Process images sequentially to avoid API rate limits
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

  // Auto face swap from content script
  if (msg.action === "autoFaceSwap") {
    chrome.storage.local.get(["apiKey", "autoFaceImage"], (data) => {
      if (!data.apiKey || !data.autoFaceImage) {
        sendResponse({ error: "API key or face image not configured." });
        return;
      }
      (async () => {
        try {
          const sourceFilePath = await uploadFromUrl(data.apiKey, msg.imageUrl);
          const faceFilePath = await uploadFromUrl(data.apiKey, data.autoFaceImage);
          const projectId = await apiFaceSwap(data.apiKey, sourceFilePath, faceFilePath);
          const result = await pollForResult(data.apiKey, projectId);
          sendResponse({ resultUrl: result.downloads?.[0]?.url });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
    });
    return true; // keep message channel open for async response
  }

  // Transform from content script (context menu flow)
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
});

// ─── Core Transform Pipeline ───

async function handleTransform({ imageUrl, settings }) {
  const apiKey = settings.apiKey;
  if (!apiKey) throw new Error("API key not configured. Open extension settings.");

  const mode = settings.mode || "style";

  // Always fetch and upload the image to MagicHour storage
  const sourceFilePath = await uploadFromUrl(apiKey, imageUrl);

  let projectId;

  switch (mode) {
    case "faceswap": {
      if (!settings.faceImage) throw new Error("Upload your face photo in settings first.");
      const faceFilePath = await uploadFromUrl(apiKey, settings.faceImage);
      projectId = await apiFaceSwap(apiKey, sourceFilePath, faceFilePath);
      break;
    }

    case "style":
      projectId = await apiImageEdit(
        apiKey,
        sourceFilePath,
        settings.stylePrompt || "Transform this image into anime style art",
        settings.model
      );
      break;

    case "edit":
      projectId = await apiImageEdit(
        apiKey,
        sourceFilePath,
        settings.customPrompt || "Enhance this image",
        settings.model
      );
      break;

    case "background":
      projectId = await apiBackgroundRemove(apiKey, sourceFilePath);
      break;

    case "upscale":
      projectId = await apiUpscale(apiKey, sourceFilePath);
      break;

    case "clothes": {
      if (!settings.clothesImage) throw new Error("Upload a clothing reference image in settings first.");
      const clothesFilePath = await uploadFromUrl(apiKey, settings.clothesImage);
      projectId = await apiClothesChange(apiKey, sourceFilePath, clothesFilePath);
      break;
    }

    default:
      throw new Error("Unknown mode: " + mode);
  }

  const result = await pollForResult(apiKey, projectId);
  return { resultUrl: result.downloads?.[0]?.url, projectId };
}

// ─── MagicHour API Calls ───

async function apiFaceSwap(apiKey, targetFilePath, sourceFilePath) {
  const res = await apiCall(apiKey, "/face-swap-photo", {
    assets: { target_file_path: targetFilePath, source_file_path: sourceFilePath },
  });
  return res.id;
}

async function apiImageEdit(apiKey, imageFilePath, prompt, model) {
  const res = await apiCall(apiKey, "/ai-image-editor", {
    style: { prompt: prompt },
    assets: { image_file_paths: [imageFilePath] },
    image_count: 1,
    model: model || "qwen-edit",
  });
  return res.id;
}

async function apiBackgroundRemove(apiKey, imageFilePath) {
  const res = await apiCall(apiKey, "/image-background-remover", {
    assets: { image_file_path: imageFilePath },
  });
  return res.id;
}

async function apiUpscale(apiKey, imageFilePath) {
  const res = await apiCall(apiKey, "/ai-image-upscaler", {
    scale_factor: 2,
    style: { enhancement: "Balanced" },
    assets: { image_file_path: imageFilePath },
  });
  return res.id;
}

async function apiClothesChange(apiKey, personFilePath, garmentFilePath) {
  const res = await apiCall(apiKey, "/ai-clothes-changer", {
    assets: { person_file_path: personFilePath, garment_file_path: garmentFilePath },
  });
  return res.id;
}

async function apiCall(apiKey, endpoint, body) {
  const res = await fetch(API_BASE + endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "API error: " + res.status + " " + res.statusText);
  }
  return res.json();
}

async function pollForResult(apiKey, projectId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const res = await fetch(API_BASE + "/image-projects/" + projectId, {
      headers: { Authorization: "Bearer " + apiKey },
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

async function uploadFromUrl(apiKey, url) {
  const blob = await fetchAsBlob(url);
  return uploadBlob(apiKey, blob);
}

async function fetchAsBlob(url) {
  // If it's already a data URL, convert directly to blob
  if (url.startsWith("data:")) {
    const res = await fetch(url);
    return res.blob();
  }

  // Try fetch with headers that CDNs expect
  const headers = {
    "Accept": "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  };

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    // Retry without headers
    try {
      res = await fetch(url);
    } catch (e2) {
      throw new Error("Cannot fetch image. The site may be blocking direct access.");
    }
  }

  if (!res.ok) throw new Error("Failed to fetch image: " + res.status + " " + res.statusText);
  return res.blob();
}

async function uploadBlob(apiKey, blob) {
  const mimeMap = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
    "image/avif": "avif", "image/tiff": "tiff", "image/bmp": "bmp",
  };
  const ext = mimeMap[blob.type] || "png";

  const res = await fetch(API_BASE + "/files/upload-urls", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
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
