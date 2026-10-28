import { useCallback } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { TERMINAL_THEMES, type TerminalTheme } from "@t3tools/shared/terminalThemes";

import { AppText as Text } from "../../../../components/AppText";
import { cn } from "../../../../lib/cn";
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STEP,
} from "../../../../lib/appearancePreferences";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import {
  AppearancePreviewSeparator,
  TerminalAppearancePreview,
} from "../components/AppearancePreviews";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";

export function TerminalAppearanceSection() {
  const {
    isReady,
    appearance,
    setTerminalFontSize,
    setTerminalThemeId,
    terminalThemeId,
    themeAppearance,
  } = useAppearancePreferences();
  const selectedThemeId = TERMINAL_THEMES.some((theme) => theme.id === terminalThemeId)
    ? terminalThemeId
    : "";
  const custom = appearance.isTerminalFontSizeCustom;
  // The app's own appearance leads, with Default (the app theme's colors) first.
  const groupOrder =
    themeAppearance === "dark" ? (["dark", "light"] as const) : (["light", "dark"] as const);

  const handleToggleCustom = useCallback(
    (enabled: boolean) => {
      setTerminalFontSize(enabled ? appearance.terminalFontSize : null);
    },
    [appearance.terminalFontSize, setTerminalFontSize],
  );

  return (
    <SettingsSection title="Terminal">
      <View className="gap-3 py-3">
        {groupOrder.map((group, index) => (
          <View className="gap-1" key={group}>
            <Text className="px-4 text-xs font-t3-medium uppercase text-foreground-muted">
              {group === "light" ? "Light" : "Dark"}
            </Text>
            <ScrollView
              contentContainerClassName="gap-2 px-4 pb-1"
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {index === 0 ? (
                <TerminalThemeChip
                  disabled={!isReady}
                  label="Default"
                  onPress={() => setTerminalThemeId("")}
                  selected={selectedThemeId === ""}
                />
              ) : null}
              {TERMINAL_THEMES.filter((theme) => theme.appearance === group).map((theme) => (
                <TerminalThemeChip
                  disabled={!isReady}
                  key={theme.id}
                  label={theme.name}
                  onPress={() => setTerminalThemeId(theme.id)}
                  theme={theme}
                  selected={selectedThemeId === theme.id}
                />
              ))}
            </ScrollView>
          </View>
        ))}
      </View>
      <TerminalAppearancePreview fontSize={appearance.terminalFontSize} />
      <AppearancePreviewSeparator />
      <SettingsSwitchRow
        disabled={!isReady}
        icon="terminal"
        label="Custom font size"
        onValueChange={handleToggleCustom}
        value={custom}
      />
      {custom ? (
        <FontSizeSliderRow
          disabled={!isReady}
          icon="textformat.size"
          label="Font size"
          max={MAX_TERMINAL_FONT_SIZE}
          min={MIN_TERMINAL_FONT_SIZE}
          onChange={setTerminalFontSize}
          step={TERMINAL_FONT_SIZE_STEP}
          value={appearance.terminalFontSize}
          valueLabel={`${appearance.terminalFontSize.toFixed(1)} pt`}
        />
      ) : null}
    </SettingsSection>
  );
}

/** A theme name over its background, with red, green, yellow, and blue dots. */
function TerminalThemeChip(props: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly theme?: TerminalTheme;
  readonly selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`${props.label} terminal colors`}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      className={cn(
        "gap-1.5 rounded-xl border-2 px-3 py-2 active:opacity-70",
        props.selected ? "border-primary" : "border-border",
        !props.theme && "bg-grouped-card",
      )}
      disabled={props.disabled}
      onPress={props.onPress}
      style={props.theme ? { backgroundColor: props.theme.background } : undefined}
    >
      <Text
        className={cn("text-sm font-t3-medium", !props.theme && "text-foreground")}
        numberOfLines={1}
        style={props.theme ? { color: props.theme.foreground } : undefined}
      >
        {props.label}
      </Text>
      <View className="h-2 flex-row gap-1">
        {props.theme
          ? [1, 2, 3, 4].map((index) => (
              <View
                className="size-2 rounded-full"
                key={index}
                style={{ backgroundColor: props.theme?.palette[index] }}
              />
            ))
          : null}
      </View>
    </Pressable>
  );
}
