import type { IcalFeedEvent, ScheduledSlot } from '@/lib/api';
import { icalEventLocalStartDate, icalEventToLocal } from '@/lib/icalTimezone';
import { SCHEDULE_SLOT_ROW_HEIGHT_PX } from '@/lib/scheduleSlotMetrics';
import type { ScheduleOccupiedRect } from '@/lib/scheduleAddTaskGhost';
import { collectScheduleDaySegments } from '@/lib/overnightSlotTimes';
import { timedSlotLayoutBounds } from '@/lib/timedSlotLayout';

function slotHasTime(slot: ScheduledSlot): boolean {
  return !!(slot.start_time && slot.end_time);
}

export type OverlapBlock = { key: number | string; startMin: number; endMin: number };

export type OverlapLayoutInfo = {
  col: number;
  total: number;
  leftPct: number;
  widthPct: number;
  zIndex: number;
  /** True when this block starts after an overlapping peer (drawn on top, indented). */
  stacked: boolean;
};

const OVERLAP_WIDTH_GAP = 0.5;

function blocksOverlap(a: OverlapBlock, b: OverlapBlock): boolean {
  return a.startMin < b.endMin && a.endMin > b.startMin;
}

/** Connected components: events that overlap directly or transitively share a cluster. */
function clusterOverlapBlocks(blocks: OverlapBlock[]): OverlapBlock[][] {
  const clusters: OverlapBlock[][] = [];
  const visited = new Set<number | string>();

  for (const seed of blocks) {
    if (visited.has(seed.key)) continue;
    const cluster: OverlapBlock[] = [];
    const stack = [seed];
    visited.add(seed.key);
    while (stack.length) {
      const cur = stack.pop()!;
      cluster.push(cur);
      for (const other of blocks) {
        if (visited.has(other.key)) continue;
        if (blocksOverlap(cur, other)) {
          visited.add(other.key);
          stack.push(other);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/**
 * Assign calendar-style overlap columns: each event gets the leftmost lane that
 * does not conflict with another event already in that lane. Non-overlapping
 * events share a column (e.g. 5:45–7:15 and 7:45–8:45 both use column 0 when
 * only 6:45–8:45 needs column 1). `total` is the lane count for the cluster.
 */
export function computeOverlapMaps(
  blocks: OverlapBlock[]
): Map<number | string, { col: number; total: number }> {
  const info = new Map<number | string, { col: number; total: number }>();
  if (blocks.length === 0) return info;

  for (const cluster of clusterOverlapBlocks(blocks)) {
    const sorted = [...cluster].sort((a, b) => {
      if (a.startMin !== b.startMin) return a.startMin - b.startMin;
      return b.endMin - b.startMin - (a.endMin - a.startMin);
    });
    const lanes: OverlapBlock[][] = [];
    const colByKey = new Map<number | string, number>();

    for (const block of sorted) {
      let col = 0;
      while (true) {
        const lane = lanes[col] ?? [];
        const conflict = lane.some((o) => blocksOverlap(o, block));
        if (!conflict) break;
        col++;
      }
      if (!lanes[col]) lanes[col] = [];
      lanes[col].push(block);
      colByKey.set(block.key, col);
    }

    const total = Math.max(1, lanes.length);
    for (const block of cluster) {
      info.set(block.key, { col: colByKey.get(block.key) ?? 0, total });
    }
  }

  // Defensive: any block missed by clustering still gets a lane.
  for (const block of blocks) {
    if (!info.has(block.key)) {
      info.set(block.key, { col: 0, total: 1 });
    }
  }
  return info;
}

/**
 * Layout overlapping blocks Google Calendar–style:
 * - Same start time → equal columns side-by-side.
 * - Different start times → earlier block full width; later blocks indented on top.
 */
export function computeOverlapLayouts(
  blocks: OverlapBlock[]
): Map<number | string, OverlapLayoutInfo> {
  const colMap = computeOverlapMaps(blocks);
  const layouts = new Map<number | string, OverlapLayoutInfo>();
  if (blocks.length === 0) return layouts;

  for (const cluster of clusterOverlapBlocks(blocks)) {
    for (const block of cluster) {
      const { col, total } = colMap.get(block.key) ?? { col: 0, total: 1 };
      const overlapping = cluster.filter((o) => blocksOverlap(o, block));
      const sameStartPeers = overlapping.filter((o) => o.startMin === block.startMin);

      if (sameStartPeers.length > 1) {
        const sortedPeers = [...sameStartPeers].sort(
          (a, b) => (colMap.get(a.key)?.col ?? 0) - (colMap.get(b.key)?.col ?? 0)
        );
        const localCol = Math.max(0, sortedPeers.findIndex((p) => p.key === block.key));
        const n = sameStartPeers.length;
        const slice = 100 / n;
        layouts.set(block.key, {
          col,
          total,
          leftPct: localCol * slice,
          widthPct: slice - OVERLAP_WIDTH_GAP,
          zIndex: localCol + 1,
          stacked: false,
        });
        continue;
      }

      const hasEarlierOverlap = overlapping.some((o) => o.startMin < block.startMin);
      if (!hasEarlierOverlap) {
        layouts.set(block.key, {
          col,
          total,
          leftPct: 0,
          widthPct: 100 - OVERLAP_WIDTH_GAP,
          zIndex: col + 1,
          stacked: false,
        });
      } else {
        const leftPct = col * (100 / (total + 1));
        layouts.set(block.key, {
          col,
          total,
          leftPct,
          widthPct: 100 - leftPct - OVERLAP_WIDTH_GAP,
          zIndex: col + 1,
          stacked: true,
        });
      }
    }
  }

  for (const block of blocks) {
    if (!layouts.has(block.key)) {
      layouts.set(block.key, {
        col: 0,
        total: 1,
        leftPct: 0,
        widthPct: 100 - OVERLAP_WIDTH_GAP,
        zIndex: 1,
        stacked: false,
      });
    }
  }
  return layouts;
}

export function buildDayScheduleOccupiedRects(params: {
  slots: ScheduledSlot[];
  allSlots?: ScheduledSlot[];
  slotDayByRecordId?: Record<number, string>;
  feedEvents: IcalFeedEvent[];
  columnDate: string;
  timezone: string;
  viewStartMinutes: number;
  viewEndMinutes?: number;
  slotDurationMinutes: number;
  rowHeightPx?: number;
}): ScheduleOccupiedRect[] {
  const {
    slots,
    allSlots,
    slotDayByRecordId,
    feedEvents,
    columnDate,
    timezone,
    viewStartMinutes,
    viewEndMinutes,
    slotDurationMinutes,
    rowHeightPx = SCHEDULE_SLOT_ROW_HEIGHT_PX,
  } = params;

  const viewEnd = viewEndMinutes ?? viewStartMinutes + 24 * 60;

  const rootSlots = slots.filter((s) => !s.parent_id || !slots.some((o) => o.task_id === s.parent_id));
  const childByParent = new Map<number, ScheduledSlot[]>();
  rootSlots.forEach((s) => {
    const ch = slots.filter((c) => c.parent_id === s.task_id);
    if (ch.length) childByParent.set(s.task_id, ch);
  });

  const segmentBlocks =
    allSlots && slotDayByRecordId
      ? collectScheduleDaySegments({
          allSlots,
          slotDayByRecordId,
          viewDate: columnDate,
          viewStartMinutes,
          viewEndMinutes: viewEnd,
        }).map((seg) => ({
          key: seg.overlapKey,
          startMin: seg.startMin,
          endMin: seg.endMin,
        }))
      : [];

  const groupBlocks = rootSlots
    .filter(slotHasTime)
    .filter((slot) => (childByParent.get(slot.task_id) ?? []).length > 0)
    .map((slot) => {
      const ch = childByParent.get(slot.task_id) ?? [];
      const { startMin, endMin } = timedSlotLayoutBounds(slot, ch);
      return { key: slot.id, startMin, endMin };
    });

  const taskBlocks = segmentBlocks.length > 0 ? segmentBlocks : rootSlots.filter(slotHasTime).map((slot) => {
    const ch = childByParent.get(slot.task_id) ?? [];
    const { startMin, endMin } = timedSlotLayoutBounds(slot, ch);
    return { key: slot.id, startMin, endMin };
  }).concat([]);

  const taskBlocksFinal = segmentBlocks.length > 0 ? [...segmentBlocks, ...groupBlocks] : taskBlocks;

  const feedBlocks = feedEvents
    .filter((e) => !e.allDay && icalEventLocalStartDate(e.start, false, timezone) === columnDate)
    .map((e) => {
      const local = icalEventToLocal(e.start, e.end, false, timezone);
      return {
        key: 'feed-' + (e.id ?? e.uid + e.start),
        startMin: local.localStartMinutes,
        endMin: local.localEndMinutes,
      };
    });

  const all = [...taskBlocksFinal, ...feedBlocks];
  const overlap = computeOverlapLayouts(all);
  const rects: ScheduleOccupiedRect[] = [];

  taskBlocksFinal.forEach((b) => {
    const top = ((b.startMin - viewStartMinutes) / slotDurationMinutes) * rowHeightPx;
    const height = Math.max(rowHeightPx, ((b.endMin - b.startMin) / slotDurationMinutes) * rowHeightPx);
    const ov = overlap.get(b.key) ?? { leftPct: 0, widthPct: 99.5 };
    rects.push({ topPx: top, heightPx: height, leftPct: ov.leftPct, widthPct: ov.widthPct });
  });

  feedBlocks.forEach((b) => {
    const top = ((b.startMin - viewStartMinutes) / slotDurationMinutes) * rowHeightPx;
    const height = Math.max(rowHeightPx, ((b.endMin - b.startMin) / slotDurationMinutes) * rowHeightPx);
    const ov = overlap.get(b.key) ?? { leftPct: 0, widthPct: 99.5 };
    rects.push({ topPx: top, heightPx: height, leftPct: ov.leftPct, widthPct: ov.widthPct });
  });

  return rects;
}
