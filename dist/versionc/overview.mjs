import {renderStudioOverview as renderOverview} from '../overview.mjs';

// Compose the report and controls inside the continuous mountain atmosphere.
const originalWindow = '<div class="hero-art window-art"><img src="/images/studio-window.webp" width="1200" height="800" alt="" fetchpriority="high" decoding="async"></div>';

export function renderStudioOverview(options) {
  const label = options.language === 'th' ? 'เปลี่ยนแสงที่หน้าต่าง' : 'Change window lighting';
  const scene = `<div class="hero-art window-art c-window" data-window-scene data-window-light="off">
    <span class="c-window-shadow" aria-hidden="true"></span>
    <span class="c-window-spill" aria-hidden="true"></span>
    <button type="button" class="c-window-button" aria-label="${label}" aria-pressed="false">
      <span class="c-window-viewport" aria-hidden="true">
      <span class="c-window-camera" aria-hidden="true">
        <img class="c-window-photo" src="/images/studio-window.webp" width="1200" height="800" alt="" fetchpriority="high" decoding="async" draggable="false">
        <img class="c-window-photo c-window-photo-warm" src="/images/studio-window.webp" width="1200" height="800" alt="" decoding="async" draggable="false">
        <span class="c-window-haze"></span>
        <span class="c-window-reflection"></span>
        <span class="c-window-glint"></span>
        <span class="c-window-light"></span>
        <span class="c-window-golden"></span>
        <span class="c-window-caustic"></span>
      </span>
      </span>
      <span class="c-window-rim" aria-hidden="true"></span>
    </button>
  </div>`;
  return `<div class="c-overview"><span class="c-atmosphere c-atmosphere-sage" aria-hidden="true"></span><span class="c-atmosphere c-atmosphere-sun" aria-hidden="true"></span>${renderOverview(options).replace(originalWindow, scene)}</div>`;
}
