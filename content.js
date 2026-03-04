// ─── MagicHour Lens – Content Script ───

var mhSelectedImage = null;
var mhSelectedImageUrl = null;
var mhOverlays = [];
var mhLastHovered = null;

// ─── Image finder ───

function mhFindImage(x, y) {
  try {
    var els = document.elementsFromPoint(x, y);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.tagName === "IMG" && el.src) {
        return { el: el, url: el.currentSrc || el.src };
      }
      if (el.tagName === "PICTURE" || (el.closest && el.closest("picture"))) {
        var pic = el.tagName === "PICTURE" ? el : el.closest("picture");
        var img = pic.querySelector("img");
        if (img) return { el: img, url: img.currentSrc || img.src };
      }
    }
    for (var j = 0; j < els.length; j++) {
      var child = els[j].querySelector && els[j].querySelector("img[src]");
      if (child) return { el: child, url: child.currentSrc || child.src };
    }
  } catch (e) {}
  return null;
}

// ─── Hover highlight ───

document.addEventListener("mouseover", function (e) {
  try {
    var img = e.target.closest ? e.target.closest("img") : null;
    if (img && img !== mhSelectedImage) {
      mhApplyOutline(img, "2px dashed rgba(168, 85, 247, 0.7)");
      if (mhLastHovered && mhLastHovered !== img) {
        mhRemoveOutline(mhLastHovered);
      }
      mhLastHovered = img;
    }
  } catch (e) {}
}, true);

document.addEventListener("mouseout", function (e) {
  try {
    var img = e.target.closest ? e.target.closest("img") : null;
    if (img && img !== mhSelectedImage) {
      mhRemoveOutline(img);
    }
  } catch (e) {}
}, true);

// ─── Click to select ───

document.addEventListener("click", function (e) {
  try {
    var found = mhFindImage(e.clientX, e.clientY);
    if (!found) return;

    if (mhSelectedImage && mhSelectedImage !== found.el) {
      mhRemoveOutline(mhSelectedImage);
    }

    mhApplyOutline(found.el, "3px solid #a855f7");
    mhSelectedImage = found.el;
    mhSelectedImageUrl = found.url;

    try {
      var r = found.el.getBoundingClientRect();
      chrome.runtime.sendMessage({
        action: "imageSelected",
        imageUrl: found.url,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        width: found.el.naturalWidth || found.el.offsetWidth,
        height: found.el.naturalHeight || found.el.offsetHeight,
      });
    } catch (err) {}
  } catch (err) {}
}, true);

document.addEventListener("contextmenu", function (e) {
  try {
    var found = mhFindImage(e.clientX, e.clientY);
    if (found) {
      if (mhSelectedImage) mhRemoveOutline(mhSelectedImage);
      mhApplyOutline(found.el, "3px solid #a855f7");
      mhSelectedImage = found.el;
      mhSelectedImageUrl = found.url;
    }
  } catch (err) {}
}, true);

// ─── Inline outline (bypasses CSS specificity issues) ───

function mhApplyOutline(el, outline) {
  el.style.setProperty("outline", outline, "important");
  el.style.setProperty("outline-offset", "2px", "important");
}

function mhRemoveOutline(el) {
  el.style.removeProperty("outline");
  el.style.removeProperty("outline-offset");
}

// ─── Messages from popup / background ───

try {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    try {
      if (msg.action === "getSelectedImage") {
        var imgUrl = mhSelectedImageUrl || (mhSelectedImage ? mhSelectedImage.src : null);
        var rect = null;
        if (mhSelectedImage) {
          var r = mhSelectedImage.getBoundingClientRect();
          rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        sendResponse({
          imageUrl: imgUrl,
          rect: rect,
          width: mhSelectedImage ? (mhSelectedImage.naturalWidth || mhSelectedImage.offsetWidth) : 0,
          height: mhSelectedImage ? (mhSelectedImage.naturalHeight || mhSelectedImage.offsetHeight) : 0,
        });
        return;
      }

      if (msg.action === "getAllImages") {
        var imgs = document.querySelectorAll("img");
        var results = [];
        for (var i = 0; i < imgs.length; i++) {
          var img = imgs[i];
          if (!img.src || img.offsetWidth < 50 || img.offsetHeight < 50) continue;
          results.push({
            url: img.currentSrc || img.src,
            index: i,
            width: img.naturalWidth || img.offsetWidth,
            height: img.naturalHeight || img.offsetHeight,
          });
        }
        sendResponse({ images: results });
        return;
      }

      if (msg.action === "transformAllStart") {
        var allImgs = document.querySelectorAll("img");
        var targetImg = allImgs[msg.index];
        if (targetImg) mhShowLoading(targetImg);
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === "transformAllComplete") {
        var allImgs2 = document.querySelectorAll("img");
        for (var k = 0; k < allImgs2.length; k++) {
          var src = allImgs2[k].currentSrc || allImgs2[k].src;
          if (src === msg.originalUrl) {
            mhShowResult(allImgs2[k], msg.resultUrl);
            break;
          }
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === "transformAllError") {
        var allImgs3 = document.querySelectorAll("img");
        for (var m = 0; m < allImgs3.length; m++) {
          var src3 = allImgs3[m].currentSrc || allImgs3[m].src;
          if (src3 === msg.originalUrl) {
            mhRemoveLoading(allImgs3[m]);
            break;
          }
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === "selectImage" || msg.action === "contextMenuTransform") {
        var imgs2 = document.querySelectorAll("img");
        for (var j = 0; j < imgs2.length; j++) {
          if (imgs2[j].src === msg.imageUrl) {
            if (mhSelectedImage) mhRemoveOutline(mhSelectedImage);
            mhSelectedImage = imgs2[j];
            mhSelectedImageUrl = imgs2[j].src;
            mhApplyOutline(imgs2[j], "3px solid #a855f7");
            break;
          }
        }
        if (msg.action === "contextMenuTransform") {
          mhStartContextMenuTransform(msg.imageUrl);
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === "startTransform") {
        if (mhSelectedImage) mhShowLoading(mhSelectedImage);
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === "transformComplete") {
        if (mhSelectedImage) {
          mhShowResult(mhSelectedImage, msg.resultUrl);
          mhRemoveOutline(mhSelectedImage);
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === "transformError") {
        if (mhSelectedImage) {
          mhRemoveLoading(mhSelectedImage);
          mhShowToast(msg.error, "error");
          mhRemoveOutline(mhSelectedImage);
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === "getAutoStatus") {
        chrome.storage.local.get(["autoMinSize"], function (d) {
          var minSize = d.autoMinSize || 200;
          var allImgs = document.querySelectorAll("img");
          var eligible = 0;
          var queued = 0;
          var processing = 0;
          var done = 0;
          var errors = 0;
          for (var si = 0; si < allImgs.length; si++) {
            var simg = allImgs[si];
            var sw = simg.naturalWidth || simg.offsetWidth;
            var sh = simg.naturalHeight || simg.offsetHeight;
            if (sw >= minSize || sh >= minSize) eligible++;
            var attr = simg.getAttribute("data-mh-auto");
            if (attr === "queued") queued++;
            else if (attr === "processing") processing++;
            else if (attr === "done") done++;
            else if (attr === "error") errors++;
          }
          sendResponse({
            enabled: mhAutoEnabled,
            totalImages: allImgs.length,
            eligible: eligible,
            minSize: minSize,
            queued: queued,
            processing: processing,
            done: done,
            errors: errors,
          });
        });
        return true;
      }

      if (msg.action === "autoFaceSwapToggle") {
        if (msg.enabled) {
          mhAutoStart();
        } else {
          mhAutoStop();
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === "clearAllOverlays") {
        mhClearAll();
        sendResponse({ ok: true });
        return;
      }
    } catch (err) {}
  });
} catch (err) {}

// ─── Context Menu Transform ───

async function mhStartContextMenuTransform(imageUrl) {
  var el = mhSelectedImage || document.querySelector('img[src="' + imageUrl.replace(/"/g, '\\"') + '"]');
  if (!el) return;

  mhShowLoading(el);

  try {
    var settings = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ action: "getSettings" }, resolve);
    });

    if (!settings || !settings.apiKey) {
      mhRemoveLoading(el);
      mhShowToast("Add your API key in MagicHour Lens settings first.", "error");
      return;
    }

    var result = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ action: "transform", imageUrl: imageUrl, settings: settings }, resolve);
    });

    if (result && result.error) {
      mhRemoveLoading(el);
      mhShowToast(result.error, "error");
    } else if (result && result.resultUrl) {
      mhShowResult(el, result.resultUrl);
    }
  } catch (err) {
    mhRemoveLoading(el);
    mhShowToast(err.message, "error");
  }
}

// ─── Loading Overlay ───

function mhShowLoading(imgEl) {
  mhRemoveLoading(imgEl);
  var wrapper = mhWrap(imgEl);
  var overlay = document.createElement("div");
  overlay.className = "mh-loading-overlay";
  overlay.innerHTML = '<div class="mh-spinner"><div class="mh-spinner-ring"></div><span class="mh-spinner-text">Transforming...</span></div>';
  wrapper.appendChild(overlay);
}

function mhRemoveLoading(imgEl) {
  var wrapper = imgEl.closest ? imgEl.closest(".mh-wrapper") : null;
  if (wrapper) {
    var loading = wrapper.querySelector(".mh-loading-overlay");
    if (loading) loading.remove();
  }
}

// ─── Result Overlay ───

function mhShowResult(imgEl, resultUrl) {
  mhRemoveLoading(imgEl);
  mhRemoveOutline(imgEl);
  var wrapper = mhWrap(imgEl);

  var overlay = document.createElement("div");
  overlay.className = "mh-result-overlay";

  var resultImg = document.createElement("img");
  resultImg.src = resultUrl;
  resultImg.className = "mh-result-image";

  var actionBar = document.createElement("div");
  actionBar.className = "mh-action-bar";

  var downloadBtn = document.createElement("button");
  downloadBtn.className = "mh-download-btn";
  downloadBtn.textContent = "Download";
  downloadBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    fetch(resultUrl)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "magichour-lens-transform.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
  });

  var toggleBtn = document.createElement("button");
  toggleBtn.className = "mh-toggle-btn";
  toggleBtn.textContent = "Original";
  toggleBtn.addEventListener("mousedown", function (e) {
    e.stopPropagation();
    overlay.classList.add("mh-peek");
  });
  toggleBtn.addEventListener("mouseup", function () {
    overlay.classList.remove("mh-peek");
  });
  toggleBtn.addEventListener("mouseleave", function () {
    overlay.classList.remove("mh-peek");
  });

  var shareBtn = document.createElement("button");
  shareBtn.className = "mh-share-btn";
  shareBtn.textContent = "Share";
  shareBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    mhShareResult(resultUrl, resultImg);
  });

  var closeBtn = document.createElement("button");
  closeBtn.className = "mh-close-btn";
  closeBtn.textContent = "Remove";
  closeBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    overlay.classList.add("mh-fade-out");
    setTimeout(function () {
      overlay.remove();
      mhUnwrap(wrapper, imgEl);
    }, 300);
    mhOverlays = mhOverlays.filter(function (o) { return o.wrapper !== wrapper; });
  });

  actionBar.appendChild(downloadBtn);
  actionBar.appendChild(shareBtn);
  actionBar.appendChild(toggleBtn);
  actionBar.appendChild(closeBtn);
  overlay.appendChild(resultImg);
  overlay.appendChild(actionBar);
  wrapper.appendChild(overlay);

  mhOverlays.push({ wrapper: wrapper, imgEl: imgEl });
  requestAnimationFrame(function () { overlay.classList.add("mh-visible"); });
}

// ─── Wrapper ───

function mhWrap(imgEl) {
  if (imgEl.parentElement && imgEl.parentElement.classList.contains("mh-wrapper")) {
    return imgEl.parentElement;
  }
  var wrapper = document.createElement("div");
  wrapper.className = "mh-wrapper";
  var cs = getComputedStyle(imgEl);
  wrapper.style.position = cs.position === "static" ? "relative" : cs.position;
  wrapper.style.display = cs.display === "inline" ? "inline-block" : cs.display;
  var w = Math.max(imgEl.offsetWidth, 200);
  var h = Math.max(imgEl.offsetHeight, 150);
  wrapper.style.width = w + "px";
  wrapper.style.height = h + "px";
  wrapper.style.overflow = "visible";
  wrapper.style.borderRadius = cs.borderRadius;
  wrapper.style.zIndex = "9999";
  imgEl.parentElement.insertBefore(wrapper, imgEl);
  wrapper.appendChild(imgEl);
  return wrapper;
}

function mhUnwrap(wrapper, imgEl) {
  if (wrapper && !wrapper.querySelector(".mh-result-overlay, .mh-loading-overlay")) {
    wrapper.parentElement.insertBefore(imgEl, wrapper);
    wrapper.remove();
    mhRemoveOutline(imgEl);
  }
}

function mhClearAll() {
  mhOverlays.forEach(function (o) {
    var overlay = o.wrapper.querySelector(".mh-result-overlay");
    if (overlay) overlay.remove();
    mhUnwrap(o.wrapper, o.imgEl);
  });
  mhOverlays = [];
}

// ─── Share ───

function mhShareResult(resultUrl, resultImgEl) {
  var REFERRAL_URL = "https://magichour.ai?ref=falconhacks";
  var SHARE_TEXT = "Transformed with MagicHour Lens - AI image transforms right in your browser! Try it: " + REFERRAL_URL;

  // Try native Web Share API with image (mobile + modern desktop)
  if (navigator.share && navigator.canShare) {
    fetch(resultUrl)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var file = new File([blob], "magichour-transform.png", { type: "image/png" });
        var shareData = { text: SHARE_TEXT, files: [file] };
        if (navigator.canShare(shareData)) {
          return navigator.share(shareData);
        }
        // Fallback if file sharing not supported
        return navigator.share({ text: SHARE_TEXT, url: REFERRAL_URL });
      })
      .catch(function () {
        mhCopyShareLink(SHARE_TEXT);
      });
  } else {
    // Fallback: copy share text to clipboard
    mhCopyShareLink(SHARE_TEXT);
  }
}

function mhCopyShareLink(text) {
  navigator.clipboard.writeText(text).then(function () {
    mhShowToast("Share link copied to clipboard!", "success");
  }).catch(function () {
    // Final fallback
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    mhShowToast("Share link copied to clipboard!", "success");
  });
}

// ─── Auto Face Swap Engine ───

var mhAutoEnabled = false;
var mhAutoObserver = null;
var mhAutoQueue = [];
var mhAutoActive = 0;
var mhAutoMaxConcurrent = 2;

function mhAutoInit() {
  chrome.storage.local.get(["autoFaceSwap"], function (data) {
    if (data.autoFaceSwap) {
      mhAutoStart();
    }
  });

  // React to storage changes (toggle from another tab or popup)
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.autoFaceSwap) {
      if (changes.autoFaceSwap.newValue) {
        mhAutoStart();
      } else {
        mhAutoStop();
      }
    }
  });
}

function mhAutoStart() {
  if (mhAutoEnabled) return;
  mhAutoEnabled = true;
  console.log("[MH Auto] Started — scanning page for images...");
  mhAutoScan();
  mhAutoObserve();
}

function mhAutoStop() {
  mhAutoEnabled = false;
  mhAutoQueue = [];
  if (mhAutoObserver) {
    mhAutoObserver.disconnect();
    mhAutoObserver = null;
  }
  console.log("[MH Auto] Stopped");
}

function mhAutoScan() {
  if (!mhAutoEnabled) return;
  chrome.storage.local.get(["autoMinSize"], function (data) {
    var minSize = data.autoMinSize || 200;
    var imgs = document.querySelectorAll("img");
    console.log("[MH Auto] Scanning " + imgs.length + " images (min size: " + minSize + "px)");
    var queued = 0;
    for (var i = 0; i < imgs.length; i++) {
      var before = mhAutoQueue.length;
      mhAutoMaybeQueue(imgs[i], minSize);
      if (mhAutoQueue.length > before) queued++;
    }
    console.log("[MH Auto] Queued " + queued + " images for face swap");
  });
}

function mhAutoMaybeQueue(img, minSize) {
  if (!mhAutoEnabled) return;
  if (!img.src || img.src.startsWith("data:") || img.src.startsWith("blob:")) return;
  // Skip unsupported formats
  if (/\.(gif|svg|ico)(\?|$)/i.test(img.src)) return;
  if (img.getAttribute("data-mh-auto")) return;

  // Check size using both natural and offset dimensions
  var w = img.naturalWidth || img.offsetWidth;
  var h = img.naturalHeight || img.offsetHeight;

  if (w >= minSize || h >= minSize) {
    img.setAttribute("data-mh-auto", "queued");
    mhAutoQueue.push(img);
    mhAutoProcessNext();
  } else if (!img.complete) {
    // Image not loaded yet — wait for it and re-check
    img.addEventListener("load", function onLoad() {
      img.removeEventListener("load", onLoad);
      if (img.getAttribute("data-mh-auto")) return; // already queued
      var lw = img.naturalWidth || img.offsetWidth;
      var lh = img.naturalHeight || img.offsetHeight;
      if (lw >= minSize || lh >= minSize) {
        img.setAttribute("data-mh-auto", "queued");
        mhAutoQueue.push(img);
        mhAutoProcessNext();
      }
    });
  }
}

function mhAutoProcessNext() {
  if (!mhAutoEnabled) return;
  if (mhAutoActive >= mhAutoMaxConcurrent) return;
  if (mhAutoQueue.length === 0) return;

  var img = mhAutoQueue.shift();
  if (!img || !img.isConnected) {
    mhAutoProcessNext();
    return;
  }

  mhAutoActive++;
  img.setAttribute("data-mh-auto", "processing");

  var imageUrl = img.currentSrc || img.src;
  console.log("[MH Auto] Processing:", imageUrl.substring(0, 80));

  chrome.runtime.sendMessage(
    { action: "autoFaceSwap", imageUrl: imageUrl },
    function (response) {
      mhAutoActive--;
      if (chrome.runtime.lastError) {
        console.error("[MH Auto] Message error:", chrome.runtime.lastError.message);
        img.setAttribute("data-mh-auto", "error");
        mhAutoProcessNext();
        return;
      }
      if (response && response.resultUrl) {
        console.log("[MH Auto] Swapped:", imageUrl.substring(0, 60));
        img.setAttribute("data-mh-original-src", imageUrl);
        img.src = response.resultUrl;
        img.setAttribute("data-mh-auto", "done");
        mhAutoAddBadge(img);
      } else {
        console.warn("[MH Auto] Failed:", response?.error || "no result");
        img.setAttribute("data-mh-auto", "error");
      }
      mhAutoProcessNext();
    }
  );
}

function mhAutoAddBadge(img) {
  var parent = img.parentElement;
  if (!parent) return;

  // Ensure parent is positioned
  var cs = getComputedStyle(parent);
  if (cs.position === "static") {
    parent.style.position = "relative";
  }

  var badge = document.createElement("div");
  badge.className = "mh-auto-badge";
  badge.title = "Face swapped by MagicHour Lens";
  parent.appendChild(badge);
}

function mhAutoObserve() {
  if (mhAutoObserver) return;
  mhAutoObserver = new MutationObserver(function (mutations) {
    if (!mhAutoEnabled) return;
    chrome.storage.local.get(["autoMinSize"], function (data) {
      var minSize = data.autoMinSize || 200;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.tagName === "IMG") {
            mhAutoMaybeQueue(node, minSize);
          } else if (node.querySelectorAll) {
            var imgs = node.querySelectorAll("img");
            for (var k = 0; k < imgs.length; k++) {
              mhAutoMaybeQueue(imgs[k], minSize);
            }
          }
        }
      }
    });
  });
  mhAutoObserver.observe(document.body, { childList: true, subtree: true });
}

// Initialize auto mode on load
mhAutoInit();

// ─── Toast (only for errors) ───

function mhShowToast(message, type) {
  var existing = document.querySelector(".mh-toast");
  if (existing) existing.remove();
  var toast = document.createElement("div");
  toast.className = "mh-toast mh-toast-" + (type || "error");
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(function () { toast.classList.add("mh-toast-visible"); });
  setTimeout(function () {
    toast.classList.remove("mh-toast-visible");
    setTimeout(function () { toast.remove(); }, 300);
  }, 3000);
}
