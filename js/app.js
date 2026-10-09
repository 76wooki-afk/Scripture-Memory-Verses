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
  const BLANK_KEY = "smv-blanks";     // 직접 고른 빈칸 단어 { 구절번호: ["단어", ...] }
  const LOOP_NAMES = { 0: "무한", 1: "1회", 2: "2회", 3: "3회", 5: "5회", 10: "10회" };

  const $ = (id) => document.getElementById(id);

  // 휴대폰 저장소 읽기/쓰기 (개인정보 보호 모드 등에서 실패해도 앱이 멈추지 않도록)
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 무시 */ }
  }

  const settings = Object.assign(
    { mode: "lyric", speedIdx: 2, fontSize: 30, voice: false, loops: 1, after: "stop", hint: "key",
      gender: "female", style: "calm", voiceName: "" },
    load(STORE_KEY, {})
  );
  // 예전 설정(끝나면: 멈춤/반복/다음 구절)을 새 설정(반복 횟수 + 끝나면)으로 옮김
  if ("repeat" in settings) {
    const r = settings.repeat;
    if (r === true || r === "one") { settings.loops = 0; settings.after = "stop"; }
    else if (r === "next") { settings.loops = 1; settings.after = "next"; }
    delete settings.repeat;
  }
  let edits = load(EDIT_KEY, {});            // { 구절번호: {ref, text} }
  let memorized = load(MEM_KEY, []);         // 외운 구절 번호 목록
  let customBlanks = load(BLANK_KEY, {});    // 직접 고른 빈칸

  const state = {
    index: 0,        // 지금 보고 있는 구절 (배열 순서)
    lineIdx: -1,     // 가사 모드에서 지금 줄
    playing: false,
    timer: null,
    hideTimer: null,
    token: 0,        // 재생 예약이 겹치지 않게 하는 번호표
    pass: 1,         // 지금 몇 번째 반복인지
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
      r.dataset.say = sayRef(v.ref);
      box.appendChild(r);
    }
    splitLines(v.text).forEach((text, li) => {
      const el = document.createElement("span");
      el.className = "line";
      el.dataset.say = text.replace(/\[\d+\]\s*/g, "");
      if (settings.mode === "hint" && settings.hint === "first") {
        el.appendChild(hintNodes(text));
        el.addEventListener("click", (e) => { e.stopPropagation(); el.classList.toggle("revealed"); });
      } else if (settings.mode === "hint") {
        el.appendChild(blankNodes(text, blankWords(v), settings.hint === "pick", li));
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
    view.classList.remove("mode-static", "mode-lyric", "mode-hint", "finished", "hint-first", "hint-key", "hint-pick");
    view.classList.add("mode-" + settings.mode, "hint-" + settings.hint);
    document.querySelectorAll("#modeSeg button").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === settings.mode));
    document.querySelectorAll("#hintSeg button").forEach((b) =>
      b.classList.toggle("active", b.dataset.hint === settings.hint));
    updateLoopBadge();

    state.lineIdx = -1;
    updatePlayBtn();
    fitText(!lyric);
  }

  // 글자 크기 맞추기
  //  fit=false (가사 모드 재생 중): 설정한 글자 크기 그대로
  //  fit=true  (정지·외워보기·가사 끝난 뒤): 화면에 꽉 차도록 글자를 키우거나 줄임
  //   - 가장 작게: FIT_MIN(24px) — 이보다 길면 위아래로 밀어서 보기
  //   - 가장 크게: 화면 짧은 쪽 길이의 14% (설정한 글자 크기가 더 크면 그 값)
  function fitText(fit) {
    const view = $("viewScreen"), stage = $("stage");
    const set = (px) => view.style.setProperty("--verse-size", px + "px");
    view.classList.toggle("landscape", innerWidth > innerHeight);   // 가로 화면 표시
    set(settings.fontSize);
    if (!fit) return;
    const floor = Math.min(settings.fontSize, FIT_MIN);
    const cap = Math.max(settings.fontSize, Math.round(Math.min(innerWidth, innerHeight) * 0.14));
    let lo = floor, hi = cap, best = floor;
    while (lo <= hi) {                       // 맞는 크기 중 가장 큰 값을 반씩 좁혀 찾기
      const mid = (lo + hi) >> 1;
      set(mid);
      if (stage.scrollHeight <= stage.clientHeight) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    set(best);
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

  // ---------- 외워보기: 핵심 단어 빈칸 ----------
  // 이 구절의 빈칸 단어 목록 (직접 고른 것이 있으면 그것, 없으면 verses.js의 기본값)
  function blankWords(v) {
    return Array.isArray(customBlanks[v.no]) ? customBlanks[v.no] : (v.blanks || []);
  }
  const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 한 줄에서 빈칸 단어가 나오는 위치 찾기 (긴 단어부터 찾음)
  function blankRanges(line, words) {
    if (!words.length) return [];
    const re = new RegExp(words.slice().sort((a, b) => b.length - a.length).map(escapeRe).join("|"), "g");
    const out = [];
    let m;
    while ((m = re.exec(line))) {
      if (!m[0]) { re.lastIndex++; continue; }
      out.push({ s: m.index, e: m.index + m[0].length, word: m[0] });
    }
    return out;
  }
  // picking=false: 빈칸으로 가려서 보여줌 (빈칸을 누르면 정답)
  // picking=true : 본문을 다 보여주고, 낱말을 누르면 빈칸으로 지정/해제
  function blankNodes(text, words, picking, lineNo) {
    const frag = document.createDocumentFragment();
    const m = text.match(/^\[(\d+)\]\s*/);
    if (m) {
      frag.appendChild(verseNodes(m[0]));
      text = text.slice(m[0].length);
    }
    const ranges = blankRanges(text, words);
    let pos = 0;
    text.split(" ").forEach((word, wi) => {
      if (wi) { frag.appendChild(document.createTextNode(" ")); pos++; }
      const ws = pos, we = pos + word.length;
      pos = we;
      const hits = ranges.filter((r) => r.s < we && r.e > ws);
      const w = document.createElement("span");
      w.className = "word";
      let i = ws;
      hits.forEach((r) => {
        const a = Math.max(r.s, ws), b = Math.min(r.e, we);
        if (a > i) w.appendChild(document.createTextNode(text.slice(i, a)));
        const bl = document.createElement("span");
        bl.className = "blank";
        bl.dataset.group = lineNo + "-" + ranges.indexOf(r);   // 두 낱말에 걸친 빈칸은 함께 열림
        bl.textContent = text.slice(a, b);
        w.appendChild(bl);
        i = b;
      });
      if (i < we) w.appendChild(document.createTextNode(text.slice(i, we)));
      if (picking) {
        w.classList.add("pickable");
        w.addEventListener("click", (e) => { e.stopPropagation(); togglePick(word, hits.map((h) => h.word)); });
      } else {
        w.querySelectorAll(".blank").forEach((bl) => bl.addEventListener("click", (e) => {
          e.stopPropagation();
          const on = !bl.classList.contains("revealed");
          document.querySelectorAll(`.blank[data-group="${bl.dataset.group}"]`)
            .forEach((x) => x.classList.toggle("revealed", on));
        }));
      }
      frag.appendChild(w);
    });
    return frag;
  }
  // 낱말 끝의 조사(은·는·을·를·의 …)와 문장부호를 떼어 핵심 단어만 남김
  const PARTICLES = ["께서", "에게", "에서", "으로", "은", "는", "을", "를", "의", "와", "과", "에", "로", "도", "이", "가", "요"];
  function stem(word) {
    let w = word.replace(/[,.?!·]+$/g, "");
    for (const p of PARTICLES) {
      if (w.endsWith(p) && w.length - p.length >= 2) { w = w.slice(0, -p.length); break; }
    }
    return w;
  }
  function togglePick(word, hitWords) {
    const v = getVerse(state.index);
    let list = blankWords(v).slice();
    if (hitWords.length) {
      list = list.filter((k) => !hitWords.includes(k));          // 이미 빈칸 → 해제
      toast("빈칸에서 뺐습니다");
    } else {
      const k = stem(word);
      if (k) { list.push(k); toast(`"${k}" 빈칸으로 지정`); }
    }
    customBlanks[v.no] = list;
    save(BLANK_KEY, customBlanks);
    renderVerse();
  }
  function setBlanks(list) {
    const v = getVerse(state.index);
    if (list === null) delete customBlanks[v.no]; else customBlanks[v.no] = list;
    save(BLANK_KEY, customBlanks);
    renderVerse();
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

  // 한 번 다 읽은 뒤: 반복 횟수가 남았으면 처음부터 다시, 다 끝나면 멈추거나 다음 구절로
  function afterFinish() {
    const my = ++state.token;
    let done = false;
    const once = (fn) => () => { if (!done && my === state.token) { done = true; fn(); } };
    const more = settings.loops === 0 || state.pass < settings.loops;
    const next = () => {
      if (more) {
        state.pass++;
        updateLoopBadge();
        toast(`🔁 ${state.pass}번째 ` + (settings.loops ? `(총 ${settings.loops}회)` : "(무한 반복)"));
        state.lineIdx = -1;
        resetLyric();
        advance();
      } else if (settings.after === "next") {
        go(1);
      } else {
        state.playing = false;
        state.lineIdx = -1;
        updatePlayBtn();
        updateLoopBadge();
        showControls(true);
      }
    };
    const pauseMs = (more || settings.after === "next") ? 2500 / speed() : 0;
    // 장절을 한 번 더 읽어 줌 (암송 순서: 장절 → 본문 → 장절)
    if (settings.voice && speak(sayRef(getVerse(state.index).ref), once(() => { state.timer = setTimeout(once2, pauseMs); }))) {
      state.timer = setTimeout(once(next), 8000);                 // 읽기가 끝나지 않을 때 대비
    } else {
      state.timer = setTimeout(once(next), pauseMs);
    }
    function once2() { if (my === state.token) next(); }
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
      state.pass = 1;
      updateLoopBadge();
      const my = ++state.token;
      // 소리가 켜져 있으면 바로 시작 (아이폰은 버튼을 누른 순간에만 소리를 낼 수 있음)
      if (settings.voice) advance();
      else state.timer = setTimeout(() => { if (my === state.token) advance(); }, 500);
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
  // 화면 위쪽 작은 반복 표시 (예: 🔁 2 / 5)
  function updateLoopBadge() {
    const b = $("loopBadge");
    const next = settings.after === "next";
    const show = settings.mode === "lyric" && (settings.loops !== 1 || next);
    b.classList.toggle("show", show);
    if (show) b.textContent = `🔁 ${state.pass} / ${settings.loops || "∞"}` + (next ? " → 다음" : "") + (settings.voice ? "  🔊" : "");
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

  // 숫자를 한자어 수사로 읽기: 2 → "이", 20 → "이십", 150 → "백오십"
  // ("2장"을 "두 장"으로 읽는 휴대폰이 있어 글자로 바꿔서 읽힘)
  function sino(n) {
    const d = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
    n = Number(n);
    if (!n) return "영";
    let out = "";
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
    if (h) out += (h > 1 ? d[h] : "") + "백";
    if (t) out += (t > 1 ? d[t] : "") + "십";
    if (o) out += d[o];
    return out;
  }
  // 성경 위치를 읽는 말로 바꾸기
  //   "갈라디아서 2:20"   → "갈라디아서 이장 이십절"
  //   "이사야 53:5-6"     → "이사야 오십삼장 오절에서 육절"
  //   "시편 1:2-3"        → "시편 일편 이절에서 삼절"   (시편만 "편")
  function sayRef(ref) {
    const m = ref.trim().match(/^(.+?)\s*(\d+):(\d+)(?:\s*[-~]\s*(?:(\d+):)?(\d+))?$/);
    if (!m) return ref;
    const [, book, ch, v1, ch2, v2] = m;
    const unit = /^시편/.test(book) ? "편" : "장";
    let out = `${book} ${sino(ch)}${unit} ${sino(v1)}절`;
    if (v2) out += "에서 " + (ch2 && ch2 !== ch ? `${sino(ch2)}${unit} ` : "") + `${sino(v2)}절`;
    return out;
  }

  // 느낌별 말하기 속도·목소리 높이 (1 = 보통)
  const VOICE_STYLES = {
    calm:   { rate: 0.88, pitch: 0.95 },   // 차분한
    bright: { rate: 1.12, pitch: 1.2 },    // 경쾌한
    holy:   { rate: 0.76, pitch: 0.82 },   // 거룩한 (느리고 낮게)
    child:  { rate: 1.0,  pitch: 1.65 },   // 어린이 (높게)
  };
  const STYLE_NAMES = { calm: "차분한", bright: "경쾌한", holy: "거룩한", child: "어린이" };
  // 휴대폰 음성 이름으로 남성/여성 짐작 (모르면 null)
  const FEMALE_RE = /female|여성|여자|yuna|sora|heami|sunhi|jimin|seohyeon|soonbok|yujin|seoyeon|nara|google|-ism-|-kob-/i;
  const MALE_RE = /\bmale|남성|남자|minsu|injoon|hyunsu|bongjin|gookmin|jinho|jian|-koc-|-kod-/i;
  function voiceGender(v) {
    if (FEMALE_RE.test(v.name)) return "female";
    if (MALE_RE.test(v.name)) return "male";
    return null;
  }
  const koVoices = () => ("speechSynthesis" in window ? speechSynthesis.getVoices() : [])
    .filter((v) => v.lang && v.lang.replace("_", "-").toLowerCase().startsWith("ko"));
  // 설정에 맞는 목소리 고르기 → { voice, real: 실제로 원하는 성별의 목소리인지 }
  function pickVoice() {
    const list = koVoices();
    if (settings.voiceName) {
      const v = list.find((x) => x.name === settings.voiceName);
      if (v) return { voice: v, real: voiceGender(v) === settings.gender };
    }
    const same = list.filter((v) => voiceGender(v) === settings.gender);
    const best = same.find((v) => v.localService) || same[0];
    if (best) return { voice: best, real: true };
    return { voice: list[0] || null, real: false };
  }
  function voiceParams() {
    const st = VOICE_STYLES[settings.style] || VOICE_STYLES.calm;
    const { voice, real } = pickVoice();
    let pitch = st.pitch;
    // 남성 목소리가 휴대폰에 없으면 여성 목소리를 낮게 바꿔서 대신함 (그 반대도 마찬가지)
    if (!real && settings.gender === "male") pitch *= 0.72;
    if (!real && settings.gender === "female" && voice && voiceGender(voice) === "male") pitch *= 1.3;
    const rate = (0.55 + 0.45 * speed()) * st.rate;
    return { voice, pitch: Math.min(2, Math.max(0.1, pitch)), rate: Math.min(2, Math.max(0.4, rate)), real };
  }

  function speak(text, onEnd) {
    if (!("speechSynthesis" in window) || !text) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    const p = voiceParams();
    u.rate = p.rate;
    u.pitch = p.pitch;
    if (p.voice) u.voice = p.voice;
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
    hint.textContent = settings.mode !== "hint" ? "화면을 누르면 조작 버튼이 나타납니다"
      : settings.hint === "first" ? "가려진 줄을 누르면 정답이 보입니다"
      : settings.hint === "key" ? "빈칸을 누르면 정답이 보입니다"
      : "빈칸으로 만들 낱말을 누르세요 (다시 누르면 해제)";
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
  function setLoops(n) {
    if (n === 0 && settings.after === "next") { toast("자동 넘어가기를 켜면 무한 반복은 쓸 수 없습니다"); return; }
    settings.loops = n;
    save(STORE_KEY, settings);
    document.querySelectorAll("#loopSeg button").forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.loops) === n));
    if (settings.after === "next") $("autoNextInfo").textContent = `각 구절을 ${LOOP_NAMES[n]} 읽고 다음 구절로 (32번 다음은 1번)`;
    updateLoopBadge();
  }
  // 다음 구절 자동 넘어가기 (켜면 "무한"은 고를 수 없음 — 넘어갈 수 없으므로)
  function setAfter(a) {
    settings.after = a;
    const auto = a === "next";
    if (auto && settings.loops === 0) setLoops(1);
    save(STORE_KEY, settings);
    $("autoNextToggle").checked = auto;
    $("loopSeg").querySelector('[data-loops="0"]').disabled = auto;
    $("autoNextInfo").textContent = auto
      ? `각 구절을 ${LOOP_NAMES[settings.loops]} 읽고 다음 구절로 (32번 다음은 1번)`
      : "위 횟수만큼 반복한 뒤 다음 구절로";
    updateLoopBadge();
  }
  function setGender(g, keepVoice) {
    settings.gender = g;
    if (!keepVoice) settings.voiceName = "";   // 성별을 바꾸면 휴대폰 음성은 자동으로 다시 고름
    save(STORE_KEY, settings);
    document.querySelectorAll("#genderSeg button").forEach((b) => b.classList.toggle("active", b.dataset.gender === g));
    fillVoiceSelect();
  }
  function setStyle(st) {
    settings.style = st;
    save(STORE_KEY, settings);
    document.querySelectorAll("#styleSeg button").forEach((b) => b.classList.toggle("active", b.dataset.style === st));
  }
  // 휴대폰에 있는 한국어 음성 목록 채우기
  function fillVoiceSelect() {
    const sel = $("voiceSelect");
    const list = koVoices();
    const label = (v) => v.name + ({ female: " · 여성", male: " · 남성" }[voiceGender(v)] || "");
    sel.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "자동 (목소리·느낌에 맞춤)";
    sel.appendChild(auto);
    list.forEach((v) => {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = label(v);
      sel.appendChild(o);
    });
    sel.value = list.some((v) => v.name === settings.voiceName) ? settings.voiceName : "";
    const p = list.length ? voiceParams() : null;
    $("voiceInfo").textContent = !list.length ? "(한국어 음성을 찾는 중…)"
      : `(이 휴대폰 한국어 음성 ${list.length}개` + (p && !p.real ? ` · ${settings.gender === "male" ? "남성" : "여성"} 음성이 없어 높낮이로 대신함` : "") + ")";
  }
  function preview() {
    if (!("speechSynthesis" in window)) { toast("이 휴대폰은 소리 읽기를 지원하지 않습니다"); return; }
    speak(`${sayRef("갈라디아서 2:20")}. 내가 그리스도와 함께 십자가에 못 박혔나니`);
    toast(`▶ ${settings.gender === "male" ? "남성" : "여성"} · ${STYLE_NAMES[settings.style]}`);
  }
  function setVoice(on) {
    settings.voice = on;
    save(STORE_KEY, settings);
    $("voiceToggle").checked = on;
    $("voiceBtn").classList.toggle("on", on);
    $("voiceBtn").querySelector(".ic").textContent = on ? "🔊" : "🔈";
    if (!on) stopSpeech();
    updateLoopBadge();
  }
  // 위쪽 "소리" 버튼: 켜면 가사 모드로 바꿔 처음부터 읽어 줌
  function toggleVoiceBtn() {
    const on = !settings.voice;
    setVoice(on);
    if (!on) { toast("🔈 소리를 껐습니다"); return; }
    if (!("speechSynthesis" in window)) { toast("이 휴대폰은 소리 읽기를 지원하지 않습니다"); setVoice(false); return; }
    toast(`🔊 소리로 읽어 드립니다 · 반복 ${LOOP_NAMES[settings.loops]}`);
    if (settings.mode !== "lyric") { setMode("lyric"); return; }
    stop();
    renderVerse();
    play();
  }
  function setHint(h) {
    settings.hint = h;
    save(STORE_KEY, settings);
    renderVerse();
    flashTapHint();
    if (h === "key" && !$("lines").querySelector(".blank")) {
      toast("빈칸 단어가 없습니다. '빈칸 고르기'에서 정해 주세요");
    }
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
  document.querySelectorAll("#modeSeg button").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  document.querySelectorAll("#hintSeg button").forEach((b) => b.onclick = () => setHint(b.dataset.hint));
  document.querySelectorAll("#loopSeg button").forEach((b) => b.onclick = () => setLoops(Number(b.dataset.loops)));
  $("autoNextToggle").addEventListener("change", (e) => {
    setAfter(e.target.checked ? "next" : "stop");
    toast(e.target.checked ? `▶ 각 구절 ${LOOP_NAMES[settings.loops]} 후 다음 구절로 넘어갑니다` : "자동 넘어가기를 껐습니다");
  });
  document.querySelectorAll("#genderSeg button").forEach((b) => b.onclick = () => setGender(b.dataset.gender));
  document.querySelectorAll("#styleSeg button").forEach((b) => b.onclick = () => setStyle(b.dataset.style));
  $("voiceSelect").addEventListener("change", (e) => {
    settings.voiceName = e.target.value;
    save(STORE_KEY, settings);
    fillVoiceSelect();
  });
  $("previewBtn").onclick = preview;
  // 음성 목록은 늦게 준비되는 휴대폰이 있음 → 준비되면 다시 채움 (오래된 기기에서도 앱이 멈추지 않게)
  if ("speechSynthesis" in window) {
    try { speechSynthesis.addEventListener("voiceschanged", fillVoiceSelect); }
    catch (e) { speechSynthesis.onvoiceschanged = fillVoiceSelect; }
    setTimeout(fillVoiceSelect, 1500);
  }
  $("voiceBtn").onclick = toggleVoiceBtn;
  $("clearBlanksBtn").onclick = () => { setBlanks([]); toast("빈칸을 모두 지웠습니다"); };
  $("resetBlanksBtn").onclick = () => { setBlanks(null); toast("기본 빈칸으로 되돌렸습니다"); };
  $("voiceToggle").addEventListener("change", (e) => setVoice(e.target.checked));
  $("speedRange").addEventListener("input", (e) => changeSpeed(Number(e.target.value)));
  $("slowerBtn").onclick = () => changeSpeed(settings.speedIdx - 1);
  $("fasterBtn").onclick = () => changeSpeed(settings.speedIdx + 1);
  $("playBtn").onclick = () => (state.playing ? pause() : play());
  $("prevLineBtn").onclick = () => stepLine(-1);
  $("nextLineBtn").onclick = () => stepLine(1);
  $("revealBtn").onclick = () => {
    const blanks = Array.from($("lines").querySelectorAll(".blank"));
    if (settings.hint === "key") {
      const all = blanks.every((b) => b.classList.contains("revealed"));
      blanks.forEach((b) => b.classList.toggle("revealed", !all));
      return;
    }
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

  // 세로 ↔ 가로 화면 전환 시 글자 크기·위치 다시 맞추기
  function refit() {
    if ($("viewScreen").classList.contains("hidden")) return;
    fitText(settings.mode !== "lyric" || $("viewScreen").classList.contains("finished"));
    if (settings.mode === "lyric" && state.lineIdx >= 0) centerLine($("lines").children[state.lineIdx]);
  }
  window.addEventListener("resize", refit);
  // 일부 휴대폰은 회전 직후 화면 크기가 늦게 바뀌므로 한 번 더 맞춤
  window.addEventListener("orientationchange", () => setTimeout(refit, 350));

  // ---------- 시작 ----------
  setSpeed(settings.speedIdx);
  setFont(settings.fontSize);
  setLoops(settings.loops);
  setAfter(settings.after);
  setGender(settings.gender, true);
  setStyle(settings.style);
  setVoice(settings.voice);
  renderJumpNav();
  renderList("");

  // 오프라인 사용을 위한 서비스 워커 등록
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
