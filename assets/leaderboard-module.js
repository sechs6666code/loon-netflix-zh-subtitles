import {
  MILESTONES,
  PROFILE_KEY,
  RANK_SNAPSHOT_KEY,
  RECORDS_KEY,
  calculateStreaks,
  createRecoveryCode,
  localDateKey,
  milestoneState,
  parseRecoveryCode,
  readProfile,
  readRecords,
  validatePublicId,
} from "./leaderboard-core.js";

(() => {
  const root = document.getElementById("root");
  if (!root) return;

  const apiBase = String(window.CHONGLEMA_LEADERBOARD_API || "").trim().replace(/\/+$/, "");
  const state = {
    profile: readProfile(),
    draftId: "",
    draftPublic: false,
    tab: "ninja",
    boards: { ninja: [], rush: [] },
    loading: false,
    saving: false,
    error: "",
    open: false,
    rankPrevious: { ninja: null, rush: null },
    recoveryOpen: false,
    recoveryCandidate: null,
    recoveryMessage: "",
    recoveryTone: "",
  };
  state.draftId = state.profile.publicId;
  state.draftPublic = state.profile.isPublic;

  let trigger = null;
  let inlineEntry = null;
  let overlay = null;
  let syncTimer = 0;
  let previousOverflow = "";
  let dialogOpener = null;

  const trophyIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"></path>
      <path d="M8 6H5v1a4 4 0 0 0 4 4M16 6h3v1a4 4 0 0 1-4 4M12 12v5m-4 3h8"></path>
    </svg>`;

  const shieldIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s7-3.5 7-9V5l-7-3-7 3v7c0 5.5 7 9 7 9Z"></path>
      <path d="m9 12 2 2 4-5"></path>
    </svg>`;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);

  const profileKey = (value) => String(value || "").normalize("NFC").toLocaleLowerCase("zh-CN");

  const scores = () => calculateStreaks(readRecords());

  function currentRanks() {
    const findRank = (entries) => {
      if (!state.profile.isPublic || !state.profile.publicId) return null;
      const own = entries.find((entry) => profileKey(entry.publicId) === profileKey(state.profile.publicId));
      return own ? Number(own.rank) || null : null;
    };
    return {
      ninja: findRank(state.boards.ninja),
      rush: findRank(state.boards.rush),
    };
  }

  function updateRankSnapshot() {
    const current = currentRanks();
    const today = localDateKey();
    const identity = profileKey(state.profile.publicId);
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(RANK_SNAPSHOT_KEY) || "null");
    } catch {
      stored = null;
    }
    if (!stored || stored.identity !== identity) stored = null;
    const previous = stored?.date === today
      ? (stored.previous || { ninja: null, rush: null })
      : (stored?.current || { ninja: null, rush: null });
    state.rankPrevious = previous;
    try {
      localStorage.setItem(RANK_SNAPSHOT_KEY, JSON.stringify({ identity, date: today, previous, current }));
    } catch {
      // Ranking still works when storage is unavailable; only the movement hint is omitted.
    }
  }

  function saveProfileLocally() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    } catch {
      // The current session can still use the profile when storage is blocked.
    }
  }

  async function requestJson(path, options = {}) {
    if (!apiBase) throw new Error("排行榜服务尚未连接");
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "排行榜服务暂时不可用");
    return payload;
  }

  async function loadBoards({ quiet = false } = {}) {
    if (!apiBase) {
      state.loading = false;
      renderBoard();
      return;
    }
    if (!quiet) state.loading = true;
    state.error = "";
    renderBoard();
    try {
      const payload = await requestJson("/v1/leaderboard", { method: "GET", cache: "no-store" });
      state.boards = {
        ninja: Array.isArray(payload.ninja) ? payload.ninja : [],
        rush: Array.isArray(payload.rush) ? payload.rush : [],
      };
      updateRankSnapshot();
    } catch (error) {
      state.error = error instanceof Error ? error.message : "排行榜加载失败";
    } finally {
      state.loading = false;
      renderBoard();
    }
  }

  async function publishProfile({ quiet = false } = {}) {
    const currentScores = scores();
    const isRemoving = !state.profile.isPublic;
    const payload = isRemoving
      ? { ownerToken: state.profile.ownerToken }
      : {
          publicId: state.profile.publicId,
          ownerToken: state.profile.ownerToken,
          isPublic: true,
          ...currentScores,
        };
    return requestJson("/v1/profile", {
      method: isRemoving ? "DELETE" : "POST",
      body: JSON.stringify(payload),
    }).then(async (responsePayload) => {
      if (!quiet) {
        setStatus(
          isRemoving ? "已退出排行榜，ID 与记录只保存在本机" : "已公开参与排行榜",
          "success",
        );
      }
      await loadBoards({ quiet: true });
      return responsePayload;
    });
  }

  function scheduleScoreSync() {
    window.clearTimeout(syncTimer);
    renderScores();
    if (!apiBase || !state.profile.isPublic || !state.profile.publicId) return;
    syncTimer = window.setTimeout(() => {
      publishProfile({ quiet: true }).catch(() => undefined);
    }, 650);
  }

  function createTrigger() {
    const button = document.createElement("button");
    button.className = "leaderboard-trigger";
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "leaderboard-dialog");
    button.innerHTML = `${trophyIcon}<span>排行榜</span><b data-leaderboard-trigger-count>0</b>`;
    button.addEventListener("click", (event) => openDialog(event.currentTarget));
    return button;
  }

  function createInlineEntry() {
    const button = document.createElement("button");
    button.className = "leaderboard-inline-entry";
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "leaderboard-dialog");
    button.innerHTML = `
      <span class="leaderboard-inline-icon">${trophyIcon}</span>
      <span class="leaderboard-inline-copy">
        <small>双榜排行</small>
        <strong>看看今天谁在坚持</strong>
        <em data-leaderboard-inline-status>公开由您决定 · 日历不会上传</em>
      </span>
      <span class="leaderboard-inline-scores" aria-hidden="true">
        <span><b data-leaderboard-inline-ninja>0</b><small>忍住</small></span>
        <span><b data-leaderboard-inline-rush>0</b><small>连冲</small></span>
      </span>
      <span class="leaderboard-inline-cta">查看双榜</span>`;
    button.addEventListener("click", (event) => openDialog(event.currentTarget));
    return button;
  }

  function createDialog() {
    const element = document.createElement("div");
    element.id = "leaderboard-dialog";
    element.className = "leaderboard-overlay";
    element.hidden = true;
    element.innerHTML = `
      <section class="leaderboard-panel" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
        <i class="leaderboard-handle" aria-hidden="true"></i>
        <header class="leaderboard-header">
          <div>
            <small>COMMUNITY RANKING</small>
            <h2 id="leaderboard-title">自律排行榜</h2>
          </div>
          <button class="leaderboard-close" type="button" aria-label="关闭排行榜">×</button>
        </header>

        <div class="leaderboard-scroll">
          <section class="leaderboard-privacy">
            <span>${shieldIcon}</span>
            <div><b>只公开最少数据</b><p>日历和打卡日期不会上传；公开时仅同步 ID 与两项连续天数。</p></div>
          </section>

          <section class="leaderboard-local-scores" aria-label="我的当前连续天数">
            <article><span>忍者榜</span><strong data-leaderboard-ninja-days>0<small> 天</small></strong><p>连续忍住</p></article>
            <article><span>连冲榜</span><strong data-leaderboard-rush-days>0<small> 天</small></strong><p>连续冲了</p></article>
          </section>

          <section class="leaderboard-milestones" aria-labelledby="leaderboard-milestone-title">
            <div class="leaderboard-section-title">
              <div><small>MILESTONES</small><h3 id="leaderboard-milestone-title">里程碑徽章</h3></div>
              <span data-leaderboard-badge-count>0/10 已解锁</span>
            </div>
            <div class="leaderboard-milestone-list"></div>
          </section>

          <section class="leaderboard-profile-card">
            <div class="leaderboard-section-title">
              <div><small>MY PROFILE</small><h3>我的榜单身份</h3></div>
              <span data-leaderboard-visibility><i></i>未公开</span>
            </div>
            <label class="leaderboard-id-field">
              <span>自定义 ID</span>
              <div><input type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="例如：今晚不熬夜"><small data-leaderboard-id-count>0/16</small></div>
              <em>3—16 位，支持中文、字母、数字、_ 和 -；修改权绑定当前浏览器</em>
            </label>
            <div class="leaderboard-visibility-choice" role="group" aria-label="数据公开设置">
              <button type="button" data-visibility="public"><span>${trophyIcon}</span><b>公开参与</b><small>展示 ID 与连续天数</small></button>
              <button type="button" data-visibility="private"><span>${shieldIcon}</span><b>不公开</b><small>ID 与记录仅留本机</small></button>
            </div>
            <p class="leaderboard-profile-status" role="status" aria-live="polite"></p>
            <button class="leaderboard-save" type="button">保存榜单设置</button>

            <section class="leaderboard-recovery" aria-labelledby="leaderboard-recovery-title">
              <div>
                <b id="leaderboard-recovery-title">身份备份与恢复</b>
                <p>恢复自定义 ID、修改权和本地打卡记录。</p>
              </div>
              <div class="leaderboard-recovery-actions">
                <button type="button" data-recovery-copy>复制恢复码</button>
                <button type="button" data-recovery-open>导入恢复码</button>
              </div>
              <div class="leaderboard-recovery-form" hidden>
                <label for="leaderboard-recovery-code">粘贴恢复码</label>
                <textarea id="leaderboard-recovery-code" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="CLM1.…"></textarea>
                <p class="leaderboard-recovery-warning">恢复码包含身份密钥和打卡记录，请勿发送给他人。</p>
                <p class="leaderboard-recovery-status" role="status" aria-live="polite"></p>
                <div class="leaderboard-recovery-candidate" hidden></div>
                <div class="leaderboard-recovery-form-actions">
                  <button type="button" data-recovery-cancel>取消</button>
                  <button type="button" data-recovery-verify>验证恢复码</button>
                </div>
              </div>
            </section>
          </section>

          <section class="leaderboard-board-card">
            <div class="leaderboard-tabs" role="tablist" aria-label="排行榜分类">
              <button type="button" role="tab" data-tab="ninja" aria-selected="true">忍者榜</button>
              <button type="button" role="tab" data-tab="rush" aria-selected="false">连冲榜</button>
              <button class="leaderboard-refresh" type="button" aria-label="刷新排行榜">↻</button>
            </div>
            <div class="leaderboard-board-summary">
              <div><span data-leaderboard-board-label>连续忍住天数</span><strong data-leaderboard-current-days>0<small> 天</small></strong></div>
              <div><span>我的排名</span><strong data-leaderboard-my-rank>未公开</strong></div>
            </div>
            <p class="leaderboard-rank-insight" data-leaderboard-rank-insight>公开参与后显示名次变化</p>
            <div class="leaderboard-list" aria-live="polite"></div>
            <footer>TOP 100 · 数据来自用户打卡汇总，采用荣誉制</footer>
          </section>
        </div>
      </section>`;

    element.querySelector(".leaderboard-close")?.addEventListener("click", closeDialog);
    element.addEventListener("click", (event) => {
      if (event.target === element) closeDialog();
    });

    const input = element.querySelector(".leaderboard-id-field input");
    input?.addEventListener("input", () => {
      state.draftId = input.value;
      renderIdCount();
      setStatus("", "");
    });

    element.querySelectorAll("[data-visibility]").forEach((button) => {
      button.addEventListener("click", () => {
        state.draftPublic = button.dataset.visibility === "public";
        renderVisibility();
        setStatus("", "");
        navigator.vibrate?.(7);
      });
    });

    element.querySelector(".leaderboard-save")?.addEventListener("click", saveDraftProfile);
    element.querySelector("[data-recovery-copy]")?.addEventListener("click", copyRecoveryCode);
    element.querySelector("[data-recovery-open]")?.addEventListener("click", openRecoveryForm);
    element.querySelector("[data-recovery-cancel]")?.addEventListener("click", closeRecoveryForm);
    element.querySelector("[data-recovery-verify]")?.addEventListener("click", verifyRecoveryCode);
    element.querySelector(".leaderboard-refresh")?.addEventListener("click", () => loadBoards());
    element.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.tab = button.dataset.tab === "rush" ? "rush" : "ninja";
        renderTabs();
        renderBoard();
        navigator.vibrate?.(5);
      });
    });
    return element;
  }

  function openDialog(opener = null) {
    if (!overlay) return;
    dialogOpener = opener instanceof window.HTMLElement ? opener : document.activeElement;
    state.open = true;
    state.draftId = state.profile.publicId;
    state.draftPublic = state.profile.isPublic;
    const input = overlay.querySelector(".leaderboard-id-field input");
    if (input) input.value = state.draftId;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("is-open"));
    render();
    void loadBoards();
    navigator.vibrate?.(8);
  }

  function closeDialog() {
    if (!overlay || overlay.hidden) return;
    state.open = false;
    overlay.classList.remove("is-open");
    document.body.style.overflow = previousOverflow;
    window.setTimeout(() => {
      if (!state.open && overlay) overlay.hidden = true;
    }, 260);
    const focusTarget = dialogOpener?.isConnected ? dialogOpener : trigger;
    focusTarget?.focus();
    dialogOpener = null;
  }

  async function writeClipboard(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("当前浏览器不支持自动复制");
  }

  async function copyRecoveryCode() {
    const validation = validatePublicId(state.profile.publicId);
    if (!validation.valid) {
      setStatus("请先创建并保存自定义 ID，再生成恢复码", "warning");
      overlay?.querySelector(".leaderboard-id-field input")?.focus();
      return;
    }
    try {
      await writeClipboard(createRecoveryCode(state.profile, readRecords()));
      setStatus("恢复码已复制，请保存在只有您能访问的地方", "success");
      navigator.vibrate?.(10);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "恢复码复制失败", "error");
    }
  }

  function openRecoveryForm() {
    state.recoveryOpen = true;
    state.recoveryCandidate = null;
    state.recoveryMessage = "";
    state.recoveryTone = "";
    renderRecovery();
    window.setTimeout(() => overlay?.querySelector("#leaderboard-recovery-code")?.focus(), 0);
  }

  function closeRecoveryForm() {
    state.recoveryOpen = false;
    state.recoveryCandidate = null;
    state.recoveryMessage = "";
    state.recoveryTone = "";
    const input = overlay?.querySelector("#leaderboard-recovery-code");
    if (input) input.value = "";
    renderRecovery();
  }

  function verifyRecoveryCode() {
    const input = overlay?.querySelector("#leaderboard-recovery-code");
    const parsed = parseRecoveryCode(input?.value || "");
    state.recoveryCandidate = parsed.valid ? parsed : null;
    state.recoveryMessage = parsed.valid
      ? "恢复码有效，请核对后确认恢复。"
      : parsed.error;
    state.recoveryTone = parsed.valid ? "success" : "error";
    renderRecovery();
  }

  function confirmRecovery() {
    const candidate = state.recoveryCandidate;
    if (!candidate?.valid) return;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(candidate.profile));
      localStorage.setItem(RECORDS_KEY, JSON.stringify(candidate.records));
      localStorage.removeItem(RANK_SNAPSHOT_KEY);
      state.profile = candidate.profile;
      state.draftId = candidate.profile.publicId;
      state.draftPublic = candidate.profile.isPublic;
      state.rankPrevious = { ninja: null, rush: null };
      state.recoveryMessage = `已恢复 ${candidate.profile.publicId}，页面即将刷新`;
      state.recoveryTone = "success";
      render();
      navigator.vibrate?.(16);
      window.setTimeout(() => window.location.reload(), 650);
    } catch {
      state.recoveryMessage = "当前浏览器无法写入恢复数据";
      state.recoveryTone = "error";
      renderRecovery();
    }
  }

  async function saveDraftProfile() {
    const validation = validatePublicId(state.draftId);
    if (!validation.valid) {
      setStatus(validation.error, "error");
      overlay?.querySelector(".leaderboard-id-field input")?.focus();
      return;
    }

    state.profile = {
      ...state.profile,
      publicId: validation.publicId,
      isPublic: state.draftPublic,
    };
    state.draftId = validation.publicId;
    saveProfileLocally();
    state.saving = true;
    state.error = "";
    renderProfile();

    if (!apiBase) {
      state.saving = false;
      setStatus(
        state.profile.isPublic
          ? "身份已保存在本机；连接排行榜服务后即可同步全站排名"
          : "已设为不公开，ID 与记录只保存在本机",
        state.profile.isPublic ? "warning" : "success",
      );
      renderProfile();
      return;
    }

    try {
      await publishProfile();
      navigator.vibrate?.(12);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "排行榜保存失败", "error");
    } finally {
      state.saving = false;
      renderProfile();
    }
  }

  function setStatus(message, tone) {
    const status = overlay?.querySelector(".leaderboard-profile-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function renderIdCount() {
    const count = overlay?.querySelector("[data-leaderboard-id-count]");
    if (count) count.textContent = `${Array.from(state.draftId).length}/16`;
  }

  function renderVisibility() {
    overlay?.querySelectorAll("[data-visibility]").forEach((button) => {
      const selected = (button.dataset.visibility === "public") === state.draftPublic;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const badge = overlay?.querySelector("[data-leaderboard-visibility]");
    if (badge) {
      badge.classList.toggle("is-public", state.profile.isPublic);
      badge.innerHTML = `<i></i>${state.profile.isPublic ? "公开中" : "未公开"}`;
    }
    const inlineStatus = inlineEntry?.querySelector("[data-leaderboard-inline-status]");
    if (inlineStatus) {
      inlineStatus.textContent = state.profile.isPublic
        ? "已公开参与 · 点此查看我的排名"
        : "公开由您决定 · 日历不会上传";
    }
  }

  function renderScores() {
    const current = scores();
    const ninja = overlay?.querySelector("[data-leaderboard-ninja-days]");
    const rush = overlay?.querySelector("[data-leaderboard-rush-days]");
    const triggerCount = trigger?.querySelector("[data-leaderboard-trigger-count]");
    const inlineNinja = inlineEntry?.querySelector("[data-leaderboard-inline-ninja]");
    const inlineRush = inlineEntry?.querySelector("[data-leaderboard-inline-rush]");
    if (ninja) ninja.innerHTML = `${current.ninjaDays}<small> 天</small>`;
    if (rush) rush.innerHTML = `${current.rushDays}<small> 天</small>`;
    if (triggerCount) triggerCount.textContent = String(current.ninjaDays);
    if (inlineNinja) inlineNinja.textContent = String(current.ninjaDays);
    if (inlineRush) inlineRush.textContent = String(current.rushDays);
    inlineEntry?.setAttribute(
      "aria-label",
      `打开自律排行榜，当前连续忍住 ${current.ninjaDays} 天，连续冲了 ${current.rushDays} 天`,
    );
  }

  function renderMilestones() {
    const list = overlay?.querySelector(".leaderboard-milestone-list");
    const count = overlay?.querySelector("[data-leaderboard-badge-count]");
    if (!list) return;
    const current = scores();
    const types = [
      { type: "ninja", label: "忍者成就", days: current.ninjaDays },
      { type: "rush", label: "连冲成就", days: current.rushDays },
    ];
    const unlocked = types.reduce((total, item) => total + milestoneState(item.days, item.type).earned.length, 0);
    if (count) count.textContent = `${unlocked}/${MILESTONES.length * 2} 已解锁`;
    list.innerHTML = types.map((item) => {
      const progress = milestoneState(item.days, item.type);
      const nextText = progress.next
        ? `距「${progress.next[item.type]}」还差 ${progress.next.days - progress.days} 天`
        : "全部里程碑已解锁";
      const badges = MILESTONES.map((milestone) => {
        const earned = progress.days >= milestone.days;
        return `<span class="leaderboard-badge${earned ? " is-earned" : ""}" aria-label="${escapeHtml(milestone[item.type])}，${milestone.days} 天，${earned ? "已解锁" : "未解锁"}">
          <b>${milestone.days}</b><small>${escapeHtml(milestone[item.type])}</small>
        </span>`;
      }).join("");
      return `<article class="leaderboard-milestone-track" data-milestone-type="${item.type}">
        <header><div><span>${item.label}</span><strong>${escapeHtml(progress.currentLabel)}</strong></div><em>${item.days} 天</em></header>
        <div class="leaderboard-badges">${badges}</div>
        <div class="leaderboard-milestone-progress" aria-hidden="true"><i style="width:${progress.progress.toFixed(2)}%"></i></div>
        <p>${escapeHtml(nextText)}</p>
      </article>`;
    }).join("");
  }

  function renderRecovery() {
    const form = overlay?.querySelector(".leaderboard-recovery-form");
    const status = overlay?.querySelector(".leaderboard-recovery-status");
    const candidate = overlay?.querySelector(".leaderboard-recovery-candidate");
    if (!form || !status || !candidate) return;
    form.hidden = !state.recoveryOpen;
    status.textContent = state.recoveryMessage;
    status.dataset.tone = state.recoveryTone;
    const parsed = state.recoveryCandidate;
    if (!parsed?.valid) {
      candidate.hidden = true;
      candidate.innerHTML = "";
      return;
    }
    const recordCount = Object.keys(parsed.records).length;
    candidate.hidden = false;
    candidate.innerHTML = `<div><span>将恢复的身份</span><strong>${escapeHtml(parsed.profile.publicId)}</strong></div>
      <dl><div><dt>公开设置</dt><dd>${parsed.profile.isPublic ? "公开参与" : "不公开"}</dd></div><div><dt>打卡记录</dt><dd>${recordCount} 天</dd></div></dl>
      <button type="button" data-recovery-confirm>确认恢复并覆盖本机数据</button>`;
    candidate.querySelector("[data-recovery-confirm]")?.addEventListener("click", confirmRecovery);
  }

  function renderProfile() {
    if (!overlay) return;
    const input = overlay.querySelector(".leaderboard-id-field input");
    if (input && document.activeElement !== input) input.value = state.draftId;
    const saveButton = overlay.querySelector(".leaderboard-save");
    if (saveButton) {
      saveButton.disabled = state.saving;
      saveButton.textContent = state.saving ? "正在保存…" : state.profile.publicId ? "保存并更新排名" : "创建榜单身份";
    }
    renderIdCount();
    renderVisibility();
    renderRecovery();
  }

  function renderTabs() {
    overlay?.querySelectorAll("[data-tab]").forEach((button) => {
      const selected = button.dataset.tab === state.tab;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
  }

  function renderBoard() {
    if (!overlay) return;
    const current = scores();
    const entries = state.tab === "ninja" ? state.boards.ninja : state.boards.rush;
    const own = entries.find((entry) => profileKey(entry.publicId) === profileKey(state.profile.publicId));
    const label = overlay.querySelector("[data-leaderboard-board-label]");
    const currentValue = overlay.querySelector("[data-leaderboard-current-days]");
    const rank = overlay.querySelector("[data-leaderboard-my-rank]");
    const insight = overlay.querySelector("[data-leaderboard-rank-insight]");
    const list = overlay.querySelector(".leaderboard-list");
    if (label) label.textContent = state.tab === "ninja" ? "连续忍住天数" : "连续冲的天数";
    if (currentValue) currentValue.innerHTML = `${state.tab === "ninja" ? current.ninjaDays : current.rushDays}<small> 天</small>`;
    if (rank) rank.textContent = state.profile.isPublic ? (own ? `#${own.rank}` : "等待上榜") : "未公开";
    if (insight) {
      if (!state.profile.isPublic) {
        insight.textContent = "公开参与后显示名次变化";
        insight.dataset.tone = "muted";
      } else if (!own) {
        insight.textContent = "完成连续记录后即可进入本榜";
        insight.dataset.tone = "muted";
      } else {
        const previous = state.rankPrevious[state.tab];
        const movement = Number.isFinite(previous) ? previous - Number(own.rank) : null;
        const index = entries.indexOf(own);
        const gap = index > 0 ? Math.max(1, Number(entries[index - 1].days) - Number(own.days) + 1) : 0;
        const movementText = movement === null
          ? "首次记录排名"
          : movement > 0
            ? `今日上升 ${movement} 名`
            : movement < 0
              ? `今日下降 ${Math.abs(movement)} 名`
              : "今日排名不变";
        insight.textContent = index === 0 ? `${movementText} · 当前榜首` : `${movementText} · 距上一名还差 ${gap} 天`;
        insight.dataset.tone = movement > 0 ? "up" : movement < 0 ? "down" : "steady";
      }
    }
    if (!list) return;

    if (state.loading && entries.length === 0) {
      list.innerHTML = `<div class="leaderboard-loading"><i></i><i></i><i></i><i></i></div>`;
      return;
    }
    if (!apiBase) {
      list.innerHTML = `<div class="leaderboard-empty"><span>${trophyIcon}</span><b>排行榜服务待启用</b><p>界面与隐私设置已就绪，连接共享接口后即可显示全站排名。</p></div>`;
      return;
    }
    if (state.error && entries.length === 0) {
      list.innerHTML = `<div class="leaderboard-empty is-error"><span>!</span><b>暂时无法读取排行榜</b><p>${escapeHtml(state.error)}</p><button type="button" data-board-retry>重新加载</button></div>`;
      list.querySelector("[data-board-retry]")?.addEventListener("click", () => loadBoards());
      return;
    }
    if (entries.length === 0) {
      list.innerHTML = `<div class="leaderboard-empty"><span>${trophyIcon}</span><b>榜首虚位以待</b><p>创建 ID 并选择公开后，您就会出现在这里。</p></div>`;
      return;
    }

    const podium = entries.slice(0, 3).map((entry) => {
      const mine = profileKey(entry.publicId) === profileKey(state.profile.publicId);
      const mark = Number(entry.rank) === 1 ? "♛" : Number(entry.rank) === 2 ? "Ⅱ" : "Ⅲ";
      return `<article class="leaderboard-podium-card rank-${Number(entry.rank)}${mine ? " is-mine" : ""}">
        <em>${mark}</em><span>${escapeHtml(Array.from(String(entry.publicId))[0]?.toUpperCase() || "?")}</span>
        <b>${escapeHtml(entry.publicId)}</b><strong>${Number(entry.days) || 0}<small> 天</small></strong>
      </article>`;
    }).join("");
    const rows = entries.slice(3).map((entry) => {
      const mine = profileKey(entry.publicId) === profileKey(state.profile.publicId);
      return `<div class="leaderboard-row${mine ? " is-mine" : ""}">
        <span class="leaderboard-rank-number">${Number(entry.rank) || 0}</span>
        <span class="leaderboard-avatar">${escapeHtml(Array.from(String(entry.publicId))[0]?.toUpperCase() || "?")}</span>
        <b>${escapeHtml(entry.publicId)}${mine ? "<em>我</em>" : ""}</b>
        <strong>${Number(entry.days) || 0}<small> 天</small></strong>
      </div>`;
    }).join("");
    list.innerHTML = `<div class="leaderboard-podium">${podium}</div>${rows ? `<div class="leaderboard-rows">${rows}</div>` : ""}`;
  }

  function render() {
    renderScores();
    renderMilestones();
    renderProfile();
    renderTabs();
    renderBoard();
  }

  function ensureMounted() {
    const topbar = document.querySelector(".topbar");
    const stats = document.querySelector(".stats");
    if (!trigger) trigger = createTrigger();
    if (!inlineEntry) inlineEntry = createInlineEntry();
    if (topbar && !trigger.isConnected) {
      topbar.insertBefore(trigger, topbar.querySelector(".menu-wrap"));
    }
    if (stats && (!inlineEntry.isConnected || inlineEntry.nextElementSibling !== stats)) {
      stats.before(inlineEntry);
    }
    if (!overlay) {
      overlay = createDialog();
      document.body.append(overlay);
    }
    renderScores();
    renderVisibility();
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest?.(".answer, .history-actions button")) {
      window.setTimeout(scheduleScoreSync, 140);
      window.setTimeout(scheduleScoreSync, 460);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) closeDialog();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === RECORDS_KEY) scheduleScoreSync();
    if (event.key === PROFILE_KEY) {
      state.profile = readProfile();
      state.draftId = state.profile.publicId;
      state.draftPublic = state.profile.isPublic;
      render();
    }
  });

  const mountObserver = new MutationObserver(() => {
    const stats = document.querySelector(".stats");
    const inlineEntryNeedsMount = stats
      && (!inlineEntry?.isConnected || inlineEntry.nextElementSibling !== stats);
    if (!trigger?.isConnected || inlineEntryNeedsMount) ensureMounted();
  });
  mountObserver.observe(root, { childList: true, subtree: true });
  ensureMounted();
})();
