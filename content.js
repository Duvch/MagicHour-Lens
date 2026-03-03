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
      // Try to get image data URL from page context (avoids CDN fetch issues)
      mhGetImageDataUrl(found.el, function (dataUrl) {
        chrome.runtime.sendMessage({
          action: "imageSelected",
          imageUrl: found.url,
          imageDataUrl: dataUrl,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          width: found.el.naturalWidth || found.el.offsetWidth,
          height: found.el.naturalHeight || found.el.offsetHeight,
        });
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
    // Handle getSelectedImage separately — it needs async response
    if (msg.action === "getSelectedImage") {
      var imgUrl = mhSelectedImageUrl || (mhSelectedImage ? mhSelectedImage.src : null);
      var rect = null;
      if (mhSelectedImage) {
        var r = mhSelectedImage.getBoundingClientRect();
        rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      if (mhSelectedImage) {
        mhGetImageDataUrl(mhSelectedImage, function (dataUrl) {
          sendResponse({
            imageUrl: imgUrl,
            imageDataUrl: dataUrl,
            rect: rect,
            width: mhSelectedImage ? (mhSelectedImage.naturalWidth || mhSelectedImage.offsetWidth) : 0,
            height: mhSelectedImage ? (mhSelectedImage.naturalHeight || mhSelectedImage.offsetHeight) : 0,
          });
        });
        return true; // keep channel open for async response
      }
      sendResponse({ imageUrl: imgUrl, rect: rect, width: 0, height: 0 });
      return false;
    }

    try {

      if (msg.action === "getAllImages") {
        var imgs = document.querySelectorAll("img");
        var results = [];
        for (var i = 0; i < imgs.length; i++) {
          var img = imgs[i];
          if (!img.src || img.offsetWidth < 50 || img.offsetHeight < 50) continue;
          // Skip tiny icons/avatars, only transform visible images
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
        // Show loading on a specific image by index
        var allImgs = document.querySelectorAll("img");
        var targetImg = allImgs[msg.index];
        if (targetImg) mhShowLoading(targetImg);
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === "transformAllComplete") {
        // Show result on a specific image by its original URL
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
        var imgs = document.querySelectorAll("img");
        for (var i = 0; i < imgs.length; i++) {
          if (imgs[i].src === msg.imageUrl) {
            if (mhSelectedImage) mhRemoveOutline(mhSelectedImage);
            mhSelectedImage = imgs[i];
            mhSelectedImageUrl = imgs[i].src;
            mhApplyOutline(imgs[i], "3px solid #a855f7");
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

// ─── Image Data URL Capture ───

// Fetches image via page's own context (with cookies/auth), converts to data URL
function mhGetImageDataUrl(imgEl, callback) {
  var id = "mh_" + Math.random().toString(36).slice(2);
  // Listen for result from injected script
  function onMessage(event) {
    if (event.data && event.data.type === id) {
      window.removeEventListener("message", onMessage);
      callback(event.data.dataUrl || null);
    }
  }
  window.addEventListener("message", onMessage);

  // Inject script into MAIN world to fetch with page's cookies
  var script = document.createElement("script");
  script.textContent = '(' + function (imgSrc, msgId) {
    fetch(imgSrc, { credentials: "include" })
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var reader = new FileReader();
        reader.onload = function () {
          window.postMessage({ type: msgId, dataUrl: reader.result }, "*");
        };
        reader.readAsDataURL(blob);
      })
      .catch(function () {
        // Fallback: try canvas
        var img = document.querySelector('img[src="' + imgSrc.replace(/"/g, '\\"') + '"]');
        if (!img) img = document.querySelector('img[src*="' + imgSrc.split("?")[0].slice(-30).replace(/"/g, '\\"') + '"]');
        if (img) {
          try {
            var c = document.createElement("canvas");
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            c.getContext("2d").drawImage(img, 0, 0);
            window.postMessage({ type: msgId, dataUrl: c.toDataURL("image/png") }, "*");
            return;
          } catch (e) {}
        }
        window.postMessage({ type: msgId, dataUrl: null }, "*");
      });
  } + '(' + JSON.stringify(imgEl.currentSrc || imgEl.src) + ',' + JSON.stringify(id) + '));';
  document.documentElement.appendChild(script);
  script.remove();

  // Timeout fallback
  setTimeout(function () {
    window.removeEventListener("message", onMessage);
  }, 5000);
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

  // Bottom action bar — always visible
  var actionBar = document.createElement("div");
  actionBar.className = "mh-action-bar";

  var downloadBtn = document.createElement("button");
  downloadBtn.className = "mh-download-btn";
  downloadBtn.textContent = "Download";
  downloadBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    // Fetch and save to trigger real download
    fetch(resultUrl)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "magichour-transform.png";
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
  actionBar.appendChild(toggleBtn);
  actionBar.appendChild(closeBtn);
  overlay.appendChild(resultImg);
  overlay.appendChild(actionBar);
  wrapper.appendChild(overlay);

  mhOverlays.push({ wrapper: wrapper, imgEl: imgEl });
  requestAnimationFrame(function () { overlay.classList.add("mh-visible"); });
}

function mhToolbarBtn(title, cls, fn) {
  var btn = document.createElement("button");
  btn.className = "mh-toolbar-btn " + cls;
  btn.title = title;
  btn.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
  return btn;
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
  // Ensure minimum size so overlay buttons are usable
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
