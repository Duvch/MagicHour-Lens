// ─── MagicHour Lens – Popup Script ───

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentMode = "style";
let selectedImageUrl = null;
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

  // Auto Face Swap settings
  if (settings.autoFaceSwap) {
    $("#autoFaceSwapToggle").checked = true;
    $("#autoFaceSettings").style.display = "block";
    $("#autoMinSizeRow").style.display = "block";
    $("#autoStatusRow").style.display = "block";
  }
  if (settings.autoMinSize) $("#autoMinSize").value = settings.autoMinSize;
  if (settings.autoFaceImage) showUploadPreview("autoFace", settings.autoFaceImage);

  // Check for pending image from context menu
  const pending = await new Promise((r) =>
    chrome.storage.local.get(["_pendingImage", "_pendingTabId"], r)
  );
  if (pending._pendingImage) {
    selectImage(pending._pendingImage);
    window._mhTabId = pending._pendingTabId;
    chrome.storage.local.remove(["_pendingImage", "_pendingTabId"]);
  } else {
    // Normal popup — check for selected image on page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelectedImage" });
        if (response?.imageUrl) {
          const preview = await captureImagePreview(tab.id, response.rect);
          selectImage(response.imageUrl, preview);
        }
      } catch {}
    }
  }

  // Event listeners
  setupModeButtons();
  setupFileUploads();
  setupSettings();
  setupTransform();

  // Show free credits if no API key
  updateCreditsDisplay(settings);
});

// Listen for image selection messages from content script
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === "imageSelected" && msg.imageUrl) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const preview = tab?.id ? await captureImagePreview(tab.id, msg.rect) : null;
    selectImage(msg.imageUrl, preview);
  }
});

// ─── Image Selection ───

function selectImage(url, previewDataUrl) {
  selectedImageUrl = url;
  $("#previewImg").src = previewDataUrl || url;
  $("#previewBox").classList.remove("empty");
  updateTransformButton();
}

// Capture visible tab and crop to image rect
async function captureImagePreview(tabId, rect) {
  if (!rect || !rect.width || !rect.height) return null;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.devicePixelRatio || 1,
    });
    const dpr = results?.[0]?.result || 1;

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

      $$(".opt-group").forEach((g) => (g.style.display = "none"));
      const optGroup = $(`.opt-group[data-for="${currentMode}"]`);
      if (optGroup) optGroup.style.display = "block";

      updateTransformButton();
    });
  });
}

// ─── File Uploads ───

function setupFileUploads() {
  $("#faceUploadArea").addEventListener("click", () => $("#faceUpload").click());
  $("#faceUpload").addEventListener("change", (e) => {
    handleFileUpload(e.target.files[0], "face");
  });

  $("#clothesUploadArea").addEventListener("click", () => $("#clothesUpload").click());
  $("#clothesUpload").addEventListener("change", (e) => {
    handleFileUpload(e.target.files[0], "clothes");
  });

  $("#autoFaceUploadArea").addEventListener("click", () => $("#autoFaceUpload").click());
  $("#autoFaceUpload").addEventListener("change", (e) => {
    handleFileUpload(e.target.files[0], "autoFace");
  });
}

function handleFileUpload(file, type) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    showUploadPreview(type, dataUrl);

    const keyMap = { face: "faceImage", clothes: "clothesImage", autoFace: "autoFaceImage" };
    const key = keyMap[type] || "faceImage";
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

  // Auto Face Swap toggle — show/hide sub-settings
  $("#autoFaceSwapToggle").addEventListener("change", () => {
    const on = $("#autoFaceSwapToggle").checked;
    $("#autoFaceSettings").style.display = on ? "block" : "none";
    $("#autoMinSizeRow").style.display = on ? "block" : "none";
    $("#autoStatusRow").style.display = on ? "block" : "none";
  });

  // Check Auto Swap Status
  $("#checkAutoStatus").addEventListener("click", () => checkAutoStatus());

  $("#saveSettings").addEventListener("click", async () => {
    const autoFaceSwap = $("#autoFaceSwapToggle").checked;
    const settings = {
      apiKey: $("#apiKeyInput").value.trim(),
      model: $("#modelSelect").value,
      autoFaceSwap,
      autoMinSize: parseInt($("#autoMinSize").value, 10) || 200,
    };
    await saveSettings(settings);

    // Notify active tab content script about toggle change
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: "autoFaceSwapToggle",
          enabled: autoFaceSwap,
        }).catch(() => {});
      }
    } catch {}

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

  let tabId = window._mhTabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  if (!tabId) return;

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

  chrome.storage.local.set({
    stylePrompt: settings.stylePrompt,
    customPrompt: settings.customPrompt,
  });

  isTransforming = true;
  $("#transformBtn .btn-text").style.display = "none";
  $("#transformBtn .btn-loading").style.display = "inline-flex";
  $("#transformBtn").disabled = true;

  try {
    await chrome.tabs.sendMessage(tabId, { action: "startTransform" });
  } catch (e) {}

  await chrome.runtime.sendMessage({
    action: "transformFromPopup",
    tabId: tabId,
    imageUrl: selectedImageUrl,
    settings,
  });

  window.close();
}

async function startTransformAll() {
  const stored = await getSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    alert("No active tab found.");
    return;
  }

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

  chrome.storage.local.set({
    stylePrompt: settings.stylePrompt,
    customPrompt: settings.customPrompt,
  });

  // Ensure content script is injected
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
  } catch (e) {}

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

// ─── Auto Status Check ───

async function checkAutoStatus() {
  const panel = $("#autoStatusPanel");
  panel.style.display = "block";
  panel.innerHTML = '<span style="color:#888">Checking...</span>';

  const settings = await getSettings();
  const lines = [];

  function line(ok, text) {
    const cls = ok === true ? "status-ok" : ok === false ? "status-fail" : "status-warn";
    const icon = ok === true ? "\u2713" : ok === false ? "\u2717" : "\u26A0";
    lines.push(`<div class="status-line ${cls}"><span class="status-icon">${icon}</span> ${text}</div>`);
  }

  // Check API key
  if (settings.apiKey) {
    line(true, "API key configured");
  } else {
    line(false, "API key missing — set it above");
  }

  // Check auto mode
  if (settings.autoFaceSwap) {
    line(true, "Auto Face Swap enabled");
  } else {
    line(false, "Auto Face Swap is OFF — enable & save");
  }

  // Check face image
  if (settings.autoFaceImage) {
    line(true, "Face photo uploaded");
  } else {
    line(false, "No face photo — upload one above");
  }

  // Check content script connection & page images
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "getAutoStatus" });
      if (response) {
        line(true, `Content script connected`);
        line(response.enabled ? true : null, `Auto scan: ${response.enabled ? "running" : "not running"}`);
        line(true, `Images on page: ${response.totalImages}`);
        line(response.eligible > 0 ? true : null, `Eligible (above ${response.minSize}px): ${response.eligible}`);
        if (response.queued > 0) line(null, `Queued: ${response.queued}`);
        if (response.processing > 0) line(null, `Processing: ${response.processing}`);
        if (response.done > 0) line(true, `Swapped: ${response.done}`);
        if (response.errors > 0) line(false, `Errors: ${response.errors}`);
      }
    }
  } catch {
    line(false, "Cannot reach content script — try refreshing the page");
  }

  panel.innerHTML = lines.join("");
}

// ─── Credits Display ───

async function updateCreditsDisplay(settings) {
  const el = $("#creditsInfo");
  const text = $("#creditsText");
  if (settings && settings.apiKey) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  text.textContent = "Loading credits...";
  try {
    const credits = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getCredits" }, resolve);
    });
    if (credits.remaining > 0) {
      text.innerHTML = `<span class="credits-count">${credits.remaining}/${credits.limit}</span> free transforms remaining today`;
    } else {
      text.innerHTML = `<span class="credits-limit">Daily free limit reached.</span> Add an API key in settings for unlimited use.`;
    }
  } catch {
    text.textContent = "Free tier available — no API key needed";
  }
}

// ─── Storage Helpers ───

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["apiKey", "mode", "stylePrompt", "faceImage", "customPrompt", "model", "clothesImage", "autoFaceSwap", "autoMinSize", "autoFaceImage"],
      (data) => resolve(data || {})
    );
  });
}

function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, resolve);
  });
}
