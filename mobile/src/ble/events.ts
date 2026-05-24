import { useBluetoothEvent } from "@mentra/bluetooth-sdk/react";
import type {
  BatteryStatusEvent,
  ButtonPressEvent,
  PhotoResponseEvent,
  TouchEvent,
} from "@mentra/bluetooth-sdk";

/**
 * Convenience re-exports of the BLE SDK's useBluetoothEvent for the events
 * Suhail cares about. Each hook subscribes to one event for the lifetime of
 * the calling component. Pass `enabled: false` to pause.
 *
 * Event semantics (mirrors cloud app's listening state machine):
 *  - forward_swipe → activate listening (or interrupt + re-listen if processing)
 *  - backward_swipe → repeat last response
 *  - left short press → interrupt + re-listen
 *  - left long press → repeat last response
 *  - right/camera button → reserved for native gallery (do not handle)
 */

export type ButtonHandler = (event: ButtonPressEvent) => void;
export type TouchHandler = (event: TouchEvent) => void;
export type BatteryHandler = (event: BatteryStatusEvent) => void;
export type PhotoHandler = (event: PhotoResponseEvent) => void;

export function useButtonPress(handler: ButtonHandler, enabled = true): void {
  useBluetoothEvent("button_press", handler, { enabled });
}

export function useTouchEvent(handler: TouchHandler, enabled = true): void {
  useBluetoothEvent("touch_event", handler, { enabled });
}

export function useBatteryStatus(handler: BatteryHandler, enabled = true): void {
  useBluetoothEvent("battery_status", handler, { enabled });
}

export function usePhotoResponse(handler: PhotoHandler, enabled = true): void {
  useBluetoothEvent("photo_response", handler, { enabled });
}
