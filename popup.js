// ─── MagicHour Lens – Popup Script ───

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentMode = "style";
let selectedImageUrl = null;
let selectedImageDataUrl = null;
let isTransforming = false;

// ─── Init ───

document.addEventListener("DOMContentLoaded", async () => {
  // Load saved settings
  const settings = await getSettings();
  if (settings.apiKey) $("#apiKeyInput").value = settings.apiKey;
  if (settings.model) $("#modelSelect").value = settings.model;
  if (settings.stylePrompt) $("#stylePrompt").value = settings.stylePrompt;
  if (settings.customPrompt) $("#editPrompt").value = settings.customPrompt;
  if (settings.faceImage) showUploadPreview("face", settings.faceImage);
  if (settings.clothesImage) showUploadPreview("clothes", settings.clothesImage);

  // Check for pending image from context menu
  const pending = await new Promise((r) =>
    chrome.storage.local.get(["_pendingImage", "_pendingTabId"], r)
  );
  if (pending._pendingImage) {
    selectImage(pending._pendingImage, null, null);
    window._mhTabId = pending._pendingTabId;
    chrome.storage.local.remove(["_pendingImage", "_pendingTabId"]);
  } else {
    // Normal popup — check for selected image on page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelectedImage" });
        if (response?.imageUrl) {
          const preview = response.imageDataUrl || await captureImagePreview(tab.id, response.rect);
          selectImage(response.imageUrl, preview, response.imageDataUrl);
        }
      } catch {}
    }
  }

  // Event listeners
  setupModeButtons();
  setupFileUploads();
  setupSettings();
  setupTransform();
});

// Listen for image selection messages from content script
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === "imageSelected" && msg.imageUrl) {
    const preview = msg.imageDataUrl;
    if (!preview) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const captured = tab?.id ? await captureImagePreview(tab.id, msg.rect) : null;
      selectImage(msg.imageUrl, captured, msg.imageDataUrl);
    } else {
      selectImage(msg.imageUrl, preview, msg.imageDataUrl);
    }
  }
});

// ─── Image Selection ───

function selectImage(url, previewDataUrl, imageDataUrl) {
  selectedImageUrl = url;
  selectedImageDataUrl = imageDataUrl || null;
  if (previewDataUrl) {
    $("#previewImg").src = previewDataUrl;
  } else {
    $("#previewImg").src = url;
  }
  $("#previewBox").classList.remove("empty");
  updateTransformButton();
}

// Capture visible tab and crop to image rect
async function captureImagePreview(tabId, rect) {
  if (!rect || !rect.width || !rect.height) return null;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    // Get device pixel ratio from tab
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.devicePixelRatio || 1,
    });
    const dpr = results?.[0]?.result || 1;

    // Crop the screenshot to the image area
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(
      img,
      rect.x * dpr, rect.y * dpr,
      rect.width * dpr, rect.height * dpr,
      0, 0,
      rect.width * dpr, rect.height * dpr
    );
    return canvas.toDataURL("image/png");
  } catch (e) {
    return null;
  }
}

// ─── Mode Switching ───

function setupModeButtons() {
  $$(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".mode-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentMode = btn.dataset.mode;

      // Show/hide relevant options
      $$(".opt-group").forEach((g) => (g.style.display = "none"));
      const optGroup = $(`.opt-group[data-for="${currentMode}"]`);
      if (optGroup) optGroup.style.display = "block";

      updateTransformButton();
    });
  });
}

// ─── File Uploads ───

function setupFileUploads() {
  // Face upload
  $("#faceUploadArea").addEventListener("click", () => $("#faceUpload").click());
  $("#faceUpload").addEventListener("change", (e) => {
    handleFileUpload(e.target.files[0], "face");
  });

  // Clothes upload
  $("#clothesUploadArea").addEventListener("click", () => $("#clothesUpload").click());
  $("#clothesUpload").addEventListener("change", (e) => {
    handleFileUpload(e.target.files[0], "clothes");
  });
}

function handleFileUpload(file, type) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    showUploadPreview(type, dataUrl);

    // Save to storage
    const key = type === "face" ? "faceImage" : "clothesImage";
    chrome.storage.local.set({ [key]: dataUrl });
  };
  reader.readAsDataURL(file);
}

function showUploadPreview(type, dataUrl) {
  const preview = $(`#${type}Preview`);
  const area = $(`#${type}UploadArea`);
  preview.src = dataUrl;
  preview.style.display = "block";
  area.classList.add("has-image");
  updateTransformButton();
}

// ─── Settings ───

function setupSettings() {
  $("#settingsToggle").addEventListener("click", () => {
    $("#mainView").style.display = "none";
    $("#settingsView").style.display = "block";
  });

  $("#backToMain").addEventListener("click", () => {
    $("#settingsView").style.display = "none";
    $("#mainView").style.display = "block";
  });

  $("#toggleApiKey").addEventListener("click", () => {
    const input = $("#apiKeyInput");
    input.type = input.type === "password" ? "text" : "password";
  });

  $("#saveSettings").addEventListener("click", async () => {
    const settings = {
      apiKey: $("#apiKeyInput").value.trim(),
      model: $("#modelSelect").value,
    };
    await saveSettings(settings);
    $("#settingsView").style.display = "none";
    $("#mainView").style.display = "block";
  });
}

// ─── Transform ───

function setupTransform() {
  $("#transformBtn").addEventListener("click", () => startTransform());

  $("#transformAllBtn").addEventListener("click", () => startTransformAll());

  $("#clearBtn").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: "clearAllOverlays" });
      $("#clearBtn").style.display = "none";
    }
  });
}

function updateTransformButton() {
  const btn = $("#transformBtn");
  const hasImage = !!selectedImageUrl;
  const needsFace = currentMode === "faceswap";
  const needsClothes = currentMode === "clothes";

  let ready = hasImage;
  if (needsFace && !$("#facePreview").src) ready = false;
  if (needsClothes && !$("#clothesPreview").src) ready = false;

  btn.disabled = !ready || isTransforming;
}

async function startTransform() {
  if (isTransforming || !selectedImageUrl) return;

  // Get tab ID — either from context menu or from active tab
  let tabId = window._mhTabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  if (!tabId) return;

  // Build settings
  const stored = await getSettings();
  const settings = {
    apiKey: stored.apiKey,
    mode: currentMode,
    model: stored.model || "qwen-edit",
    stylePrompt: $("#stylePrompt")?.value || stored.stylePrompt,
    customPrompt: $("#editPrompt")?.value || stored.customPrompt,
    faceImage: stored.faceImage,
    clothesImage: stored.clothesImage,
  };

  // Save current prompts
  chrome.storage.local.set({
    stylePrompt: settings.stylePrompt,
    customPrompt: settings.customPrompt,
  });

  if (!settings.apiKey) {
    alert("Add your MagicHour API key in settings first.");
    return;
  }

  // Show loading state in popup
  isTransforming = true;
  $("#transformBtn .btn-text").style.display = "none";
  $("#transformBtn .btn-loading").style.display = "inline-flex";
  $("#transformBtn").disabled = true;

  try {
    // Tell content script to show loading spinner — await to ensure delivery
    await chrome.tabs.sendMessage(tabId, { action: "startTransform" });
  } catch (e) {
    // Content script may not be ready, continue anyway
  }

  // Fire transform to background and AWAIT the acknowledgement
  // Send data URL if available so background doesn't need to fetch from CDN
  await chrome.runtime.sendMessage({
    action: "transformFromPopup",
    tabId: tabId,
    imageUrl: selectedImageDataUrl || selectedImageUrl,
    settings,
  });

  // Close popup — background handles the rest and sends result to content script
  window.close();
}

async function startTransformAll() {
  const stored = await getSettings();
  if (!stored.apiKey) {
    alert("Add your MagicHour API key in settings first.");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    alert("No active tab found.");
    return;
  }

  // Always use the style prompt for "Transform All"
  const stylePrompt = $("#stylePrompt")?.value || stored.stylePrompt || "Transform this image into anime style art";

  const settings = {
    apiKey: stored.apiKey,
    mode: currentMode,
    model: stored.model || "qwen-edit",
    stylePrompt: stylePrompt,
    customPrompt: $("#editPrompt")?.value || stored.customPrompt,
    faceImage: stored.faceImage,
    clothesImage: stored.clothesImage,
  };

  // Save current prompts
  chrome.storage.local.set({
    stylePrompt: settings.stylePrompt,
    customPrompt: settings.customPrompt,
  });

  // Ensure content script is injected
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
  } catch (e) {}

  // Ask content script for all images on page
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { action: "getAllImages" });
  } catch (e) {
    alert("Could not connect to page. Try refreshing the page first.");
    return;
  }

  if (!response?.images?.length) {
    alert("No images found on this page (images must be at least 50x50px).");
    return;
  }

  // Send all images to background for batch transform
  try {
    await chrome.runtime.sendMessage({
      action: "transformAllFromPopup",
      tabId: tab.id,
      images: response.images,
      settings,
    });
  } catch (e) {
    alert("Failed to start transform: " + e.message);
    return;
  }

  window.close();
}

// ─── Storage Helpers ───

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["apiKey", "mode", "stylePrompt", "faceImage", "customPrompt", "model", "clothesImage"],
      (data) => resolve(data || {})
    );
  });
}

function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, resolve);
  });
}
