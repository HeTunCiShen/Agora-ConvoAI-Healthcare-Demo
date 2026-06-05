// Device Settings — shared mic/speaker picker for the desktop nav.
//
// A floating popover anchored to the "Device" nav button. Enumerates audio
// input (microphone) and output (speaker) devices via the Agora RTC SDK and
// lets the user pick which to use. Selection takes effect immediately:
//   - Not in a call: the choice is remembered and applied when the next call
//     creates its mic track / plays remote audio.
//   - In a call: the host page's applyMic/applySpeaker hooks re-route the live
//     mic capture and remote playback so the conversation updates on the fly.
//
// No save button — selecting a device IS the action. Clicking anywhere outside
// the popover closes it. Desktop only (the nav button is hidden on mobile).
(function () {
  const STORE_MIC = 'healthai.device.micId';
  const STORE_SPK = 'healthai.device.speakerId';

  let micId = safeGet(STORE_MIC);
  let speakerId = safeGet(STORE_SPK);
  let hooks = { applyMic: null, applySpeaker: null };

  let button = null;
  let popover = null;
  let micSelect = null;
  let speakerSelect = null;
  let speakerSupported = true;

  function safeGet(k) { try { return localStorage.getItem(k) || null; } catch (e) { return null; } }
  function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }

  function init(opts) {
    opts = opts || {};
    button = document.getElementById(opts.buttonId || 'device-setting-btn');
    if (!button) return;
    hooks.applyMic = typeof opts.applyMic === 'function' ? opts.applyMic : null;
    hooks.applySpeaker = typeof opts.applySpeaker === 'function' ? opts.applySpeaker : null;

    buildPopover();
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
  }

  function toggle() { isOpen() ? close() : open(); }

  function buildPopover() {
    popover = document.createElement('div');
    popover.className = 'device-settings-popover';
    popover.hidden = true;
    popover.innerHTML = `
      <div class="device-settings-title">Audio devices</div>
      <div class="device-settings-section">
        <label class="device-settings-label">
          <span class="material-symbols-outlined">mic</span> Microphone
        </label>
        <select class="device-settings-select" data-kind="mic"></select>
      </div>
      <div class="device-settings-section">
        <label class="device-settings-label">
          <span class="material-symbols-outlined">volume_up</span> Speaker
        </label>
        <select class="device-settings-select" data-kind="speaker"></select>
        <div class="device-settings-note" data-kind="speaker-note" hidden>
          Speaker selection isn't supported in this browser.
        </div>
      </div>
    `;
    document.body.appendChild(popover);

    micSelect = popover.querySelector('select[data-kind="mic"]');
    speakerSelect = popover.querySelector('select[data-kind="speaker"]');

    // Keep clicks inside the popover from bubbling to the document close handler.
    popover.addEventListener('click', (e) => e.stopPropagation());

    micSelect.addEventListener('change', async () => {
      micId = micSelect.value || null;
      safeSet(STORE_MIC, micId);
      if (hooks.applyMic && micId) {
        try { await hooks.applyMic(micId); }
        catch (e) { console.warn('[deviceSettings] applyMic failed:', e); }
      }
    });

    speakerSelect.addEventListener('change', async () => {
      speakerId = speakerSelect.value || null;
      safeSet(STORE_SPK, speakerId);
      if (hooks.applySpeaker && speakerId) {
        try { await hooks.applySpeaker(speakerId); }
        catch (e) { console.warn('[deviceSettings] applySpeaker failed:', e); }
      }
    });
  }

  function isOpen() { return popover && !popover.hidden; }

  function open() {
    if (isOpen()) return;
    // Show immediately — opening must never depend on async device enumeration
    // (getMicrophones() can block on a permission prompt). The opening click's
    // own mousedown already fired before this runs, and we stopPropagation on
    // the click, so registering the outside-click listener now is safe.
    popover.hidden = false;
    position();
    document.addEventListener('mousedown', onOutsideClick);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    // Populate device lists (and trigger the permission prompt) afterward,
    // then re-position since the content height may have changed.
    refreshDevices().then(position).catch(() => {});
  }

  function close() {
    if (!isOpen()) return;
    popover.hidden = true;
    document.removeEventListener('mousedown', onOutsideClick);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
  }

  function onOutsideClick(e) {
    const t = e.target;
    if (t.closest && (t.closest('.device-settings-popover') || t.closest('#device-setting-btn'))) return;
    close();
  }

  function position() {
    if (!button || !popover) return;
    const r = button.getBoundingClientRect();
    const width = popover.offsetWidth || 260;
    let left = r.right - width;
    if (left < 8) left = 8;
    popover.style.top = (r.bottom + 8) + 'px';
    popover.style.left = left + 'px';
  }

  async function refreshDevices() {
    // Microphones — getMicrophones() also prompts for permission so labels resolve.
    try {
      const mics = await AgoraRTC.getMicrophones();
      fillSelect(micSelect, mics, micId, 'Microphone');
    } catch (e) {
      console.warn('[deviceSettings] getMicrophones failed:', e);
      micSelect.innerHTML = '<option value="">No microphone access</option>';
      micSelect.disabled = true;
    }

    // Speakers — not supported in every browser (needs setSinkId).
    const speakerNote = popover.querySelector('[data-kind="speaker-note"]');
    try {
      const speakers = await AgoraRTC.getPlaybackDevices();
      if (!speakers || speakers.length === 0) throw new Error('no playback devices');
      speakerSupported = true;
      speakerSelect.disabled = false;
      speakerNote.hidden = true;
      fillSelect(speakerSelect, speakers, speakerId, 'Speaker');
    } catch (e) {
      speakerSupported = false;
      speakerSelect.innerHTML = '';
      speakerSelect.disabled = true;
      speakerNote.hidden = false;
    }
  }

  function fillSelect(select, devices, currentId, fallbackPrefix) {
    select.innerHTML = '';
    select.disabled = false;
    let matched = false;
    devices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `${fallbackPrefix} ${i + 1}`;
      if (currentId && d.deviceId === currentId) { opt.selected = true; matched = true; }
      select.appendChild(opt);
    });
    // If the remembered device is gone, fall back to the active/first device
    // and keep our stored id in sync so reads stay valid.
    if (!matched && devices.length) {
      select.selectedIndex = 0;
      const id = devices[0].deviceId;
      if (select === micSelect) { micId = id; safeSet(STORE_MIC, id); }
      else { speakerId = id; safeSet(STORE_SPK, id); }
    }
  }

  window.DeviceSettings = {
    init,
    getMicId: () => micId,
    getSpeakerId: () => (speakerSupported ? speakerId : null),
    close,
  };
})();
