// Bausteine aus src/renderer/src/components/ui.tsx als native Views.
import { Check, ChevronDown, X } from 'lucide-react-native'
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch as RNSwitch,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native'
import Svg, { G, Rect } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { keyLabel, sortKeys } from '../../../src/shared/keys'
import { nativeAnimations, alpha, font, mono, speakerColor, useLayout, useTheme, type Palette } from './theme'

export type Icon = ComponentType<{ color?: string; size?: number; strokeWidth?: number; fill?: string }>

/** Text in Geist mit Farbe aus dem Theme. */
export function T({
  children,
  size = 14,
  weight = 400,
  color,
  style,
  lines,
  selectable,
  onPress,
  onLongPress,
  accessibilityRole
}: {
  accessibilityRole?: 'header' | 'text' | 'link'
  children?: ReactNode
  size?: number
  weight?: 400 | 500 | 600
  color?: string
  style?: StyleProp<TextStyle>
  lines?: number
  selectable?: boolean
  onPress?: () => void
  onLongPress?: () => void
}): ReactNode {
  const c = useTheme()
  return (
    <Text
      numberOfLines={lines}
      selectable={selectable}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={accessibilityRole}
      style={[font(weight), { fontSize: size, color: color ?? c.fg }, style]}
    >
      {children}
    </Text>
  )
}

// ------------------------------------------------------------ Knöpfe

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'subtle'

function variantColors(c: Palette, v: Variant): { bg: string; fg: string; border?: string } {
  switch (v) {
    case 'primary':
      return { bg: c.ink, fg: c.inkFg }
    case 'accent':
      return { bg: c.accent, fg: c.accentFg }
    case 'secondary':
      return { bg: c.panel, fg: c.fg, border: c.lineStrong }
    case 'ghost':
      return { bg: 'transparent', fg: c.fg2 }
    case 'subtle':
      return { bg: c.surface2, fg: c.fg }
    case 'danger':
      return { bg: c.dangerSoft, fg: c.dangerText }
  }
}

const SIZES = {
  sm: { h: 32, r: 8, px: 10, fs: 12.5, icon: 14 },
  md: { h: 36, r: 9, px: 14, fs: 13, icon: 15 },
  lg: { h: 40, r: 9, px: 16, fs: 13.5, icon: 15 }
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: IconC,
  iconRight: IconR,
  children,
  onPress,
  disabled,
  loading,
  style,
  label,
  grow
}: {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  icon?: Icon
  iconRight?: Icon
  children?: ReactNode
  onPress?: () => void
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
  label?: string
  grow?: boolean
}): ReactNode {
  const c = useTheme()
  const v = variantColors(c, variant)
  const s = SIZES[size]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      onAccessibilityTap={disabled || loading ? undefined : onPress}
      hitSlop={{ top: (44 - s.h) / 2, bottom: (44 - s.h) / 2 }}
      style={({ pressed }) => [
        {
          height: s.h,
          borderRadius: s.r,
          paddingHorizontal: s.px,
          backgroundColor: pressed && variant === 'ghost' ? c.surface2 : v.bg,
          borderWidth: v.border ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: v.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.45 : pressed && variant !== 'ghost' ? 0.88 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }]
        },
        grow && { flexGrow: 1 },
        style
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={v.fg} /> : IconC ? <IconC size={s.icon} color={v.fg} /> : null}
      {typeof children === 'string' ? (
        <T size={s.fs} weight={500} color={v.fg} lines={1}>
          {children}
        </T>
      ) : (
        children
      )}
      {IconR && <IconR size={14} color={c.muted} />}
    </Pressable>
  )
}

export function IconButton({
  icon: IconC,
  label,
  onPress,
  size = 32,
  color,
  active,
  disabled,
  style
}: {
  icon: Icon
  label: string
  onPress?: () => void
  size?: number
  color?: string
  active?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const c = useTheme()
  const slop = Math.max(0, (44 - size) / 2)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onAccessibilityTap={disabled ? undefined : onPress}
      hitSlop={slop}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed || active ? c.surface2 : 'transparent',
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.95 : 1 }]
        },
        style
      ]}
    >
      <IconC size={size >= 40 ? 17 : 15} color={color ?? (active ? c.fg : c.muted)} />
    </Pressable>
  )
}

/** Textlink in Akzentfarbe („Sprechererkennung installieren“). */
export function LinkButton({ children, onPress, style }: { children: string; onPress: () => void; style?: StyleProp<ViewStyle> }): ReactNode {
  const c = useTheme()
  return (
    <Pressable accessibilityRole="link" onPress={onPress} onAccessibilityTap={onPress} hitSlop={10} style={style}>
      {({ pressed }) => (
        <T size={12.5} weight={500} color={c.accentText} style={pressed && { textDecorationLine: 'underline' }}>
          {children}
        </T>
      )}
    </Pressable>
  )
}

// ------------------------------------------------------------ Flächen

export function Card({ children, style, divided }: { children?: ReactNode; style?: StyleProp<ViewStyle>; divided?: boolean }): ReactNode {
  const c = useTheme()
  const items = divided ? flatten(children) : null
  return (
    <View style={[{ borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.panel, overflow: 'hidden' }, style]}>
      {items
        ? items.map((child, i) => (
            <View key={i} style={i > 0 && { borderTopWidth: 1, borderTopColor: c.lineSoft }}>
              {child}
            </View>
          ))
        : children}
    </View>
  )
}

function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = []
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) n.forEach(walk)
    else if (n !== null && n !== undefined && n !== false && n !== true && n !== '') out.push(n)
  }
  walk(children)
  return out
}

export function Switch({ value, onChange, disabled, label }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }): ReactNode {
  const c = useTheme()
  return (
    <RNSwitch
      accessibilityLabel={label}
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      trackColor={{ false: c.lineStrong, true: c.ink }}
      thumbColor={Platform.OS === 'android' ? (value ? c.inkFg : '#ffffff') : undefined}
      ios_backgroundColor={c.lineStrong}
      style={[disabled && { opacity: 0.4 }, Platform.OS !== 'android' && { transform: [{ scale: 0.8 }] }]}
    />
  )
}

// ------------------------------------------------------------ Segmented

export function Segmented<V extends string>({
  value,
  options,
  onChange,
  size = 'md',
  stretch
}: {
  value: V
  options: { value: V; label: string; icon?: Icon }[]
  onChange: (v: V) => void
  size?: 'sm' | 'md'
  stretch?: boolean
}): ReactNode {
  const c = useTheme()
  const [frames, setFrames] = useState<Record<string, { x: number; w: number }>>({})
  const x = useRef(new Animated.Value(0)).current
  const w = useRef(new Animated.Value(0)).current
  const ready = useRef(false)
  const f = frames[value]

  useEffect(() => {
    if (!f) return
    if (!ready.current) {
      x.setValue(f.x)
      w.setValue(f.w)
      ready.current = true
      return
    }
    Animated.parallel([
      Animated.spring(x, { toValue: f.x, useNativeDriver: false, bounciness: 3, speed: 18 }),
      Animated.spring(w, { toValue: f.w, useNativeDriver: false, bounciness: 3, speed: 18 })
    ]).start()
  }, [f?.x, f?.w]) // eslint-disable-line react-hooks/exhaustive-deps

  const h = size === 'sm' ? 24 : 28
  return (
    <View style={{ flexDirection: 'row', alignSelf: stretch ? 'stretch' : 'flex-start', borderRadius: 9, backgroundColor: c.surface2, padding: 3 }}>
      {f && (
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: 3, height: h, left: x, width: w, borderRadius: 6, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line }}
        />
      )}
      {options.map((o) => {
        const on = o.value === value
        const IconC = o.icon
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            hitSlop={{ top: 8, bottom: 8 }}
            onLayout={(e: LayoutChangeEvent) => {
              const { x: lx, width } = e.nativeEvent.layout
              setFrames((p) => (p[o.value]?.x === lx && p[o.value]?.w === width ? p : { ...p, [o.value]: { x: lx, w: width } }))
            }}
            style={{ height: h, paddingHorizontal: 12, borderRadius: 6, alignItems: 'center', justifyContent: 'center', flexGrow: stretch ? 1 : 0 }}
          >
            {IconC ? (
              <IconC size={14} color={on ? c.fg : c.fg2} />
            ) : (
              <T size={size === 'sm' ? 12 : 13} weight={500} color={on ? c.fg : c.fg2} lines={1}>
                {o.label}
              </T>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

// ------------------------------------------------------------ Auswahl

export interface Option<V extends string> {
  value: V
  label: string
  hint?: string
  disabled?: boolean
}

export function Select<V extends string>({
  value,
  options,
  onChange,
  placeholder,
  title,
  style
}: {
  value: V | null
  options: Option<V>[]
  onChange: (v: V) => void
  placeholder?: string
  title?: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const c = useTheme()
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title ?? placeholder}
        accessibilityHint={current?.label}
        onPress={() => setOpen(true)}
        hitSlop={{ top: 4, bottom: 4 }}
        style={({ pressed }) => [
          {
            height: 36,
            minWidth: 120,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderRadius: 9,
            borderWidth: 1,
            borderColor: pressed ? c.lineStrong : c.line,
            backgroundColor: c.panel,
            paddingLeft: 12,
            paddingRight: 10
          },
          style
        ]}
      >
        <T size={13} color={current ? c.fg : c.faint} lines={1} style={{ flex: 1 }}>
          {current?.label ?? placeholder ?? 'Auswählen'}
        </T>
        <ChevronDown size={14} color={c.faint} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {options.length === 0 && (
          <T size={13} color={c.muted} style={{ padding: 12 }}>
            {placeholder ?? 'Keine Auswahl verfügbar'}
          </T>
        )}
        {options.map((o) => (
          <MenuItem
            key={o.value}
            label={o.label}
            hint={o.hint}
            disabled={o.disabled}
            selected={o.value === value}
            onPress={() => {
              setOpen(false)
              onChange(o.value)
            }}
          />
        ))}
      </Sheet>
    </>
  )
}

export function MenuItem({
  label,
  hint,
  selected,
  disabled,
  onPress,
  left
}: {
  label: string
  hint?: string
  selected?: boolean
  disabled?: boolean
  onPress: () => void
  left?: ReactNode
}): ReactNode {
  const c = useTheme()
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: pressed ? c.surface2 : 'transparent',
        opacity: disabled ? 0.4 : 1
      })}
    >
      {left}
      <View style={{ flex: 1 }}>
        <T size={13.5} lines={1} weight={selected ? 500 : 400}>
          {label}
        </T>
        {hint ? (
          <T size={11.5} color={c.faint} lines={2}>
            {hint}
          </T>
        ) : null}
      </View>
      {selected && <Check size={15} color={c.fg} />}
    </Pressable>
  )
}

/** Auswahlliste: auf dem Telefon von unten, im breiten Fenster mittig. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (open) Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: nativeAnimations }).start()
    else v.setValue(0)
  }, [open, v])
  return (
    <RNModal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: wide ? 'center' : 'flex-end', alignItems: wide ? 'center' : 'stretch' }}>
        <Pressable accessibilityLabel="Schließen" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: c.backdrop }]} />
        <Animated.View
          accessibilityViewIsModal
          style={{
            transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [wide ? 6 : 48, 0] }) }],
            backgroundColor: c.panel,
            borderColor: c.line,
            borderWidth: 1,
            borderRadius: wide ? 12 : 16,
            borderBottomLeftRadius: wide ? 12 : 0,
            borderBottomRightRadius: wide ? 12 : 0,
            width: wide ? 360 : undefined,
            maxHeight: height * 0.7,
            padding: 4,
            paddingBottom: wide ? 4 : insets.bottom + 8
          }}
        >
          {!wide && <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.lineStrong, marginTop: 6, marginBottom: 4 }} />}
          {title && (
            <T size={11} weight={600} color={c.muted} style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4, letterSpacing: 0.66, textTransform: 'uppercase' }}>
              {title}
            </T>
          )}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </RNModal>
  )
}

// ------------------------------------------------------------ Kleinteile

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  const c = useTheme()
  return (
    <View
      style={{
        height: 22,
        minWidth: 22,
        paddingHorizontal: 6,
        borderRadius: 5,
        borderWidth: 1,
        borderBottomWidth: 2,
        borderColor: c.lineStrong,
        backgroundColor: c.bg,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Text style={[mono, { fontSize: 11.5, fontWeight: '500', color: c.fg }]}>{children}</Text>
    </View>
  )
}

export function Hotkey({ keys }: { keys: number[] }): ReactNode {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {sortKeys(keys).map((k) => (
        <Kbd key={k}>{k === 3675 || k === 3676 ? '⌘' : k === 29 || k === 3613 ? '⌃' : k === 56 || k === 3640 ? '⌥' : keyLabel(k)}</Kbd>
      ))}
    </View>
  )
}

export type Tone = 'default' | 'accent' | 'success' | 'warning' | 'danger'

export function toneColors(c: Palette, tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case 'accent':
      return { bg: c.accentSoft, fg: c.accentText }
    case 'success':
      return { bg: c.successSoft, fg: c.successText }
    case 'warning':
      return { bg: c.warningSoft, fg: c.warningText }
    case 'danger':
      return { bg: c.dangerSoft, fg: c.dangerText }
    default:
      return { bg: c.surface2, fg: c.fg2 }
  }
}

export function Badge({ children, tone = 'default', size = 'sm', icon: IconC, left }: { children: ReactNode; tone?: Tone; size?: 'sm' | 'md'; icon?: Icon; left?: ReactNode }): ReactNode {
  const c = useTheme()
  const t = toneColors(c, tone)
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: size === 'sm' ? 4 : 6,
        height: size === 'sm' ? 20 : 24,
        paddingHorizontal: size === 'sm' ? 8 : 10,
        borderRadius: 999,
        backgroundColor: t.bg
      }}
    >
      {left}
      {IconC && <IconC size={12} color={t.fg} />}
      <T size={size === 'sm' ? 11 : 12} weight={500} color={t.fg} lines={1}>
        {children}
      </T>
    </View>
  )
}

export function Progress({ value, indeterminate, style }: { value: number; indeterminate?: boolean; style?: StyleProp<ViewStyle> }): ReactNode {
  const c = useTheme()
  const [width, setWidth] = useState(0)
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!indeterminate) return
    anim.setValue(0)
    const loop = Animated.loop(Animated.timing(anim, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeAnimations }))
    loop.start()
    return () => loop.stop()
  }, [indeterminate, anim])
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={indeterminate ? undefined : { min: 0, max: 100, now: Math.round(value * 100) }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[{ height: 6, borderRadius: 999, backgroundColor: c.surface2, overflow: 'hidden' }, style]}
    >
      {indeterminate ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: width / 3,
            borderRadius: 999,
            backgroundColor: c.accent,
            transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.35, width] }) }]
          }}
        />
      ) : (
        <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, value * 100))}%`, borderRadius: 999, backgroundColor: c.accent }} />
      )}
    </View>
  )
}

export function Meter({ value, max = 5, label }: { value: number; max?: number; label: string }): ReactNode {
  const c = useTheme()
  return (
    <View accessible accessibilityLabel={`${label}: ${value} von ${max}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <T size={11.5} color={c.muted}>
        {label}
      </T>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: max }, (_, i) => (
          <View key={i} style={{ height: 6, width: 12, borderRadius: 999, backgroundColor: i < value ? c.accent : c.surface2 }} />
        ))}
      </View>
    </View>
  )
}

export function Spinner({ color, size = 'small' }: { color?: string; size?: 'small' | 'large' }): ReactNode {
  const c = useTheme()
  return <ActivityIndicator size={size} color={color ?? c.muted} />
}

/** Pulsierender Punkt (Aufnahme läuft). */
export function PulseDot({ color, size = 8, active = true }: { color: string; size?: number; active?: boolean }): ReactNode {
  const v = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!active) {
      v.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeAnimations }),
        Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeAnimations })
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [active, v])
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }]
      }}
    />
  )
}

// ------------------------------------------------------------ Seitenaufbau

export function SettingRow({ title, description, children, stack }: { title: ReactNode; description?: ReactNode; children?: ReactNode; stack?: boolean }): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  const vertical = stack ?? false
  return (
    <View
      style={{
        flexDirection: vertical ? 'column' : 'row',
        alignItems: vertical ? 'stretch' : 'center',
        gap: vertical ? 10 : wide ? 24 : 14,
        paddingHorizontal: wide ? 20 : 16,
        paddingVertical: 14
      }}
    >
      <View style={{ flex: vertical ? 0 : 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <T size={13.5} weight={500}>
            {title}
          </T>
        ) : (
          title
        )}
        {description ? (
          typeof description === 'string' ? (
            <T size={12.5} color={c.muted} style={{ marginTop: 2, lineHeight: 19 }}>
              {description}
            </T>
          ) : (
            <View style={{ marginTop: 2 }}>{description}</View>
          )
        ) : null}
      </View>
      {children !== undefined && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>{children}</View>}
    </View>
  )
}

export function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }): ReactNode {
  const c = useTheme()
  return (
    <View style={{ marginBottom: 32 }}>
      <View style={{ marginBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, paddingHorizontal: 4 }}>
        <View style={{ flex: 1 }}>
          <T size={14} weight={600}>
            {title}
          </T>
          {description && (
            <T size={12.5} color={c.muted} style={{ marginTop: 2 }}>
              {description}
            </T>
          )}
        </View>
        {action}
      </View>
      <Card divided>{children}</Card>
    </View>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }): ReactNode {
  const c = useTheme()
  const { wide } = useLayout()
  return (
    <View style={{ marginBottom: 28, flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'flex-end' : 'stretch', justifyContent: 'space-between', gap: wide ? 24 : 14 }}>
      <View style={{ flexShrink: 1 }}>
        <T size={wide ? 28 : 26} weight={600} style={{ letterSpacing: -0.56, lineHeight: wide ? 32 : 30 }} accessibilityRole="header">
          {title}
        </T>
        {subtitle ? (
          typeof subtitle === 'string' ? (
            <T size={13.5} color={c.muted} style={{ marginTop: 6, lineHeight: 20 }}>
              {subtitle}
            </T>
          ) : (
            <View style={{ marginTop: 6 }}>{subtitle}</View>
          )
        ) : null}
      </View>
      {actions ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>{actions}</View> : null}
    </View>
  )
}

/** Abschnittsüberschrift in Großbuchstaben („In Bearbeitung“). */
export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }): ReactNode {
  const c = useTheme()
  return (
    <T size={11} weight={600} color={c.muted} style={[{ letterSpacing: 0.66, textTransform: 'uppercase', marginBottom: 8, paddingHorizontal: 4 }, style]}>
      {children}
    </T>
  )
}

export function Modal({ open, onClose, children, width = 440 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }): ReactNode {
  const c = useTheme()
  const { width: screen } = useWindowDimensions()
  const scale = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (open) Animated.timing(scale, { toValue: 1, duration: 220, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: nativeAnimations }).start()
    else scale.setValue(0)
  }, [open, scale])
  return (
    <RNModal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Pressable accessibilityLabel="Schließen" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: c.backdrop }]} />
        <Animated.View
          accessibilityViewIsModal
          style={{
            width: Math.min(width, screen - 32),
            maxHeight: '86%',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: c.line,
            backgroundColor: c.panel,
            padding: 24,
            opacity: scale,
            transform: [{ scale: scale.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }, { translateY: scale.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }]
          }}
        >
          <IconButton icon={X} label="Schließen" onPress={onClose} style={{ position: 'absolute', top: 12, right: 12, zIndex: 2 }} />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </RNModal>
  )
}

/** Bestätigungsdialog wie „Transkript löschen?“ */
export function Confirm({
  open,
  title,
  text,
  confirm = 'Löschen',
  onCancel,
  onConfirm
}: {
  open: boolean
  title: string
  text: string
  confirm?: string
  onCancel: () => void
  onConfirm: () => Promise<void> | void
}): ReactNode {
  const c = useTheme()
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onCancel} width={400}>
      <T size={16} weight={600} style={{ paddingRight: 32 }}>
        {title}
      </T>
      <T size={13} color={c.muted} style={{ marginTop: 8, lineHeight: 19 }}>
        {text}
      </T>
      <View style={{ marginTop: 24, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        <Button onPress={onCancel}>Abbrechen</Button>
        <Button
          variant="danger"
          loading={busy}
          onPress={async () => {
            setBusy(true)
            try {
              await onConfirm()
            } finally {
              setBusy(false)
            }
          }}
        >
          {confirm}
        </Button>
      </View>
    </Modal>
  )
}

export function EmptyState({ icon: IconC, title, text, action }: { icon: Icon; title: string; text: string; action?: ReactNode }): ReactNode {
  const c = useTheme()
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 56 }}>
      <View style={{ marginBottom: 16, width: 48, height: 48, borderRadius: 16, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <IconC size={20} color={c.muted} />
      </View>
      <T size={15} weight={600} style={{ textAlign: 'center' }}>
        {title}
      </T>
      <T size={13} color={c.muted} style={{ marginTop: 4, maxWidth: 384, textAlign: 'center', lineHeight: 20 }}>
        {text}
      </T>
      {action && <View style={{ marginTop: 20 }}>{action}</View>}
    </View>
  )
}

/** „Maya Chen“ → MC, „Sprecher 2“ → S2, „Anna“ → An */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).replace(/^./, (x) => x.toUpperCase())
  const last = words[words.length - 1]
  return (words[0][0] + (/^\d+$/.test(last) ? last : last[0])).toUpperCase()
}

export function Avatar({ name, speaker, size = 32, ring }: { name: string; speaker?: number; size?: number; ring?: string }): ReactNode {
  const c = useTheme()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: speakerColor(c, speaker),
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 0,
        borderColor: ring
      }}
    >
      <T size={Math.round(size * 0.36)} weight={600} color={c.dark ? '#0c0c0d' : '#ffffff'}>
        {initials(name)}
      </T>
    </View>
  )
}

/** Wortmarke: dunkles Quadrat mit vier Pegelbalken. */
export function Logo({ size = 28 }: { size?: number }): ReactNode {
  const c = useTheme()
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" accessibilityElementsHidden>
      <Rect width="28" height="28" rx="8" fill={c.ink} />
      <G fill={c.inkFg}>
        <Rect x="5" y="10" width="3" height="8" rx="1.5" />
        <Rect x="10" y="7" width="3" height="14" rx="1.5" />
        <Rect x="15" y="9" width="3" height="10" rx="1.5" />
        <Rect x="20" y="11.5" width="3" height="5" rx="1.5" />
      </G>
    </Svg>
  )
}

/** Text mit gelb markiertem Suchbegriff. */
export function Highlight({ text, query, style, lines }: { text: string; query: string; style?: StyleProp<TextStyle>; lines?: number }): ReactNode {
  const c = useTheme()
  if (!query) return <Text style={style} numberOfLines={lines}>{text}</Text>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <Text style={style} numberOfLines={lines}>
      {parts.map((p, i) =>
        i % 2 ? (
          <Text key={i} style={{ backgroundColor: c.mark }}>
            {p}
          </Text>
        ) : (
          p
        )
      )}
    </Text>
  )
}

/** Eingabefeld im Stil der App. */
export const inputStyle = (c: Palette, focused = false): TextStyle => ({
  ...font(400),
  minHeight: 40,
  borderRadius: 9,
  borderWidth: 1,
  borderColor: focused ? c.lineStrong : c.line,
  backgroundColor: c.bg,
  paddingHorizontal: 12,
  fontSize: 14,
  color: c.fg
})

export { alpha }
