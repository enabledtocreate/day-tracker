/** Occupied schedule block rect (pixels + %), used to place add-task ghost in gaps. */
export type ScheduleOccupiedRect = {
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
};

export type AddTaskGhostPlacement = {
  slotIndex: number;
  topPx: number;
  leftPct: number;
  widthPct: number;
};

/** Pixels from the left edge of `.time-view-blocks` where add-task ghost always shows (block-strip boundary). */
export const SCHEDULE_ADD_TASK_BOUNDARY_ZONE_PX = 5;

export function computeAddTaskGhostPlacement(params: {
  relativeX: number;
  relativeY: number;
  containerWidthPx: number;
  rowHeightPx: number;
  slotCount: number;
  occupied: ScheduleOccupiedRect[];
}): AddTaskGhostPlacement | null {
  const { relativeX, relativeY, containerWidthPx, rowHeightPx, slotCount, occupied } = params;
  if (containerWidthPx <= 0 || rowHeightPx <= 0 || relativeY < 0) return null;

  const slotIndex = Math.floor(relativeY / rowHeightPx);
  if (slotIndex < 0 || slotIndex >= slotCount) return null;

  const slotTop = slotIndex * rowHeightPx;
  const slotBottom = slotTop + rowHeightPx;
  const boundaryZone = relativeX >= 0 && relativeX <= SCHEDULE_ADD_TASK_BOUNDARY_ZONE_PX;

  const rowRects = occupied
    .filter((r) => {
      const rBottom = r.topPx + r.heightPx;
      return rBottom > slotTop && r.topPx < slotBottom;
    })
    .map((r) => ({
      left: (r.leftPct / 100) * containerWidthPx,
      right: ((r.leftPct + r.widthPct) / 100) * containerWidthPx,
    }))
    .sort((a, b) => a.left - b.left);

  if (!boundaryZone) {
    for (const r of occupied) {
      const rBottom = r.topPx + r.heightPx;
      if (rBottom <= slotTop || r.topPx >= slotBottom) continue;
      const leftPx = (r.leftPct / 100) * containerWidthPx;
      const widthPx = (r.widthPct / 100) * containerWidthPx;
      if (relativeX >= leftPx && relativeX < leftPx + widthPx) return null;
    }
  }

  const minGhostWidthPx = Math.min(28, containerWidthPx * 0.18);

  const placeInGap = (gapLeft: number, gapRight: number): AddTaskGhostPlacement | null => {
    const gapW = gapRight - gapLeft;
    if (gapW < minGhostWidthPx) return null;
    const leftPct = (gapLeft / containerWidthPx) * 100;
    const widthPct = (gapW / containerWidthPx) * 100 - 0.5;
    return { slotIndex, topPx: slotTop, leftPct: Math.max(0, leftPct), widthPct: Math.max(8, widthPct) };
  };

  if (boundaryZone || rowRects.length === 0) {
    if (rowRects.length === 0) {
      return { slotIndex, topPx: slotTop, leftPct: 2, widthPct: 96 };
    }
    const first = rowRects[0]!;
    if (boundaryZone || relativeX < first.left) {
      const placed = placeInGap(0, first.left);
      if (placed) return placed;
    }
    let cursor = 0;
    for (const rect of rowRects) {
      if (relativeX >= cursor && relativeX < rect.left) {
        const p = placeInGap(cursor, rect.left);
        if (p) return p;
      }
      cursor = Math.max(cursor, rect.right);
    }
    const tail = placeInGap(cursor, containerWidthPx);
    if (tail) return tail;
    const last = rowRects[rowRects.length - 1]!;
    return placeInGap(last.right, containerWidthPx) ?? placeInGap(0, first.left);
  }

  let cursor = 0;
  for (const rect of rowRects) {
    if (relativeX >= cursor && relativeX < rect.left) {
      return placeInGap(cursor, rect.left);
    }
    cursor = Math.max(cursor, rect.right);
  }
  if (relativeX >= cursor) {
    return placeInGap(cursor, containerWidthPx);
  }
  return null;
}

export function buildScheduleOccupiedRects(
  blocks: Array<{ topPx: number; heightPx: number; leftPct: number; widthPct: number }>
): ScheduleOccupiedRect[] {
  return blocks.map((b) => ({
    topPx: b.topPx,
    heightPx: b.heightPx,
    leftPct: b.leftPct,
    widthPct: b.widthPct,
  }));
}
