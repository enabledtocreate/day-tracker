/**
 * Mobile: sliding panels (Completed | Tasks+Schedule | AI) and task subviews (Unassigned | Pending).
 * Swipe left/right to switch. Touch-friendly UX. When AI is disabled, only Completed and Tasks panels are slidable.
 */
import { showCompletedPanelAndLoad } from './completed-panel';
import { isAiEnabled } from './auth';

const MOBILE_BREAKPOINT = 768;
const SWIPE_THRESHOLD = 60;

const panelsEl = document.getElementById('main-panels');
const taskListSectionsEl = document.getElementById('task-list-sections');
const mobileNavEl = document.getElementById('task-list-sections-mobile-nav');

let mainSlideIndex = 1; // 0=Completed, 1=Tasks+Schedule, 2=AI (default: tasks)
let taskSlideIndex = 0; // slide index into visible task sections (Unassigned | Pending)

let touchStartX = 0;
let touchStartY = 0;
let touchStartTarget: EventTarget | null = null;

function isMobile(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function applyMainSlide(): void {
  if (!panelsEl) return;
  const aiEnabled = isAiEnabled();
  panelsEl.classList.toggle('mobile-ai-disabled', !aiEnabled);
  panelsEl.classList.remove('mobile-slide-0', 'mobile-slide-1', 'mobile-slide-2');
  panelsEl.classList.add(`mobile-slide-${mainSlideIndex}`);
}

function getVisibleTaskSlideIndices(): number[] {
  const raw = taskListSectionsEl?.getAttribute('data-visible-task-slides') ?? '';
  if (!raw) return [0, 1];
  const indices = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n) && n >= 0 && n <= 1);
  return indices.length > 0 ? indices : [0, 1];
}

function applyTaskSlide(): void {
  if (!taskListSectionsEl) return;
  const visibleIndices = getVisibleTaskSlideIndices();
  const maxSlide = Math.max(0, visibleIndices.length - 1);
  const clamped = Math.max(0, Math.min(maxSlide, taskSlideIndex));
  if (clamped !== taskSlideIndex) taskSlideIndex = clamped;

  taskListSectionsEl.classList.remove('mobile-task-slide-0', 'mobile-task-slide-1', 'mobile-task-slide-2');
  taskListSectionsEl.classList.remove('task-slides-1', 'task-slides-2', 'task-slides-3');
  const n = visibleIndices.length;
  if (n >= 1) {
    taskListSectionsEl.classList.add(`task-slides-${Math.min(n, 2)}`);
  }
  taskListSectionsEl.classList.add(`mobile-task-slide-${clamped}`);
  taskListSectionsEl.style.transform = '';

  mobileNavEl?.querySelectorAll('button[data-task-slide]').forEach((btn) => {
    const slide = parseInt((btn as HTMLElement).dataset.taskSlide ?? '0', 10);
    const active = visibleIndices[taskSlideIndex] === slide;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

function setMainSlide(index: number): void {
  const maxIndex = isAiEnabled() ? 2 : 1;
  const next = Math.max(0, Math.min(maxIndex, index));
  if (next === mainSlideIndex) return;
  mainSlideIndex = next;
  applyMainSlide();
  if (mainSlideIndex === 0) showCompletedPanelAndLoad();
}

function setTaskSlide(index: number): void {
  const visibleIndices = getVisibleTaskSlideIndices();
  const maxSlide = Math.max(0, visibleIndices.length - 1);
  taskSlideIndex = Math.max(0, Math.min(maxSlide, index));
  applyTaskSlide();
}

/** Current task section index (0=Unassigned, 1=Pending). Used when dropping from schedule on mobile. */
export function getTaskSlideIndex(): number {
  const visible = getVisibleTaskSlideIndices();
  return visible[taskSlideIndex] ?? 0;
}

export function isMobileView(): boolean {
  return isMobile();
}

function setupSwipePanels(): void {
  if (!panelsEl) return;
  let isHorizontalSwipe: boolean | null = null;
  panelsEl.addEventListener(
    'touchstart',
    (e) => {
      if (!isMobile() || e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTarget = e.target;
      isHorizontalSwipe = null;
    },
    { passive: true }
  );
  panelsEl.addEventListener(
    'touchmove',
    (e) => {
      if (!isMobile() || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (isHorizontalSwipe === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        isHorizontalSwipe = Math.abs(dx) > Math.abs(dy);
      }
      if (isHorizontalSwipe === true) e.preventDefault();
    },
    { passive: false }
  );
  panelsEl.addEventListener(
    'touchend',
    (e) => {
      if (!isMobile() || e.changedTouches.length !== 1) return;
      if (touchStartTarget && taskListSectionsEl?.contains(touchStartTarget as Node)) return;
      const leftTop = document.querySelector('.panel-slide-tasks .left-top');
      if (touchStartTarget && leftTop?.contains(touchStartTarget as Node)) return;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - touchStartX;
      const dy = endY - touchStartY;
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
      if (dx > 0) setMainSlide(mainSlideIndex - 1);
      else setMainSlide(mainSlideIndex + 1);
    },
    { passive: true }
  );
}

function setupSwipeTaskSections(): void {
  if (!taskListSectionsEl) return;
  let startX = 0;
  let startY = 0;
  let isHorizontal: boolean | null = null;
  taskListSectionsEl.addEventListener(
    'touchstart',
    (e) => {
      if (!isMobile() || e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isHorizontal = null;
    },
    { passive: true }
  );
  taskListSectionsEl.addEventListener(
    'touchmove',
    (e) => {
      if (!isMobile() || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (isHorizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        isHorizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (isHorizontal === true) e.preventDefault();
    },
    { passive: false }
  );
  taskListSectionsEl.addEventListener(
    'touchend',
    (e) => {
      if (!isMobile() || e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      const visibleIndices = getVisibleTaskSlideIndices();
      const maxSlide = Math.max(0, visibleIndices.length - 1);
      if (dx > 0) {
        if (taskSlideIndex > 0) setTaskSlide(taskSlideIndex - 1);
        else setMainSlide(mainSlideIndex - 1);
      } else {
        if (taskSlideIndex < maxSlide) setTaskSlide(taskSlideIndex + 1);
        else setMainSlide(mainSlideIndex + 1);
      }
    },
    { passive: true }
  );
}

function setupSwipeSchedule(): void {
  const scheduleEl = document.querySelector('.panel-slide-tasks .left-bottom');
  if (!scheduleEl || !isMobile()) return;
  let startX = 0;
  let startY = 0;
  let isHorizontal: boolean | null = null;
  scheduleEl.addEventListener(
    'touchstart',
    (e) => {
      const te = e as TouchEvent;
      if (!isMobile() || te.touches.length !== 1) return;
      startX = te.touches[0].clientX;
      startY = te.touches[0].clientY;
      isHorizontal = null;
    },
    { passive: true }
  );
  scheduleEl.addEventListener(
    'touchmove',
    (e) => {
      const te = e as TouchEvent;
      if (!isMobile() || te.touches.length !== 1) return;
      const dx = te.touches[0].clientX - startX;
      const dy = te.touches[0].clientY - startY;
      if (isHorizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        isHorizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (isHorizontal === true) e.preventDefault();
    },
    { passive: false }
  );
  scheduleEl.addEventListener(
    'touchend',
    (e) => {
      const te = e as TouchEvent;
      if (!isMobile() || te.changedTouches.length !== 1) return;
      const dx = te.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      if (dx < 0) window.dispatchEvent(new Event('daytracker-schedule-swipe-prev'));
      else window.dispatchEvent(new Event('daytracker-schedule-swipe-next'));
    },
    { passive: true }
  );
}

function setupMobileNavButtons(): void {
  mobileNavEl?.querySelectorAll('button[data-task-slide]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sectionIndex = parseInt((btn as HTMLElement).dataset.taskSlide ?? '0', 10);
      const visibleIndices = getVisibleTaskSlideIndices();
      const slideIndex = visibleIndices.indexOf(sectionIndex);
      if (slideIndex >= 0) setTaskSlide(slideIndex);
    });
  });
}

function onResize(): void {
  if (isMobile()) {
    applyMainSlide();
    applyTaskSlide();
    if (mobileNavEl) mobileNavEl.setAttribute('aria-hidden', 'false');
  } else {
    panelsEl?.classList.remove('mobile-slide-0', 'mobile-slide-1', 'mobile-slide-2', 'mobile-ai-disabled');
    taskListSectionsEl?.classList.remove(
      'mobile-task-slide-0',
      'mobile-task-slide-1',
      'mobile-task-slide-2',
      'task-slides-1',
      'task-slides-2',
      'task-slides-3'
    );
    if (mobileNavEl) mobileNavEl.setAttribute('aria-hidden', 'true');
  }
}

export function initMobile(): void {
  setupSwipePanels();
  setupSwipeTaskSections();
  setupSwipeSchedule();
  setupMobileNavButtons();
  window.addEventListener('resize', onResize);
  window.addEventListener('daytracker-task-sections-visibility-changed', () => applyTaskSlide());
  if (isMobile()) {
    applyMainSlide();
    applyTaskSlide();
    if (mobileNavEl) mobileNavEl.setAttribute('aria-hidden', 'false');
  }
}
