/* ============================================================
 *  앱 동작 파일 (버튼·가사 재생 로직)
 * ============================================================ */
(function () {
  "use strict";

  // ---------- 설정값 ----------
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];  // 속도 단계 (배속)
  const SPEED_NAMES = ["아주 느리게", "느리게", "보통", "조금 빠르게", "빠르게", "더 빠르게", "아주 빠르게"];
  const FONT_MIN = 18, FONT_MAX = 64;
  const FIT_MIN = 24;                 // 정지 모드에서 자동으로 줄일 때의 최소 글자 크기
  const STORE_KEY = "smv-settings";
  const EDIT_KEY = "smv-edits-v2";    // 32구절 버전부터 구절 번호(no) 기준으로 저장
  const MEM_KEY = "smv-memorized";

  const $ = (id) => document.getElementById(id);

  // 휴대폰 저장소 읽기/쓰기 (개인정보 보호 모드 등에서 실패해도 앱이 멈추지 않도록)
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 무시 */ }
  }

  const settings = Object.assign(
    { mode: "lyric", speedIdx: 2, fontSize: 30, repeat: "off", voice: false },
    load(STORE_KEY, {})
  );
  if (typeof settings.repeat === "boolean") settings.repeat = settings.repeat ? "one" : "off";
  let edits = load(EDIT_KEY, {});            // { 구절번호: {ref, text} }
  let memorized = load(MEM_KEY, []);         // 외운 구절 번호 목록

  const state = {
    index: 0,        // 지금 보고 있는 구절 (배열 순서)
    lineIdx: -1,     // 가사 모드에서 지금 줄
    playing: false,
    timer: null,
    hideTimer: null,
    token: 0,        // 재생 예약이 겹치지 않게 하는 번호표
  };

  // ---------- 구절 데이터 ----------
  function getVerse(i) {
    const v = DEFAULT_VERSES[i];
    return Object.assign({}, v, edits[v.no] || {});
  }
  function splitLines(text) {
    return text.split(/\s*\/\s*|\n+/).map((s) => s.trim()).filter(Boolean);
  }
  function plain(text) {
    return splitLines(text).join(" ").replace(/\[\d+\]\s*/g, "");
  }
  // [6] 같은 절 번호 표시를 작은 숫자로 바꿔서 그림
  function verseNodes(text) {
    const frag = document.createDocumentFragment();
    text.split(/(\[\d+\]\s*)/).forEach((part) => {
      const m = part.match(/^\[(\d+)\]/);
      if (m) {
        const sup = document.createElement("sup");
        sup.className = "vno";
        sup.textContent = m[1];
        frag.appendChild(sup);
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    });
    return frag;
  }
  const isMem = (no) => memorized.includes(no);

  // ---------- ① 목록 화면 ----------
  function renderProgress() {
    $("progressCount").textContent = memorized.length;
    $("progressTotal").textContent = DEFAULT_VERSES.length;
    $("progressFill").style.width = (memorized.length / DEFAULT_VERSES.length * 100) + "%";
  }

  function renderJumpNav() {
    const nav = $("jumpNav");
    const seen = [];
    DEFAULT_VERSES.forEach((v) => { if (!seen.includes(v.section)) seen.push(v.section); });
    seen.forEach((sec, i) => {
      const b = document.createElement("button");
      b.textContent = sec.split(".")[0];            // Ⅰ, Ⅱ, Ⅲ, Ⅳ
      b.title = sec;
      b.onclick = () => {
        $("searchInput").value = "";
        renderList("");
        const el = document.getElementById("sec-" + i);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      nav.appendChild(b);
    });
  }

  function renderList(filter) {
    const box = $("verseList");
    box.innerHTML = "";
    const q = (filter || "").trim();
    let lastSection = null, lastLesson = null, count = 0;

    DEFAULT_VERSES.forEach((_, i) => {
      const v = getVerse(i);
      if (q) {
        const match = /^\d+$/.test(q)
          ? v.no === Number(q)                                   // 숫자만 입력 → 암송 번호
          : `${v.section} ${v.lesson} ${v.ref} ${plain(v.text)}`.includes(q);
        if (!match) return;
      }
      count++;

      if (v.section !== lastSection) {
        lastSection = v.section;
        lastLesson = null;
        const h = document.createElement("h2");
        h.className = "section-head";
        h.id = "sec-" + uniqueSections().indexOf(v.section);
        h.textContent = v.section;
        box.appendChild(h);
      }
      if (v.lesson && v.lesson !== lastLesson) {
        lastLesson = v.lesson;
        const h = document.createElement("div");
        h.className = "lesson-head";
        h.textContent = v.lesson;
        box.appendChild(h);
      }

      const card = document.createElement("button");
      card.className = "verse-card" + (isMem(v.no) ? " memorized" : "");
      card.innerHTML =
        `<span class="no"></span><span class="body"><span class="verse-ref"></span>` +
        `<span class="verse-preview"></span></span><span class="mem-mark" aria-hidden="true"></span>`;
      card.querySelector(".no").textContent = v.no;
      card.querySelector(".verse-ref").textContent = v.ref + (edits[v.no] ? "  (수정함)" : "");
      card.querySelector(".verse-preview").textContent = plain(v.text);
      card.querySelector(".mem-mark").textContent = isMem(v.no) ? "★" : "";
      card.setAttribute("aria-label", `${v.no}번 ${v.ref}${isMem(v.no) ? ", 외움" : ""}`);
      card.addEventListener("click", () => openVerse(i));
      box.appendChild(card);
    });

    if (!count) box.innerHTML = `<p class="empty">찾는 구절이 없습니다.</p>`;
    renderProgress();
  }
  function uniqueSections() {
    return DEFAULT_VERSES.map((v) => v.section).filter((s, i, a) => a.indexOf(s) === i);
  }

  // ---------- ② 말씀 표시 화면 ----------
  function openVerse(i) {
    state.index = i;
    $("listScreen").classList.add("hidden");
    $("viewScreen").classList.remove("hidden");
    history.pushState({ view: true }, "");
    requestWakeLock();
    renderVerse();
    showControls(true);
    if (settings.mode === "lyric") play();
    flashTapHint();
  }

  function closeVerse(fromHistory) {
    stop();
    $("viewScreen").classList.add("hidden");
    $("listScreen").classList.remove("hidden");
    releaseWakeLock();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (!fromHistory && history.state && history.state.view) history.back();
    renderList($("searchInput").value);
  }

  function renderVerse() {
    stop();
    const v = getVerse(state.index);
    const lyric = settings.mode === "lyric";
    const box = $("lines");
    box.innerHTML = "";
    box.style.transform = "";

    // 가사 모드: 암송 습관대로 "성경 위치 → 본문 → 성경 위치" 순서로 보여줌
    if (lyric) {
      const r = document.createElement("span");
      r.className = "line ref-line";
      r.textContent = v.ref;
      box.appendChild(r);
    }
    splitLines(v.text).forEach((text) => {
      const el = document.createElement("span");
      el.className = "line";
      el.dataset.say = text.replace(/\[\d+\]\s*/g, "");
      if (settings.mode === "hint") {
        el.appendChild(hintNodes(text));
        el.addEventListener("click", (e) => { e.stopPropagation(); el.classList.toggle("revealed"); });
      } else {
        el.appendChild(verseNodes(text));
      }
      box.appendChild(el);
    });

    $("refLabel").textContent = v.ref;
    $("refLabel").classList.remove("show");
    $("viewTitle").textContent = `${v.no}. ${v.lesson || v.section.replace(/^[^.]+\.\s*/, "")}`;
    updateMemBtn();

    const view = $("viewScreen");
    view.classList.remove("mode-static", "mode-lyric", "mode-hint", "finished");
    view.classList.add("mode-" + settings.mode);
    document.querySelectorAll("#bottomBar .segmented button").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === settings.mode));

    state.lineIdx = -1;
    updatePlayBtn();
    fitText(!lyric);
  }

  // 글자 크기 맞추기: fit=true 이면 구절 전체가 한 화면에 들어오도록 글자를 줄임
  // (단, 너무 작아지지 않게 FIT_MIN 까지만 줄이고 나머지는 위아래로 밀어서 보기)
  function fitText(fit) {
    const view = $("viewScreen"), stage = $("stage");
    let size = settings.fontSize;
    view.style.setProperty("--verse-size", size + "px");
    if (!fit) return;
    const floor = Math.min(settings.fontSize, FIT_MIN);
    while (size > floor && stage.scrollHeight > stage.clientHeight) {
      size -= 1;
      view.style.setProperty("--verse-size", size + "px");
    }
  }

  // 외워보기 모드: 각 어절의 첫 글자만 보이고 나머지는 가림
  function hintNodes(text) {
    const frag = document.createDocumentFragment();
    const m = text.match(/^\[(\d+)\]\s*/);
    if (m) {
      frag.appendChild(verseNodes(m[0]));
      text = text.slice(m[0].length);
    }
    text.split(" ").forEach((word, wi) => {
      if (wi) frag.appendChild(document.createTextNode(" "));
      const chars = Array.from(word);
      frag.appendChild(document.createTextNode(chars[0] || ""));
      if (chars.length > 1) {
        const hid = document.createElement("span");
        hid.className = "hint-hidden";
        hid.textContent = chars.slice(1).join("");
        frag.appendChild(hid);
      }
    });
    return frag;
  }

  // ---------- 가사 모드 재생 ----------
  const speed = () => SPEEDS[settings.speedIdx];

  function lineDuration(text) {
    // 글자 수가 많을수록 오래 보여줌 → 속도 배속으로 나눔
    const base = Math.min(7, Math.max(2, 1.2 + text.length * 0.17));
    return (base / speed()) * 1000;
  }

  function showLine(idx) {
    const els = $("lines").children;
    state.lineIdx = idx;
    $("viewScreen").classList.remove("finished");
    $("refLabel").classList.remove("show");
    Array.from(els).forEach((el, i) => {
      el.classList.toggle("past", i < idx);
      el.classList.toggle("current", i === idx);
      el.classList.remove("done");
    });
    centerLine(els[idx]);
  }

  // 현재 줄이 화면 한가운데 오도록 전체 글을 위로 이동
  function centerLine(el) {
    if (!el) return;
    const box = $("lines");
    const stage = $("stage").getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const current = new DOMMatrixReadOnly(getComputedStyle(box).transform).m42 || 0;
    const target = current + (stage.top + stage.height / 2) - (r.top + r.height / 2);
    box.style.transform = `translateY(${target}px)`;
  }

  // 한 줄을 보여준 뒤 다음 줄을 예약 (소리로 듣기가 켜져 있으면 다 읽은 뒤 넘어감)
  function scheduleNext(el) {
    const my = ++state.token;
    const go = () => { if (my === state.token && state.playing) advance(); };
    const text = el ? (el.dataset.say || el.textContent) : "";
    if (settings.voice && speak(text, () => setTimeout(go, 350 / speed()))) {
      state.timer = setTimeout(go, lineDuration(text) * 3);   // 읽기가 끝나지 않을 때 대비
    } else {
      state.timer = setTimeout(go, lineDuration(text));
    }
  }

  function advance() {
    const els = $("lines").children;
    const next = state.lineIdx + 1;
    if (next < els.length) {
      showLine(next);
      scheduleNext(els[next]);
    } else {
      finishVerse();
      afterFinish();
    }
  }

  function finishVerse() {
    // 마지막 줄까지 끝나면 구절 전체 + 성경 위치를 보여줌
    Array.from($("lines").children).forEach((el) => {
      el.classList.remove("past", "current");
      el.classList.add("done");
    });
    $("lines").style.transform = "";
    $("viewScreen").classList.add("finished");
    $("refLabel").classList.add("show");
    fitText(true);
  }

  function afterFinish() {
    const my = ++state.token;
    const wait = (ms, fn) => { state.timer = setTimeout(() => { if (my === state.token) fn(); }, ms); };
    if (settings.voice) speak(getVerse(state.index).ref);
    if (settings.repeat === "one") {
      wait(4000 / speed(), () => { state.lineIdx = -1; resetLyric(); advance(); });
    } else if (settings.repeat === "next") {
      wait(4000 / speed(), () => go(1));
    } else {
      state.playing = false;
      state.lineIdx = -1;
      updatePlayBtn();
      showControls(true);
    }
  }

  function resetLyric() {
    $("viewScreen").classList.remove("finished");
    $("refLabel").classList.remove("show");
    Array.from($("lines").children).forEach((el) => el.classList.remove("done", "past", "current"));
    $("lines").style.transform = "";
    fitText(false);
  }

  function play() {
    if (settings.mode !== "lyric") return;
    clearTimeout(state.timer);
    state.playing = true;
    if (state.lineIdx === -1) {
      resetLyric();
      const my = ++state.token;
      state.timer = setTimeout(() => { if (my === state.token) advance(); }, 500);
    } else {
      scheduleNext($("lines").children[state.lineIdx]);
    }
    updatePlayBtn();
    scheduleHide();
  }
  function pause() {
    clearTimeout(state.timer);
    state.token++;
    state.playing = false;
    stopSpeech();
    updatePlayBtn();
  }
  function stop() {
    pause();
    state.lineIdx = -1;
  }
  function updatePlayBtn() {
    $("playBtn").textContent = state.playing ? "❚❚" : "▶";
    $("playBtn").setAttribute("aria-label", state.playing ? "일시정지" : "재생");
  }

  // 한 줄씩 직접 넘기기 (양육자가 함께 읽을 때)
  function stepLine(delta) {
    if (settings.mode !== "lyric") return;
    pause();
    const els = $("lines").children;
    const finished = $("viewScreen").classList.contains("finished");
    let idx = finished ? (delta < 0 ? els.length - 1 : els.length) : state.lineIdx + delta;
    if (idx < 0) idx = 0;
    if (idx >= els.length) { finishVerse(); state.lineIdx = -1; return; }
    showLine(idx);
    if (settings.voice) speak(els[idx].dataset.say || els[idx].textContent);
  }

  // ---------- 소리로 듣기 (휴대폰 내장 음성) ----------
  function speak(text, onEnd) {
    if (!("speechSynthesis" in window) || !text) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = Math.min(1.6, Math.max(0.6, 0.55 + 0.45 * speed()));
    const ko = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith("ko"));
    if (ko) u.voice = ko;
    if (onEnd) u.onend = onEnd;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return true;
  }
  function stopSpeech() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  // ---------- 조작 버튼 보이기/숨기기 ----------
  function showControls(show) {
    const view = $("viewScreen");
    view.classList.toggle("controls-hidden", !show);
    view.classList.toggle("controls-visible", show);
    if (show) scheduleHide();
  }
  function scheduleHide() {
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
      if (!$("editDialog").open && !$("settingsDialog").open) showControls(false);
    }, state.playing ? 3500 : 6000);
  }
  function flashTapHint() {
    const hint = $("tapHint");
    hint.textContent = settings.mode === "hint"
      ? "가려진 줄을 누르면 정답이 보입니다"
      : "화면을 누르면 조작 버튼이 나타납니다";
    hint.classList.remove("gone");
    clearTimeout(flashTapHint.t);
    flashTapHint.t = setTimeout(() => hint.classList.add("gone"), 4000);
  }

  // ---------- 설정 변경 ----------
  function setMode(mode) {
    settings.mode = mode;
    save(STORE_KEY, settings);
    renderVerse();
    if (mode === "lyric") play();
    flashTapHint();
  }
  function setSpeed(idx) {
    settings.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, idx));
    save(STORE_KEY, settings);
    $("speedRange").value = settings.speedIdx;
    $("speedLabel").textContent = `${SPEED_NAMES[settings.speedIdx]} (${SPEEDS[settings.speedIdx]}배)`;
  }
  function changeSpeed(idx) {
    setSpeed(idx);
    toast("속도: " + $("speedLabel").textContent);
  }
  // 화면 가운데 위쪽에 잠깐 나타나는 안내
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 1500);
  }
  function setFont(size) {
    settings.fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, size));
    save(STORE_KEY, settings);
    $("fontLabel").textContent = settings.fontSize;
    const finished = $("viewScreen").classList.contains("finished");
    fitText(settings.mode !== "lyric" || finished);
    if (settings.mode === "lyric" && state.lineIdx >= 0) {
      setTimeout(() => centerLine($("lines").children[state.lineIdx]), 50);
    }
  }
  function setRepeat(mode) {
    settings.repeat = mode;
    save(STORE_KEY, settings);
    document.querySelectorAll("#repeatSeg button").forEach((b) =>
      b.classList.toggle("active", b.dataset.repeat === mode));
  }
  function setVoice(on) {
    settings.voice = on;
    save(STORE_KEY, settings);
    $("voiceToggle").checked = on;
    if (!on) stopSpeech();
  }
  function go(delta) {
    const n = DEFAULT_VERSES.length;
    state.index = (state.index + delta + n) % n;
    renderVerse();
    if (settings.mode === "lyric") play();
  }

  // ---------- 외웠어요 ----------
  function toggleMemorized() {
    const no = getVerse(state.index).no;
    memorized = isMem(no) ? memorized.filter((n) => n !== no) : memorized.concat(no).sort((a, b) => a - b);
    save(MEM_KEY, memorized);
    updateMemBtn();
    toast(isMem(no) ? "★ 외운 구절에 추가했습니다" : "외운 구절에서 뺐습니다");
    scheduleHide();
  }
  function updateMemBtn() {
    const on = isMem(getVerse(state.index).no);
    $("memBtn").classList.toggle("on", on);
    $("memBtn").querySelector(".ic").textContent = on ? "★" : "☆";
  }

  // ---------- 화면 꺼짐 방지 / 전체 화면 ----------
  let wakeLock = null;
  async function requestWakeLock() {
    try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { /* 지원 안 함 */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !$("viewScreen").classList.contains("hidden")) requestWakeLock();
  });
  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      document.exitFullscreen();
    }
  }

  // ---------- 편집 ----------
  function openEdit() {
    $("settingsDialog").close();
    pause();
    const v = getVerse(state.index);
    $("editRef").value = v.ref;
    $("editText").value = splitLines(v.text).join("\n");
    $("editDialog").showModal();
  }
  function saveEdit() {
    const text = $("editText").value.split("\n").map((s) => s.trim()).filter(Boolean).join(" / ");
    if (!text) { alert("본문을 입력해 주세요."); return; }
    const base = DEFAULT_VERSES[state.index];
    edits[base.no] = { ref: $("editRef").value.trim() || base.ref, text };
    save(EDIT_KEY, edits);
    $("editDialog").close();
    renderVerse();
  }
  function resetEdit() {
    if (!confirm("이 구절을 처음 상태로 되돌릴까요?")) return;
    delete edits[DEFAULT_VERSES[state.index].no];
    save(EDIT_KEY, edits);
    $("editDialog").close();
    renderVerse();
  }

  // ---------- 이벤트 연결 ----------
  $("searchInput").addEventListener("input", (e) => renderList(e.target.value));
  $("closeBtn").onclick = () => closeVerse(false);
  $("memBtn").onclick = toggleMemorized;
  $("settingsBtn").onclick = () => { pause(); $("settingsDialog").showModal(); };
  $("editBtn").onclick = openEdit;
  $("saveVerseBtn").onclick = saveEdit;
  $("resetVerseBtn").onclick = resetEdit;
  document.querySelectorAll("#bottomBar .segmented button").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  document.querySelectorAll("#repeatSeg button").forEach((b) => b.onclick = () => setRepeat(b.dataset.repeat));
  $("voiceToggle").addEventListener("change", (e) => setVoice(e.target.checked));
  $("speedRange").addEventListener("input", (e) => changeSpeed(Number(e.target.value)));
  $("slowerBtn").onclick = () => changeSpeed(settings.speedIdx - 1);
  $("fasterBtn").onclick = () => changeSpeed(settings.speedIdx + 1);
  $("playBtn").onclick = () => (state.playing ? pause() : play());
  $("prevLineBtn").onclick = () => stepLine(-1);
  $("nextLineBtn").onclick = () => stepLine(1);
  $("revealBtn").onclick = () => {
    const els = Array.from($("lines").children);
    const all = els.every((el) => el.classList.contains("revealed"));
    els.forEach((el) => el.classList.toggle("revealed", !all));
  };
  $("prevBtn").onclick = () => go(-1);
  $("nextBtn").onclick = () => go(1);
  $("fontUpBtn").onclick = () => setFont(settings.fontSize + 4);
  $("fontDownBtn").onclick = () => setFont(settings.fontSize - 4);
  $("fullBtn").onclick = toggleFullscreen;

  // 조작줄 안을 누르면 숨김 타이머만 다시 시작
  document.querySelectorAll(".bar").forEach((bar) =>
    bar.addEventListener("click", (e) => { e.stopPropagation(); scheduleHide(); }));

  // 말씀 화면 터치 → 조작 버튼 보이기/숨기기, 좌우로 밀기 → 이전/다음 구절
  let touchX = null, touchY = null, swiped = false;
  const view = $("viewScreen");
  view.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; swiped = false;
  }, { passive: true });
  view.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; go(dx < 0 ? 1 : -1); }
    touchX = null;
  });
  view.addEventListener("click", () => {
    if (swiped) { swiped = false; return; }
    showControls(view.classList.contains("controls-hidden"));
  });

  // 안드로이드 "뒤로" 버튼 → 목록으로
  window.addEventListener("popstate", () => {
    if (!$("viewScreen").classList.contains("hidden")) closeVerse(true);
  });

  // 컴퓨터 키보드 (테스트용): ← → 이전/다음 구절, ↑ ↓ 줄 이동, 스페이스 재생, Esc 닫기
  document.addEventListener("keydown", (e) => {
    if ($("viewScreen").classList.contains("hidden") || $("editDialog").open || $("settingsDialog").open) return;
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowDown") stepLine(1);
    else if (e.key === "ArrowUp") stepLine(-1);
    else if (e.key === " ") { e.preventDefault(); state.playing ? pause() : play(); }
    else if (e.key === "Escape") closeVerse(false);
  });

  window.addEventListener("resize", () => {
    if ($("viewScreen").classList.contains("hidden")) return;
    fitText(settings.mode !== "lyric" || $("viewScreen").classList.contains("finished"));
    if (settings.mode === "lyric" && state.lineIdx >= 0) centerLine($("lines").children[state.lineIdx]);
  });

  // ---------- 시작 ----------
  setSpeed(settings.speedIdx);
  setFont(settings.fontSize);
  setRepeat(settings.repeat);
  setVoice(settings.voice);
  renderJumpNav();
  renderList("");

  // 오프라인 사용을 위한 서비스 워커 등록
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
