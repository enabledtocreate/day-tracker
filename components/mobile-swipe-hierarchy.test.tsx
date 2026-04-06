import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeTouchEvent = (
  type: 'touchstart' | 'touchend',
  clientX: number,
  clientY: number
): Event => {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches?: Array<{ clientX: number; clientY: number }>;
    changedTouches?: Array<{ clientX: number; clientY: number }>;
  };

  if (type === 'touchstart') {
    ev.touches = [{ clientX, clientY }];
  } else {
    ev.changedTouches = [{ clientX, clientY }];
  }
  return ev;
};

describe('mobile swipe hierarchy', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="main-panels" class="panels mobile-slide-1"></div>
      <div id="task-list-sections-mobile-nav">
        <button data-task-slide="0"></button>
        <button data-task-slide="1"></button>
      </div>
      <div id="task-list-sections" data-visible-task-slides="0,1"></div>
    `;

    // Force mobile breakpoint behavior.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(max-width: 768px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  it('updates task slide on swipe and advances main panels at end', async () => {
    const mobileMod = await import('../src/mobile');
    mobileMod.initMobile();

    const panelsEl = document.getElementById('main-panels')!;
    const taskListSectionsEl = document.getElementById('task-list-sections')!;

    expect(panelsEl.classList.contains('mobile-slide-1')).toBe(true);
    expect(taskListSectionsEl.classList.contains('mobile-task-slide-0')).toBe(true);

    // Swipe left inside task list sections: dx negative => next task slide (0 -> 1)
    taskListSectionsEl.dispatchEvent(makeTouchEvent('touchstart', 180, 10));
    taskListSectionsEl.dispatchEvent(makeTouchEvent('touchend', 30, 10));
    expect(taskListSectionsEl.classList.contains('mobile-task-slide-1')).toBe(true);

    // Task nav: jump back to Unassigned then to Pending.
    const navBtns = document.querySelectorAll('#task-list-sections-mobile-nav button[data-task-slide]');
    (navBtns[0] as HTMLElement).dispatchEvent(new Event('click', { bubbles: true }));
    expect(taskListSectionsEl.classList.contains('mobile-task-slide-0')).toBe(true);
    (navBtns[1] as HTMLElement).dispatchEvent(new Event('click', { bubbles: true }));
    expect(taskListSectionsEl.classList.contains('mobile-task-slide-1')).toBe(true);

    // Swipe left again at the end: should advance main slide (1 -> 2).
    taskListSectionsEl.dispatchEvent(makeTouchEvent('touchstart', 180, 10));
    taskListSectionsEl.dispatchEvent(makeTouchEvent('touchend', 30, 10));
    expect(panelsEl.classList.contains('mobile-slide-2')).toBe(true);
  });
});

