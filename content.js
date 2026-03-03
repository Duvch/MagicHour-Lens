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
