/* ============================================================
 *  앱 동작 파일 (버튼·가사 재생 로직)
 * ============================================================ */
(function () {
  "use strict";

  // ---------- 설정값 ----------
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];  // 속도 단계 (배속)
  const FONT_MIN = 18, FONT_MAX = 64;
  const STORE_KEY = "smv-settings";
  const EDIT_KEY = "smv-edits";

  const $ = (id) => document.getElementById(id);

  // 휴대폰 저장소 읽기/쓰기 (개인정보 보호 모드 등에서 실패해도 앱이 멈추지 않도록)
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 무시 */ }
  }

  const settings = Object.assign(
    { theme: "light", mode: "lyric", speedIdx: 2, fontSize: 30, repeat: false },
    load(STORE_KEY, {})
  );
  let edits = load(EDIT_KEY, {});   // { 구절번호: {topic, ref, text} }

  const state = {
    index: 0,        // 지금 보고 있는 구절 번호
    lineIdx: -1,     // 가사 모드에서 지금 줄
    playing: false,
    timer: null,
    hideTimer: null,
  };

  // ---------- 구절 데이터 ----------
  function getVerse(i) {
    return Object.assign({}, DEFAULT_VERSES[i], edits[i] || {});
  }
  function splitLines(text) {
    return text.split(/\s*\/\s*|\n+/).map((s) => s.trim()).filter(Boolean);
  }

  // ---------- 테마 ----------
  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    const icon = settings.theme === "dark" ? "☀️" : "🌙";
    $("themeBtn").textContent = icon;
    $("viewThemeBtn").textContent = icon;
    document.querySelector('meta[name="theme-color"]')
      .setAttribute("content", settings.theme === "dark" ? "#12161f" : "#f6f3ec");
  }
  function toggleTheme() {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    save(STORE_KEY, settings);
    applyTheme();
  }

  // ---------- ① 목록 화면 ----------
  function renderList(filter) {
    const box = $("verseList");
    box.innerHTML = "";
    const q = (filter || "").trim();
    let lastLesson = null, count = 0;

    DEFAULT_VERSES.forEach((_, i) => {
      const v = getVerse(i);
      const hay = `${v.lesson}과 ${v.topic} ${v.ref} ${v.text}`;
      if (q && !hay.includes(q)) return;
      count++;

      if (v.lesson !== lastLesson) {
        lastLesson = v.lesson;
        const head = document.createElement("div");
        head.className = "lesson-head";
        head.innerHTML = `<span class="lesson-no">${v.lesson}과</span><span class="lesson-topic"></span>`;
        head.querySelector(".lesson-topic").textContent = v.topic;
        box.appendChild(head);
      }

      const card = document.createElement("button");
      card.className = "verse-card";
      card.innerHTML = `<div class="verse-ref"><span></span></div><div class="verse-preview"></div>`;
      card.querySelector(".verse-ref span").textContent = v.ref;
      if (edits[i]) addBadge(card, "수정함");
      else if (!v.checked) addBadge(card, "교재 확인 필요");
      card.querySelector(".verse-preview").textContent = splitLines(v.text).join(" ");
      card.addEventListener("click", () => openVerse(i));
      box.appendChild(card);
    });

    if (!count) box.innerHTML = `<p class="empty">찾는 구절이 없습니다.</p>`;
  }
  function addBadge(card, label) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = label;
    card.querySelector(".verse-ref").appendChild(b);
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
    $("tapHint").classList.remove("gone");
    setTimeout(() => $("tapHint").classList.add("gone"), 4000);
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
    const lines = splitLines(v.text);
    const box = $("lines");
    box.innerHTML = "";
    box.style.transform = "";

    lines.forEach((text) => {
      const el = document.createElement("span");
      el.className = "line";
      if (settings.mode === "hint") {
        el.appendChild(hintNodes(text));
        el.addEventListener("click", (e) => { e.stopPropagation(); el.classList.toggle("revealed"); });
      } else {
        el.textContent = text;
      }
      box.appendChild(el);
    });

    $("refLabel").textContent = v.ref;
    $("refLabel").classList.remove("show");
    $("viewTitle").textContent = `${v.lesson}과 · ${v.topic}`;

    const view = $("viewScreen");
    view.classList.remove("mode-static", "mode-lyric", "mode-hint", "finished");
    view.classList.add("mode-" + settings.mode);
    document.querySelectorAll(".segmented button").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === settings.mode));

    // 가사 모드에서만 재생 관련 버튼 표시
    const lyric = settings.mode === "lyric";
    $("speedRow").style.display = lyric ? "" : "none";
    ["playBtn", "restartBtn", "repeatBtn"].forEach((id) =>
      $(id).style.visibility = lyric ? "visible" : "hidden");

    state.lineIdx = -1;
    updatePlayBtn();
    fitText(settings.mode !== "lyric");
  }

  // 글자 크기 맞추기: fit=true 이면 구절 전체가 한 화면에 들어오도록 글자를 줄임
  function fitText(fit) {
    const view = $("viewScreen"), stage = $("stage");
    let size = settings.fontSize;
    view.style.setProperty("--verse-size", size + "px");
    if (!fit) return;
    while (size > 14 && stage.scrollHeight > stage.clientHeight) {
      size -= 1;
      view.style.setProperty("--verse-size", size + "px");
    }
  }

  // 가리기 모드: 각 어절의 첫 글자만 보이고 나머지는 가림
  function hintNodes(text) {
    const frag = document.createDocumentFragment();
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
  function lineDuration(text) {
    // 글자 수가 많을수록 오래 보여줌 → 속도 배속으로 나눔
    const base = Math.min(7, Math.max(2, 1.2 + text.length * 0.17));
    return (base / SPEEDS[settings.speedIdx]) * 1000;
  }

  function showLine(idx) {
    const els = $("lines").children;
    state.lineIdx = idx;
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

  function tick() {
    const els = $("lines").children;
    const next = state.lineIdx + 1;
    if (next < els.length) {
      showLine(next);
      state.timer = setTimeout(tick, lineDuration(els[next].textContent));
    } else {
      finishVerse();
      if (settings.repeat) {
        state.timer = setTimeout(() => {
          $("viewScreen").classList.remove("finished");
          $("refLabel").classList.remove("show");
          fitText(false);
          state.lineIdx = -1;
          tick();
        }, 4000 / SPEEDS[settings.speedIdx]);
      } else {
        state.playing = false;
        state.lineIdx = -1;
        updatePlayBtn();
        showControls(true);
      }
    }
  }

  function play() {
    if (settings.mode !== "lyric") return;
    clearTimeout(state.timer);
    state.playing = true;
    if (state.lineIdx === -1) {
      $("viewScreen").classList.remove("finished");
      $("refLabel").classList.remove("show");
      Array.from($("lines").children).forEach((el) => el.classList.remove("done", "past", "current"));
      $("lines").style.transform = "";
      fitText(false);
      state.timer = setTimeout(tick, 400);
    } else {
      const el = $("lines").children[state.lineIdx];
      state.timer = setTimeout(tick, lineDuration(el ? el.textContent : ""));
    }
    updatePlayBtn();
    scheduleHide();
  }
  function pause() {
    clearTimeout(state.timer);
    state.playing = false;
    updatePlayBtn();
  }
  function stop() {
    clearTimeout(state.timer);
    state.playing = false;
    state.lineIdx = -1;
  }
  function restart() {
    stop();
    renderVerse();
    play();
  }
  function updatePlayBtn() {
    $("playBtn").textContent = state.playing ? "❚❚" : "▶";
    $("playBtn").setAttribute("aria-label", state.playing ? "일시정지" : "재생");
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
      if (!$("editDialog").open) showControls(false);
    }, state.playing ? 3500 : 5000);
  }

  // ---------- 설정 변경 ----------
  function setMode(mode) {
    settings.mode = mode;
    save(STORE_KEY, settings);
    renderVerse();
    if (mode === "lyric") play();
  }
  function setSpeed(idx) {
    settings.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, idx));
    save(STORE_KEY, settings);
    $("speedRange").value = settings.speedIdx;
    $("speedLabel").textContent = SPEEDS[settings.speedIdx] + "x";
  }
  function setFont(size) {
    settings.fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, size));
    save(STORE_KEY, settings);
    const finished = $("viewScreen").classList.contains("finished");
    fitText(settings.mode !== "lyric" || finished);
    if (settings.mode === "lyric" && state.lineIdx >= 0) {
      setTimeout(() => centerLine($("lines").children[state.lineIdx]), 50);
    }
  }
  function toggleRepeat() {
    settings.repeat = !settings.repeat;
    save(STORE_KEY, settings);
    $("repeatBtn").classList.toggle("on", settings.repeat);
  }
  function go(delta) {
    const n = DEFAULT_VERSES.length;
    state.index = (state.index + delta + n) % n;
    renderVerse();
    if (settings.mode === "lyric") play();
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

  // ---------- ③ 편집 ----------
  function openEdit() {
    pause();
    const v = getVerse(state.index);
    $("editTopic").value = v.topic;
    $("editRef").value = v.ref;
    $("editText").value = splitLines(v.text).join("\n");
    $("editDialog").showModal();
  }
  function saveEdit() {
    const text = $("editText").value.split("\n").map((s) => s.trim()).filter(Boolean).join(" / ");
    if (!text) { alert("본문을 입력해 주세요."); return; }
    edits[state.index] = {
      topic: $("editTopic").value.trim() || DEFAULT_VERSES[state.index].topic,
      ref: $("editRef").value.trim() || DEFAULT_VERSES[state.index].ref,
      text,
    };
    save(EDIT_KEY, edits);
    $("editDialog").close();
    renderVerse();
  }
  function resetEdit() {
    if (!confirm("이 구절을 처음 상태로 되돌릴까요?")) return;
    delete edits[state.index];
    save(EDIT_KEY, edits);
    $("editDialog").close();
    renderVerse();
  }

  // ---------- 이벤트 연결 ----------
  $("themeBtn").onclick = toggleTheme;
  $("viewThemeBtn").onclick = toggleTheme;
  $("searchInput").addEventListener("input", (e) => renderList(e.target.value));
  $("closeBtn").onclick = () => closeVerse(false);
  $("editBtn").onclick = openEdit;
  $("saveVerseBtn").onclick = saveEdit;
  $("resetVerseBtn").onclick = resetEdit;
  document.querySelectorAll(".segmented button").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  $("speedRange").addEventListener("input", (e) => setSpeed(Number(e.target.value)));
  $("slowerBtn").onclick = () => setSpeed(settings.speedIdx - 1);
  $("fasterBtn").onclick = () => setSpeed(settings.speedIdx + 1);
  $("playBtn").onclick = () => (state.playing ? pause() : play());
  $("restartBtn").onclick = restart;
  $("repeatBtn").onclick = toggleRepeat;
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

  // 컴퓨터 키보드 (테스트용): ← → 이전/다음, 스페이스 재생, Esc 닫기
  document.addEventListener("keydown", (e) => {
    if ($("viewScreen").classList.contains("hidden") || $("editDialog").open) return;
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === " ") { e.preventDefault(); state.playing ? pause() : play(); }
    else if (e.key === "Escape") closeVerse(false);
  });

  window.addEventListener("resize", () => {
    if (!$("viewScreen").classList.contains("hidden")) {
      fitText(settings.mode !== "lyric" || $("viewScreen").classList.contains("finished"));
    }
    if (settings.mode === "lyric" && state.lineIdx >= 0) centerLine($("lines").children[state.lineIdx]);
  });

  // ---------- 시작 ----------
  applyTheme();
  setSpeed(settings.speedIdx);
  setFont(settings.fontSize);
  $("repeatBtn").classList.toggle("on", settings.repeat);
  renderList("");

  // 오프라인 사용을 위한 서비스 워커 등록
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
