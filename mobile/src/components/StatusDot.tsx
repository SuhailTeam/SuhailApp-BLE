import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import type { ListeningState } from "../state/listening";

interface StatusDotProps {
  state: ListeningState;
  size?: number;
}

/**
 * Listening indicator. State is conveyed by SHAPE (hollow / solid / dot-in-ring)
 * as well as colour, so it never relies on colour alone. Decorative — hidden
 * from the a11y tree because the adjacent text label carries the state.
 */
export function StatusDot({ state, size = 18 }: StatusDotProps): React.ReactElement {
  const theme = useTheme();
  const { name, color } = glyphFor(state, theme.colors);
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

function glyphFor(
  state: ListeningState,
  c: { textMuted: string; accent: string; warningText: string },
): { name: keyof typeof Ionicons.glyphMap; color: string } {
  switch (state) {
    case "active":
      return { name: "ellipse", color: c.accent }; // solid
    case "processing":
      return { name: "radio-button-on", color: c.warningText }; // dot-in-ring
    case "idle":
    default:
      return { name: "ellipse-outline", color: c.textMuted }; // hollow
  }
}
