import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertPill, type AlertPillType } from '../components/base/AlertPill';
import { BottomSheet } from '../components/base/BottomSheet';
import { Card } from '../components/base/Card';
import { Column, Row, Stack } from '../components/base/Layout';
import { ScreenContainer } from '../components/base/ScreenContainer';
import { alpha, colors, radii, spacing, typography } from '../theme/tokens';

/**
 * Storybook-style preview for the design-system foundation — renders every
 * token group and every base component with its variants. Debug/dev only;
 * mount via SHOW_DESIGN_SYSTEM_PREVIEW in App.tsx. Not part of the shipped
 * navigation.
 */
const SHEET_PEEK = 150;

export function DesignSystemPreviewScreen() {
  const [snap, setSnap] = useState('collapsed');

  return (
    <View style={styles.host}>
      <ScreenContainer edges={['top', 'left', 'right']} style={styles.scrollPad}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Stack gap="xl">
            <Section title="Colours">
              <Row gap="sm" wrap>
                <Swatch name="charcoal" value={colors.charcoal} />
                <Swatch name="asphalt" value={colors.asphalt} />
                <Swatch name="slate" value={colors.slate} />
                <Swatch name="teal" value={colors.teal} />
                <Swatch name="coolBlue" value={colors.coolBlue} />
                <Swatch name="amber" value={colors.amber} />
                <Swatch name="red" value={colors.red} />
                <Swatch name="white" value={colors.white} />
                <Swatch name="textSec" value={colors.textSecondary} />
                <Swatch name="textMuted" value={colors.textMuted} />
              </Row>
            </Section>

            <Section title="Typography — Rajdhani display / Inter body">
              <Text style={styles.typeStat}>3 hr 12 min</Text>
              <Text style={styles.typeHeading}>Real-time intelligence.</Text>
              <Text style={styles.typeTitle}>Police reported</Text>
              <Text style={styles.typeBody}>
                Stuart Hwy, 12 km ahead — turn-by-turn guidance with live road alerts.
              </Text>
              <Text style={styles.typeCaption}>Arrive 1:03 pm · 286 km</Text>
              <Text style={styles.typeEyebrow}>NEARBY ALERTS</Text>
            </Section>

            <Section title="AlertPill — all categories">
              <Row gap="sm" wrap>
                {(['police', 'traffic', 'accident', 'closure', 'roadkill', 'hazard'] as AlertPillType[]).map(
                  (t) => (
                    <AlertPill key={t} type={t} />
                  ),
                )}
              </Row>
              <Row gap="sm" wrap>
                <AlertPill type="police" size="sm" />
                <AlertPill type="police" size="sm" label="Mobile camera" />
                <AlertPill type="accident" size="sm" showDot={false} />
              </Row>
            </Section>

            <Section title="Card — variants">
              <Stack gap="md">
                <Card>
                  <Text style={styles.typeTitle}>flat (default)</Text>
                  <Text style={styles.typeCaption}>Alert details, nearby-alerts rows</Text>
                </Card>
                <Card variant="raised">
                  <Text style={styles.typeTitle}>raised</Text>
                  <Text style={styles.typeCaption}>Content sitting on another surface</Text>
                </Card>
                <Card variant="outlined" padding="lg">
                  <Text style={styles.typeTitle}>outlined, padding=lg</Text>
                  <Text style={styles.typeCaption}>Emphasised blocks like the report card</Text>
                </Card>
              </Stack>
            </Section>

            <Section title="Layout primitives — Row / Column / Stack">
              <Row gap="md" align="center">
                <DemoBox label="Row" />
                <DemoBox label="gap=md" />
                <DemoBox label="align" />
              </Row>
              <Stack gap="xs">
                <DemoBox label="Stack child" />
                <DemoBox label="gap=xs" />
              </Stack>
            </Section>

            <Section title="BottomSheet">
              <Text style={styles.typeBody}>
                Live sheet anchored to the bottom of this screen — drag the grabber or tap it.
                Currently {snap}.
              </Text>
            </Section>
          </Stack>
        </ScrollView>
      </ScreenContainer>

      <BottomSheet
        peekHeight={SHEET_PEEK}
        header={
          <Row justify="space-between" align="center">
            <Text style={styles.sheetTitle}>5 alerts nearby</Text>
            <Text style={styles.sheetLive}>● Live · 2 min ago</Text>
          </Row>
        }
        onSnapChange={setSnap}
      >
        <Stack gap="sm">
          <SheetRow type="police" title="Police reported" sub="Stuart Hwy, 12 km ahead" dist="12 km" />
          <SheetRow type="traffic" title="Heavy traffic" sub="Delay near Ilparpa Rd" dist="28 km" />
          <SheetRow type="accident" title="Accident" sub="Stuart Hwy, both directions" dist="63 km" />
          <SheetRow type="closure" title="Road closure" sub="Due to flood damage" dist="104 km" />
          <SheetRow type="roadkill" title="Roadkill reported" sub="Stuart Hwy" dist="156 km" />
        </Stack>
      </BottomSheet>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="md">
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {children}
    </Stack>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <Column gap="xs" align="center">
      <View style={[styles.swatch, { backgroundColor: value }]} />
      <Text style={styles.swatchName}>{name}</Text>
      <Text style={styles.swatchHex}>{value}</Text>
    </Column>
  );
}

function DemoBox({ label }: { label: string }) {
  return (
    <View style={styles.demoBox}>
      <Text style={styles.demoBoxText}>{label}</Text>
    </View>
  );
}

function SheetRow({ type, title, sub, dist }: { type: AlertPillType; title: string; sub: string; dist: string }) {
  return (
    <Row gap="sm" align="center" style={styles.sheetRow}>
      <AlertPill type={type} size="sm" showDot={false} />
      <Column gap="xxs" flex={1}>
        <Text style={styles.sheetRowTitle}>{title}</Text>
        <Text style={styles.sheetRowSub} numberOfLines={1}>{sub}</Text>
      </Column>
      <Text style={styles.sheetRowDist}>{dist}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollPad: {
    // Leave room for the sheet's peek so the last section isn't covered.
    paddingBottom: SHEET_PEEK + spacing.md,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.textMuted,
  },
  typeStat: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.stat,
    color: colors.textPrimary,
  },
  typeHeading: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.heading,
    color: colors.textPrimary,
  },
  typeTitle: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.title,
    color: colors.textPrimary,
  },
  typeBody: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.body,
    color: colors.textSecondary,
    lineHeight: Math.round(typography.fontSize.body * 1.5),
  },
  typeCaption: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textMuted,
  },
  typeEyebrow: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.eyebrow,
    letterSpacing: typography.letterSpacing.eyebrow,
    color: colors.accent,
  },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  swatchName: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  swatchHex: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.eyebrow,
    color: colors.textMuted,
  },
  demoBox: {
    backgroundColor: alpha(colors.teal, 0.12),
    borderWidth: 1,
    borderColor: alpha(colors.teal, 0.4),
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  demoBoxText: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.fontSize.caption,
    color: colors.teal,
  },
  sheetTitle: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.title,
    color: colors.textPrimary,
  },
  sheetLive: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.accent,
  },
  sheetRow: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  sheetRowTitle: {
    fontFamily: typography.fontFamily.displayMedium,
    fontSize: typography.fontSize.body,
    color: colors.textPrimary,
  },
  sheetRowSub: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.caption,
    color: colors.textSecondary,
  },
  sheetRowDist: {
    fontFamily: typography.fontFamily.display,
    fontSize: typography.fontSize.bodyLarge,
    color: colors.textPrimary,
  },
});
