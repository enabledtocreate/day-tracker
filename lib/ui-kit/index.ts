/**
 * UI kit facade: primitive components used across feature modules.
 * Switch implementation with env `NEXT_PUBLIC_UI_KIT` = `default` | `shadcn` (build-time).
 */
import * as defaultKit from './kits/default';
import * as shadcnKit from './kits/shadcn';
import type { UiKitId } from './types';

export type { UiButtonProps, UiButtonVariant, UiKitId, UiModalProps } from './types';

function activeKitId(): UiKitId {
  return process.env.NEXT_PUBLIC_UI_KIT === 'shadcn' ? 'shadcn' : 'default';
}

const kit = activeKitId() === 'shadcn' ? shadcnKit : defaultKit;

export const Button = kit.Button;
export const Modal = kit.Modal;

export function getUiKitId(): UiKitId {
  return activeKitId();
}
