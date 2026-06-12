'use client';

/**
 * Mobile mode state machine + React context.
 *
 * Single source of truth for "what is the user doing right now on mobile?".
 * Every mobile gesture handler should read `useMobileMode()` and dispatch via the
 * returned `actions` rather than holding its own boolean state.
 *
 * Modes are based on `.apm/_WORKSPACE/TODO-mobile.md §0.2 / §0.3 / §0.4`:
 *   - normal      : nothing special
 *   - move        : Long Press armed; user is moving / grouping a task
 *   - resize      : edge tap armed; user is resizing a scheduled task or block
 *   - edit        : inline title edit in progress
 *   - bulkSelect  : multi-select toolbar visible
 *
 * Modal suppression is tracked separately as a refcount so any number of
 * concurrent modals/drawers can register themselves; gestures should suppress
 * while `modalOpenCount > 0`.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import * as React from 'react';

export type MoveSource = 'list' | 'schedule';

export type MoveModeState = {
  kind: 'move';
  /** The task that initiated Move mode (cannot be ungrouped from itself). */
  originatingTaskId: number;
  /** Where the Long Press originated. Affects available drop targets. */
  source: MoveSource;
  /** Other tasks that have been added to the group via Double Tap. */
  groupMemberIds: number[];
  /** Set to true once any displacement has happened; used to gate exits. */
  hasMoved: boolean;
};

export type ResizeEdge = 'top' | 'bottom';
export type ResizeTargetKind = 'task' | 'block';

export type ResizeModeState = {
  kind: 'resize';
  targetKind: ResizeTargetKind;
  targetId: number;
  edge: ResizeEdge;
};

export type EditModeState = {
  kind: 'edit';
  taskId: number;
};

export type NormalModeState = { kind: 'normal' };
export type BulkSelectModeState = { kind: 'bulkSelect' };

export type MobileMode =
  | NormalModeState
  | MoveModeState
  | ResizeModeState
  | EditModeState
  | BulkSelectModeState;

export type MobileModeKind = MobileMode['kind'];

// ---------- Reducer ---------------------------------------------------------

type Action =
  | { type: 'enterMove'; taskId: number; source: MoveSource }
  | { type: 'exitMove' }
  | { type: 'addMoveGroupMember'; taskId: number }
  | { type: 'removeMoveGroupMember'; taskId: number }
  | { type: 'markMoveHasMoved' }
  | { type: 'enterResize'; targetKind: ResizeTargetKind; targetId: number; edge: ResizeEdge }
  | { type: 'exitResize' }
  | { type: 'enterEdit'; taskId: number }
  | { type: 'exitEdit' }
  | { type: 'enterBulkSelect' }
  | { type: 'exitBulkSelect' }
  | { type: 'resetToNormal' };

const NORMAL: NormalModeState = { kind: 'normal' };

function reducer(state: MobileMode, action: Action): MobileMode {
  switch (action.type) {
    case 'enterMove':
      return {
        kind: 'move',
        originatingTaskId: action.taskId,
        source: action.source,
        groupMemberIds: [],
        hasMoved: false,
      };
    case 'exitMove':
      return state.kind === 'move' ? NORMAL : state;
    case 'addMoveGroupMember':
      if (state.kind !== 'move') return state;
      if (action.taskId === state.originatingTaskId) return state;
      if (state.groupMemberIds.includes(action.taskId)) return state;
      return { ...state, groupMemberIds: [...state.groupMemberIds, action.taskId] };
    case 'removeMoveGroupMember':
      if (state.kind !== 'move') return state;
      if (action.taskId === state.originatingTaskId) return state;
      return {
        ...state,
        groupMemberIds: state.groupMemberIds.filter((id) => id !== action.taskId),
      };
    case 'markMoveHasMoved':
      if (state.kind !== 'move' || state.hasMoved) return state;
      return { ...state, hasMoved: true };
    case 'enterResize':
      return {
        kind: 'resize',
        targetKind: action.targetKind,
        targetId: action.targetId,
        edge: action.edge,
      };
    case 'exitResize':
      return state.kind === 'resize' ? NORMAL : state;
    case 'enterEdit':
      return { kind: 'edit', taskId: action.taskId };
    case 'exitEdit':
      return state.kind === 'edit' ? NORMAL : state;
    case 'enterBulkSelect':
      return { kind: 'bulkSelect' };
    case 'exitBulkSelect':
      return state.kind === 'bulkSelect' ? NORMAL : state;
    case 'resetToNormal':
      return NORMAL;
    default:
      return state;
  }
}

// ---------- Actions exposed by the context ----------------------------------

export type MobileModeActions = {
  enterMove(taskId: number, source: MoveSource): void;
  exitMove(): void;
  addMoveGroupMember(taskId: number): void;
  removeMoveGroupMember(taskId: number): void;
  markMoveHasMoved(): void;
  enterResize(targetKind: ResizeTargetKind, targetId: number, edge: ResizeEdge): void;
  exitResize(): void;
  enterEdit(taskId: number): void;
  exitEdit(): void;
  enterBulkSelect(): void;
  exitBulkSelect(): void;
  resetToNormal(): void;
  /** Register a modal/drawer; returns a release fn to call on unmount. */
  pushModal(): () => void;
};

export type MobileModeContextValue = {
  mode: MobileMode;
  modalOpenCount: number;
  /** True if any modal/drawer is registered. Gesture handlers MUST short-circuit when true. */
  isGestureSuppressed: boolean;
  actions: MobileModeActions;
};

const MobileModeContext = createContext<MobileModeContextValue | null>(null);

export type MobileModeProviderProps = {
  children: ReactNode;
};

export function MobileModeProvider({ children }: MobileModeProviderProps) {
  const [mode, dispatch] = useReducer(reducer, NORMAL);
  const modalCountRef = useRef(0);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const actions = useMemo<MobileModeActions>(
    () => ({
      enterMove: (taskId, source) => dispatch({ type: 'enterMove', taskId, source }),
      exitMove: () => dispatch({ type: 'exitMove' }),
      addMoveGroupMember: (taskId) => dispatch({ type: 'addMoveGroupMember', taskId }),
      removeMoveGroupMember: (taskId) => dispatch({ type: 'removeMoveGroupMember', taskId }),
      markMoveHasMoved: () => dispatch({ type: 'markMoveHasMoved' }),
      enterResize: (targetKind, targetId, edge) =>
        dispatch({ type: 'enterResize', targetKind, targetId, edge }),
      exitResize: () => dispatch({ type: 'exitResize' }),
      enterEdit: (taskId) => dispatch({ type: 'enterEdit', taskId }),
      exitEdit: () => dispatch({ type: 'exitEdit' }),
      enterBulkSelect: () => dispatch({ type: 'enterBulkSelect' }),
      exitBulkSelect: () => dispatch({ type: 'exitBulkSelect' }),
      resetToNormal: () => dispatch({ type: 'resetToNormal' }),
      pushModal: () => {
        modalCountRef.current += 1;
        forceUpdate();
        let released = false;
        return () => {
          if (released) return;
          released = true;
          modalCountRef.current = Math.max(0, modalCountRef.current - 1);
          forceUpdate();
        };
      },
    }),
    []
  );

  const value = useMemo<MobileModeContextValue>(
    () => ({
      mode,
      modalOpenCount: modalCountRef.current,
      isGestureSuppressed: modalCountRef.current > 0,
      actions,
    }),
    [mode, actions]
  );

  return React.createElement(MobileModeContext.Provider, { value }, children);
}

// ---------- Hooks ----------------------------------------------------------

export function useMobileMode(): MobileModeContextValue {
  const ctx = useContext(MobileModeContext);
  if (!ctx) {
    throw new Error(
      'useMobileMode must be used inside <MobileModeProvider>. ' +
        'Mount the provider near the root (AppPanels) before reading mode.'
    );
  }
  return ctx;
}

/** Returns the current mode kind only. Cheap stable read. */
export function useMobileModeKind(): MobileModeKind {
  return useMobileMode().mode.kind;
}

/**
 * Registers an open modal/drawer for as long as `open` is true.
 * While any consumer has called this with `open: true`, gestures are suppressed.
 *
 * Example:
 *   useModalGestureSuppression(isOpen);
 */
export function useModalGestureSuppression(open: boolean): void {
  const { actions } = useMobileMode();
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (open && !releaseRef.current) {
      releaseRef.current = actions.pushModal();
    } else if (!open && releaseRef.current) {
      releaseRef.current();
      releaseRef.current = null;
    }
  }, [open, actions]);

  useEffect(
    () => () => {
      if (releaseRef.current) {
        releaseRef.current();
        releaseRef.current = null;
      }
    },
    []
  );
}

/**
 * Imperative helper for code that needs to know whether to suppress a gesture
 * without subscribing to mode changes. Use sparingly — prefer `useMobileMode()`.
 */
export function useMobileModeRef(): React.MutableRefObject<MobileModeContextValue> {
  const value = useMobileMode();
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Test helper — never call from app code. */
export const __NORMAL_MODE_FOR_TESTS: NormalModeState = NORMAL;
export const __reducerForTests = reducer;
