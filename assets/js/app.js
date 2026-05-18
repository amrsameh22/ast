/* ==========================================================================
   AST AI — Workspace logic
   All six tools talk to the official Google Gemini API directly from the
   browser. The user's API key lives only in localStorage on their device.
   ========================================================================== */

"use strict";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const DEFAULTS = {
  apiKey: "",
  chatModel: "gemini-2.5-flash",
  imageModel: "gemini-2.5-flash-image",
  videoModel: "veo-3.0-generate-001",
};

const STORAGE_KEY = "ast-ai-settings";

/* ----- Settings -------------------------------------------------------- */

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

let settings = loadSettings();

/* ----- Small DOM helpers ---------------------------------------------- */

const $ = (sel) => document.querySelector(sel);

function requireKey() {
  if (!settings.apiKey) {
    openSettings();
    throw new Error("من فضلك أضف مفتاح Gemini API من الإعدادات أولاً.");
  }
}

function setBusy(btn, busy, idleLabel) {
  if (busy) {
    btn.dataset.idle = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> جارٍ المعالجة...';
  } else {
    btn.disabled = false;
    btn.textContent = idleLabel || btn.dataset.idle || "تم";
  }
}

function showError(box, err) {
  const msg = err && err.message ? err.message : String(err);
  box.className = "result-box";
  box.textContent = "حصل خطأ: " + msg;
}

/* ----- Gemini API calls ----------------------------------------------- */

async function generateContent(model, body) {
  requireKey();
  const url = `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);
  }
  return data;
}

function extractText(data) {
  const parts =
    (data.candidates && data.candidates[0] &&
     data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts.filter((p) => p.text).map((p) => p.text).join("\n").trim();
}

function extractImage(data) {
  const parts =
    (data.candidates && data.candidates[0] &&
     data.candidates[0].content && data.candidates[0].content.parts) || [];
  for (const p of parts) {
    if (p.inlineData && p.inlineData.data) return p.inlineData;
  }
  return null;
}

// Ask the chat model for a single text answer (used by several tools).
async function askText(prompt) {
  const data = await generateContent(settings.chatModel, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const text = extractText(data);
  if (!text) throw new Error("لم يرجع النموذج أي نص.");
  return text;
}

/* ----- Tool switching -------------------------------------------------- */

$("#sidebar").addEventListener("click", (e) => {
  const btn = e.target.closest(".tool-btn");
  if (!btn) return;
  const tool = btn.dataset.tool;
  document.querySelectorAll(".tool-btn").forEach((b) =>
    b.classList.toggle("active", b === btn));
  document.querySelectorAll(".panel").forEach((p) =>
    p.classList.toggle("active", p.dataset.panel === tool));
});

/* ----- Settings modal -------------------------------------------------- */

function openSettings() {
  $("#apiKeyInput").value = settings.apiKey;
  $("#chatModelInput").value = settings.chatModel;
  $("#imageModelInput").value = settings.imageModel;
  $("#videoModelInput").value = settings.videoModel;
  $("#settingsModal").classList.add("open");
}

function closeSettings() {
  $("#settingsModal").classList.remove("open");
}

$("#settingsBtn").addEventListener("click", openSettings);
$("#bannerSettingsBtn").addEventListener("click", openSettings);
$("#closeSettings").addEventListener("click", closeSettings);
$("#settingsModal").addEventListener("click", (e) => {
  if (e.target.id === "settingsModal") closeSettings();
});

$("#saveSettings").addEventListener("click", () => {
  settings = {
    apiKey: $("#apiKeyInput").value.trim(),
    chatModel: $("#chatModelInput").value.trim() || DEFAULTS.chatModel,
    imageModel: $("#imageModelInput").value.trim() || DEFAULTS.imageModel,
    videoModel: $("#videoModelInput").value.trim() || DEFAULTS.videoModel,
  };
  saveSettings(settings);
  closeSettings();
  refreshBanner();
});

function refreshBanner() {
  $("#apiBanner").classList.toggle("hidden", Boolean(settings.apiKey));
}

/* ======================================================================
   CHAT
   ====================================================================== */

const chatHistory = [];
const chatLog = $("#chatLog");

function addMessage(role, text) {
  const empty = chatLog.querySelector(".empty-state");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

async function sendChat() {
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  const btn = $("#chatSend");

  addMessage("user", text);
  input.value = "";
  input.style.height = "auto";
  chatHistory.push({ role: "user", parts: [{ text }] });

  const pending = addMessage("bot", "جارٍ التفكير...");
  setBusy(btn, true);
  try {
    const data = await generateContent(settings.chatModel, { contents: chatHistory });
    const reply = extractText(data) || "لم يصل رد.";
    pending.textContent = reply;
    chatHistory.push({ role: "model", parts: [{ text: reply }] });
  } catch (err) {
    pending.className = "msg error";
    pending.textContent = "خطأ: " + err.message;
    chatHistory.pop();
  } finally {
    setBusy(btn, false, "إرسال");
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

$("#chatSend").addEventListener("click", sendChat);
$("#chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
$("#chatInput").addEventListener("input", (e) => {
  e.target.style.height = "auto";
  e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
});

/* ======================================================================
   IMAGE GENERATION
   ====================================================================== */

$("#imageGen").addEventListener("click", async () => {
  const prompt = $("#imagePrompt").value.trim();
  const box = $("#imageResult");
  if (!prompt) {
    box.className = "result-box";
    box.textContent = "اكتب وصف الصورة الأول.";
    return;
  }
  const btn = $("#imageGen");
  setBusy(btn, true);
  box.className = "result-box";
  box.textContent = "جارٍ توليد الصورة...";
  try {
    const data = await generateContent(settings.imageModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    });
    const img = extractImage(data);
    if (!img) throw new Error("لم يرجع النموذج صورة. جرّب وصفًا مختلفًا أو موديل صور آخر.");
    box.textContent = "";
    const caption = extractText(data);
    if (caption) {
      const p = document.createElement("p");
      p.textContent = caption;
      box.appendChild(p);
    }
    const el = document.createElement("img");
    el.src = `data:${img.mimeType || "image/png"};base64,${img.data}`;
    el.alt = prompt;
    box.appendChild(el);
  } catch (err) {
    showError(box, err);
  } finally {
    setBusy(btn, false, "توليد الصورة");
  }
});

/* ======================================================================
   VIDEO — image to video (Veo, long-running operation)
   ====================================================================== */

let videoImageData = null; // { base64, mimeType }

$("#videoImage").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result);
    videoImageData = {
      base64: result.split(",")[1],
      mimeType: file.type || "image/png",
    };
    const preview = $("#videoPreview");
    preview.src = result;
    preview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

// Walk an arbitrary object looking for a generated video reference.
function findVideo(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.video) {
    if (obj.video.uri) return { uri: obj.video.uri };
    if (obj.video.bytesBase64Encoded)
      return { base64: obj.video.bytesBase64Encoded, mimeType: obj.video.mimeType };
  }
  if (obj.uri && /video|\.mp4/i.test(obj.uri)) return { uri: obj.uri };
  if (obj.bytesBase64Encoded && /video/i.test(obj.mimeType || ""))
    return { base64: obj.bytesBase64Encoded, mimeType: obj.mimeType };
  for (const key of Object.keys(obj)) {
    const found = findVideo(obj[key]);
    if (found) return found;
  }
  return null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollOperation(name, statusFn) {
  const url = `${API_BASE}/${name}?key=${encodeURIComponent(settings.apiKey)}`;
  for (let i = 0; i < 60; i++) {
    await wait(10000);
    statusFn(`جارٍ التوليد... (${(i + 1) * 10} ثانية)`);
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);
    }
    if (data.done) {
      if (data.error) throw new Error(data.error.message || "فشل التوليد.");
      return data;
    }
  }
  throw new Error("انتهت مهلة الانتظار. جرّب تاني أو قلّل المدة.");
}

$("#videoGen").addEventListener("click", async () => {
  const box = $("#videoResult");
  const prompt = $("#videoPrompt").value.trim();
  if (!videoImageData) {
    box.className = "result-box";
    box.textContent = "ارفع صورة الأول.";
    return;
  }
  if (!prompt) {
    box.className = "result-box";
    box.textContent = "اكتب وصف الحركة الأول.";
    return;
  }
  const btn = $("#videoGen");
  setBusy(btn, true);
  box.className = "result-box";
  box.textContent = "جارٍ إرسال الطلب...";

  const setStatus = (t) => { box.textContent = t; };

  try {
    const startUrl =
      `${API_BASE}/models/${settings.videoModel}:predictLongRunning` +
      `?key=${encodeURIComponent(settings.apiKey)}`;
    const res = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{
          prompt,
          image: {
            bytesBase64Encoded: videoImageData.base64,
            mimeType: videoImageData.mimeType,
          },
        }],
        parameters: {
          aspectRatio: $("#videoAspect").value,
          durationSeconds: Number($("#videoDuration").value),
          sampleCount: 1,
        },
      }),
    });
    const startData = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((startData.error && startData.error.message) || `HTTP ${res.status}`);
    }
    if (!startData.name) throw new Error("لم يرجع الخادم معرّف العملية.");

    const finalData = await pollOperation(startData.name, setStatus);
    const video = findVideo(finalData.response || finalData);
    if (!video) throw new Error("لم يتم العثور على فيديو في الرد.");

    setStatus("جارٍ تحميل الفيديو...");
    let src;
    if (video.base64) {
      src = `data:${video.mimeType || "video/mp4"};base64,${video.base64}`;
    } else {
      const sep = video.uri.includes("?") ? "&" : "?";
      const dlUrl = `${video.uri}${sep}key=${encodeURIComponent(settings.apiKey)}`;
      const blob = await (await fetch(dlUrl)).blob();
      src = URL.createObjectURL(blob);
    }

    box.textContent = "";
    const el = document.createElement("video");
    el.src = src;
    el.controls = true;
    el.autoplay = true;
    el.loop = true;
    el.style.width = "100%";
    el.style.borderRadius = "12px";
    box.appendChild(el);
  } catch (err) {
    showError(box, err);
  } finally {
    setBusy(btn, false, "توليد الفيديو");
  }
});

/* ======================================================================
   SUMMARIZE
   ====================================================================== */

$("#sumGen").addEventListener("click", async () => {
  const text = $("#sumInput").value.trim();
  const box = $("#sumResult");
  if (!text) {
    box.className = "result-box";
    box.textContent = "الصق النص الأول.";
    return;
  }
  const styleMap = {
    bullets: "في صورة نقاط مختصرة وواضحة",
    paragraph: "في فقرة واحدة موجزة",
    detailed: "في ملخّص تفصيلي منظّم مع العناوين الفرعية",
  };
  const btn = $("#sumGen");
  setBusy(btn, true);
  box.className = "result-box";
  box.textContent = "جارٍ التلخيص...";
  try {
    const out = await askText(
      `لخّص النص التالي باللغة العربية ${styleMap[$("#sumStyle").value]}. ` +
      `اعرض أهم الأفكار فقط:\n\n${text}`
    );
    box.textContent = out;
  } catch (err) {
    showError(box, err);
  } finally {
    setBusy(btn, false, "لخّص");
  }
});

/* ======================================================================
   TRANSLATE
   ====================================================================== */

$("#trGen").addEventListener("click", async () => {
  const text = $("#trInput").value.trim();
  const box = $("#trResult");
  if (!text) {
    box.className = "result-box";
    box.textContent = "اكتب النص الأول.";
    return;
  }
  const btn = $("#trGen");
  setBusy(btn, true);
  box.className = "result-box";
  box.textContent = "جارٍ الترجمة...";
  try {
    const out = await askText(
      `ترجم النص التالي إلى ${$("#trTarget").value} ترجمة دقيقة وطبيعية ` +
      `تحافظ على المعنى والسياق. اكتب الترجمة فقط بدون شرح:\n\n${text}`
    );
    box.textContent = out;
  } catch (err) {
    showError(box, err);
  } finally {
    setBusy(btn, false, "ترجم");
  }
});

/* ======================================================================
   PROMPT GENERATOR
   ====================================================================== */

$("#prGen").addEventListener("click", async () => {
  const idea = $("#prInput").value.trim();
  const box = $("#prResult");
  if (!idea) {
    box.className = "result-box";
    box.textContent = "اوصف فكرتك الأول.";
    return;
  }
  const typeMap = {
    image: "توليد صورة بالذكاء الاصطناعي (وصف بصري غني بالتفاصيل: الموضوع، الإضاءة، الزاوية، الألوان، الأسلوب الفني، الجودة)",
    video: "توليد فيديو بالذكاء الاصطناعي (وصف للمشهد والحركة وحركة الكاميرا والإضاءة والمدة والأسلوب)",
    chat: "توجيه نموذج محادثة (تحديد الدور والمهمة والسياق وصيغة الإخراج المطلوبة بوضوح)",
  };
  const lang = $("#prLang").value;
  const btn = $("#prGen");
  setBusy(btn, true);
  box.className = "result-box";
  box.textContent = "جارٍ توليد البرومت...";
  try {
    const out = await askText(
      `أنت خبير في هندسة البرومت. المستخدم كتب فكرته بالعربي بشكل عادي:\n\n` +
      `"${idea}"\n\n` +
      `حوّل الفكرة دي إلى برومت احترافي مكتوب بلغة ${lang} مخصّص لـ ${typeMap[$("#prType").value]}. ` +
      `اجعله مفصّلاً ومنظّماً وجاهزاً للنسخ المباشر. ` +
      `اكتب البرومت فقط بدون أي مقدمات أو شرح إضافي.`
    );
    box.textContent = out;
  } catch (err) {
    showError(box, err);
  } finally {
    setBusy(btn, false, "طلّع البرومت");
  }
});

/* ----- Init ------------------------------------------------------------ */

refreshBanner();
