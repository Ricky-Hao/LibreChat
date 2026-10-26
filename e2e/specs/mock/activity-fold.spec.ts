import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { NEW_CHAT_PATH, messagesView, selectMockEndpoint, sendMessage } from './helpers';
import {
  deleteConversations,
  deleteMessagesByConversation,
  seedConversations,
  seedMessages,
} from './db';
import { getE2EUser } from '../../setup/user';

const PHASE_ENDPOINT = { label: 'Mock Provider F', model: 'mock-model-f' };
const MCP_SERVER_TITLE = 'E2E Memory';
const LABEL_SERVER = `http://127.0.0.1:${process.env.E2E_LABEL_PORT || '8889'}`;
const PHASE_LABEL = 'Gathered both facts around a broken echo';
const SHOT_DIR = process.env.E2E_FOLD_SHOTS || '';

const uniqueLabel = () => `fold-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const MOBILE_INTENTS = [
  '核对十二项配置并生成报告',
  '检查旧任务中保留的完整操作意图，核对所有配置项目，然后创建一份包含检查结果和后续处理建议的详细报告。',
  'CheckEveryConfigurationEntryBeforeCreatingTheCompleteComparisonReportWithoutDroppingAnyOriginalIntentText',
];

function intentParts(prefix: string) {
  return MOBILE_INTENTS.map((intent, index) => ({
    type: 'tool_call',
    tool_call: {
      id: `${prefix}-${index}`,
      name: 'lookup',
      args: JSON.stringify({ intent, query: 'synthetic fixture' }),
      output: 'Synthetic result',
      type: 'tool_call',
      progress: 1,
      runStepStatus: 'completed',
      ...(index === 1
        ? { runStepDurationMs: 14_000 }
        : { toolPreparationDurationMs: 13_000, toolExecutionDurationMs: 1000 }),
    },
  }));
}

/** Measure text fragments, not just the element box: an ellipsized span can
 * have perfectly contained bounds while most of its text remains invisible. */
async function expectIntentGeometry(row: Locator, intent: string, mobile: boolean) {
  const button = row.getByRole('button');
  await expect(button).toContainText(intent);
  await button.scrollIntoViewIfNeeded();
  const geometry = await button.evaluate((element, text) => {
    const label = [...element.querySelectorAll('span')].find(
      (span) => span.textContent === text && span.childElementCount === 0,
    );
    if (!label) throw new Error('Intent label missing');
    const primary = label.getBoundingClientRect();
    const buttonBox = element.getBoundingClientRect();
    const wrapper = element.closest('.progress-text-wrapper');
    if (!wrapper?.parentElement) throw new Error('Caller row missing');
    const rowBox = wrapper.parentElement.getBoundingClientRect();
    const metadata = label.nextElementSibling?.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(label);
    const fragments = [...range.getClientRects()];
    const following = wrapper.parentElement.nextElementSibling?.getBoundingClientRect();
    return {
      text: label.textContent,
      overflow: label.scrollWidth > label.clientWidth + 1,
      clipped: fragments.some(
        (fragment) =>
          fragment.left < primary.left - 1 ||
          fragment.right > primary.right + 1 ||
          fragment.top < primary.top - 1 ||
          fragment.bottom > primary.bottom + 1,
      ),
      buttonFits: buttonBox.left >= rowBox.left - 1 && buttonBox.right <= rowBox.right + 1,
      rowContainsButton: buttonBox.bottom <= rowBox.bottom + 1,
      followingOverlaps: following != null && following.top < buttonBox.bottom - 1,
      metadataBelow: metadata == null || metadata.top >= primary.bottom - 1,
      metadataFits:
        metadata == null ||
        (metadata.right <= buttonBox.right + 1 && metadata.bottom <= buttonBox.bottom + 1),
      viewportFits: buttonBox.right <= document.documentElement.clientWidth + 1,
      ellipsis: getComputedStyle(label).textOverflow === 'ellipsis',
    };
  }, intent);
  expect(geometry).toMatchObject({
    text: intent,
    overflow: false,
    clipped: false,
    buttonFits: true,
    rowContainsButton: true,
    followingOverlaps: false,
    metadataFits: true,
    viewportFits: true,
    ellipsis: false,
    ...(mobile ? { metadataBelow: true } : {}),
  });
}

for (const width of [320, 360, 390, 430, 1280]) {
  test(`mobile intent geometry at ${width}px in action folds and child panels`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('navVisible', 'false');
      localStorage.setItem('autoExpandTools', 'false');
      localStorage.setItem('color-theme', sessionStorage.getItem('intent-review-theme') ?? 'dark');
    });
    const conversationId = randomUUID();
    const userMessageId = randomUUID();
    const { email } = getE2EUser();
    await seedConversations(email, [
      { conversationId, title: 'Synthetic mobile intent review', updatedAt: new Date() },
    ]);
    await seedMessages(email, conversationId, [
      {
        messageId: userMessageId,
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        text: 'Review synthetic tool intents.',
        isCreatedByUser: true,
        sender: 'User',
      },
      {
        messageId: randomUUID(),
        parentMessageId: userMessageId,
        text: 'Following row remains clear.',
        isCreatedByUser: false,
        sender: 'Assistant',
        content: [
          ...intentParts('intent'),
          {
            type: 'activity_label',
            activity_label: 'Synthetic action group',
            activity_start_index: 0,
            activity_end_index: 3,
            activity_count: 3,
          },
          {
            type: 'activity_label',
            activity_label: 'Synthetic review phase',
            activity_label_type: 'phase',
            activity_start_index: 0,
            activity_end_index: 4,
            activity_count: 3,
          },
          { type: 'text', text: 'Following row remains clear.' },
          {
            type: 'tool_call',
            tool_call: {
              id: 'intent-child',
              name: 'subagent',
              type: 'tool_call',
              args: JSON.stringify({ subagent_type: 'general', prompt: 'Synthetic child review' }),
              output: 'Synthetic child complete',
              progress: 1,
              runStepStatus: 'completed',
              subagent_content: [
                ...intentParts('child-intent'),
                { type: 'text', text: 'Child following row remains clear.' },
              ],
            },
          },
        ],
      },
    ]);
    try {
      await page.goto(`/c/${conversationId}`);
      const phase = page.getByRole('button', { name: 'Synthetic review phase', exact: true });
      await phase.click();
      const group = page.getByRole('button', { name: /^Synthetic action group/ });
      await group.click();
      for (const [index, intent] of MOBILE_INTENTS.entries()) {
        const row = page.locator(`[data-tool-call-id="intent-${index}"]`);
        await expectIntentGeometry(row, intent, width < 640);
        await expect(row).toContainText(index === 1 ? 'Total elapsed 14s' : 'Preparation 13s');
        if (index !== 1) await expect(row).toContainText('Tool call 1s');
      }
      const disclosure = page.locator('[data-tool-call-id="intent-0"]').getByRole('button');
      await disclosure.focus();
      await expect(disclosure).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('[data-tool-call-output-id="intent-0"]')).toContainText(
        'Synthetic result',
      );
      await page.keyboard.press('Space');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await disclosure.click();
      await disclosure.blur();
      await phase.scrollIntoViewIfNeeded();
      await shot(page, `intents-${width}-dark`);
      if (width === 390) {
        await page.evaluate(() => {
          sessionStorage.setItem('intent-review-theme', 'light');
        });
        await page.reload();
        await expect(page.locator('html')).toHaveClass(/\blight\b/);
        await phase.click();
        await group.click();
        for (const [index, intent] of MOBILE_INTENTS.entries()) {
          await expectIntentGeometry(
            page.locator(`[data-tool-call-id="intent-${index}"]`),
            intent,
            true,
          );
        }
        await phase.scrollIntoViewIfNeeded();
        await shot(page, 'intents-390-light');
      }

      await page.locator('[data-subagent-tool-call="intent-child"]').click();
      const panel = page.getByRole(width < 768 ? 'dialog' : 'region', {
        name: 'Child agent activity',
      });
      await expect(panel).toBeVisible();
      const childGroup = panel.getByRole('button', { name: /^Ran 3 actions/ });
      await childGroup.click();
      for (const [index, intent] of MOBILE_INTENTS.entries()) {
        await expectIntentGeometry(
          panel.locator(`[data-tool-call-id="child-intent-${index}"]`),
          intent,
          width < 640,
        );
      }
      await panel.locator('[data-tool-call-id="child-intent-0"]').scrollIntoViewIfNeeded();
      await shot(page, `intents-child-${width}`);
    } finally {
      await deleteMessagesByConversation([conversationId]);
      await deleteConversations([conversationId]);
    }
  });
}

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) {
    return;
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

async function setPhaseLabel(request: APIRequestContext) {
  await request.post(`${LABEL_SERVER}/__e2e/reset`);
  const response = await request.post(`${LABEL_SERVER}/__e2e/behavior`, {
    data: { phaseLabel: PHASE_LABEL, labelsByPrompt: {} },
  });
  expect(response.ok()).toBeTruthy();
}

async function selectEphemeralMCP(page: Page) {
  await page.getByRole('button', { name: 'Attach and tools' }).click();
  const palette = page.getByRole('dialog', { name: 'Attach and tools' });
  const serverItem = palette.getByRole('button', { name: new RegExp(`^${MCP_SERVER_TITLE}\\b`) });
  await expect(serverItem).toBeVisible({ timeout: 20_000 });
  await serverItem.click();
  await expect(serverItem).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listitem', { name: MCP_SERVER_TITLE, exact: true })).toBeVisible();
}

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('Warning:')) {
      problems.push(`console.${message.type()}: ${message.text().slice(0, 300)}`);
    }
  });
  return problems;
}

test.describe('activity fold', () => {
  test('titles the open fold, rails its rows and reaches the failed call in one click', async ({
    page,
    request,
  }) => {
    test.setTimeout(120000);
    const problems = collectPageProblems(page);
    const label = uniqueLabel();
    const finalText = `E2E activity failed reply done ${label}`;
    await setPhaseLabel(request);

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, PHASE_ENDPOINT);
    await selectEphemeralMCP(page);
    const run = await sendMessage(page, `E2E_ACTIVITY_FAILED_REPLY:${label}`);
    expect(run.ok()).toBeTruthy();

    /** The live span: sample the fold while the slow echo keeps the batch
     *  open, so the streaming header and any pill it grows are on record. */
    const liveHeaders: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      await page.waitForTimeout(600);
      const card = messagesView(page).getByTestId('activity-phase-card').first();
      if (await card.isVisible().catch(() => false)) {
        liveHeaders.push((await card.innerText()).replace(/\s+/g, ' ').trim());
        await shot(page, `live-${index}`);
      }
    }
    /** The header ticks through the run's live lines before the label lands. */
    expect(liveHeaders.some((line) => /Running/.test(line))).toBe(true);

    await expect(messagesView(page).getByText(finalText)).toBeVisible({ timeout: 60000 });
    const header = messagesView(page).getByRole('button', { name: PHASE_LABEL, exact: true });
    await expect(header).toBeVisible({ timeout: 30000 });
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await shot(page, 'settled-collapsed');

    const pill = messagesView(page).getByTestId('failed-reveal-pill');
    const peek = messagesView(page).getByTestId('activity-phase-failed-peek');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAccessibleName('Show 1 failed call out of 4 calls');
    await expect(peek).toBeVisible();
    await expect(peek).toContainText('Failed:');
    await expect(peek).toContainText('Show error');

    /** One click from the closed card to the open error panel. */
    await peek.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(peek).toBeHidden();
    const failedRow = messagesView(page)
      .locator('[data-testid="tool-call"]')
      .filter({ hasText: /^Failed:/ });
    await expect(failedRow).toBeVisible();
    await expect(failedRow).toContainText('failed');
    const failedId = await failedRow.getAttribute('data-tool-call-id');
    const panel = messagesView(page).locator(`[data-tool-call-output-id="${failedId}"]`);
    await expect(panel).toContainText(/error/i, { timeout: 5000 });
    /** Focus lands on the failed row's own disclosure button, not a wrapper. */
    expect(
      await page.evaluate(() => {
        const active = document.activeElement;
        return {
          tag: active?.tagName,
          row: active?.closest('[data-testid="tool-call"]')?.getAttribute('data-tool-call-id'),
        };
      }),
    ).toEqual({ tag: 'BUTTON', row: failedId });
    await shot(page, 'revealed');

    /** The open header is the title: primary, semibold, over railed rows. */
    await expect(header).toHaveClass(/font-semibold/);
    await expect(header).toHaveClass(/text-text-primary/);
    const rail = messagesView(page).getByTestId('activity-phase-panel').locator('> div').first();
    await expect(rail).toHaveClass(/ps-6/);
    /** Only the group holding the failure opened; its sibling groups stay
     *  folded under the phase. The slow echo shares that batch. */
    expect(await messagesView(page).locator('[data-testid="tool-call"]').count()).toBe(2);
    await expect(messagesView(page).getByTestId('tool-call-group-panel')).toHaveCount(3);

    /** Closing by the header brings the peek back; the pill then does the
     *  same reveal from the closed state. */
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(peek).toBeVisible();
    await pill.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toContainText(/error/i);
    await shot(page, 'revealed-by-pill');

    /** Each open fold's rail lights up under the pointer, swaps ITS header's
     *  glyph for a collapse knob, and collapses only that fold. */
    const knobs = messagesView(page).getByTestId('fold-rail-knob');
    const phaseRail = messagesView(page)
      .getByTestId('activity-phase-panel')
      .locator('> div > [data-testid="fold-rail"]');
    const groupPanel = messagesView(page)
      .getByTestId('tool-call-group-panel')
      .filter({ has: page.getByTestId('tool-call').filter({ hasText: /^Failed:/ }) });
    const groupRail = groupPanel.locator('> div > [data-testid="fold-rail"]');
    const groupHeader = groupPanel.locator('xpath=preceding-sibling::div[1]').getByRole('button');
    const lineColor = (railLocator: typeof groupRail) =>
      railLocator
        .locator('g > path')
        .first()
        .evaluate((line) => getComputedStyle(line).stroke);
    const restingLine = await lineColor(groupRail);

    /** A row two folds deep lights both rails, each into its own branch: the
     *  group's into the row's glyph, the phase's into the group's header. */
    const failedCall = groupPanel.getByTestId('tool-call').filter({ hasText: /^Failed:/ });
    const litBranch = (railLocator: typeof groupRail) =>
      railLocator.locator('[data-fold-trace][data-lit]');
    const endsAt = async (path: ReturnType<typeof litBranch>, row: typeof failedCall) => {
      await expect(path).toHaveCSS('opacity', '1');
      /** The foot slides into place, and branches are re-measured after rows move. */
      await expect
        .poll(async () => {
          const [elbow, glyph] = await Promise.all([
            path.boundingBox(),
            row.locator('.fold-glyph').first().boundingBox(),
          ]);
          return elbow == null || glyph == null
            ? Infinity
            : Math.abs(elbow.y + elbow.height - (glyph.y + glyph.height / 2));
        })
        .toBeLessThan(2);
    };
    await failedCall.scrollIntoViewIfNeeded();
    await failedCall.hover();
    await expect(groupRail).toHaveAttribute('data-fold-lit');
    await expect(phaseRail).toHaveAttribute('data-fold-lit');
    await expect(litBranch(groupRail)).toHaveCount(1);
    await expect(litBranch(phaseRail)).toHaveCount(1);
    await endsAt(litBranch(groupRail), failedCall);
    await endsAt(litBranch(phaseRail), groupHeader);
    await shot(page, 'lit-path');

    await failedCall.evaluate((row) => {
      const { left, top, width, height } = row.getBoundingClientRect();
      const pointer = {
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 1,
        isPrimary: true,
        clientX: left + width / 2,
        clientY: top + height / 2,
      };
      row.dispatchEvent(new PointerEvent('pointermove', pointer));
      row.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
      row.dispatchEvent(new PointerEvent('pointerup', pointer));
    });
    /** A press keeps the path, hit-tested again under the pointer that did not move. */
    await expect(groupRail).toHaveAttribute('data-fold-lit');
    await expect(phaseRail).toHaveAttribute('data-fold-lit');
    await endsAt(litBranch(groupRail), failedCall);
    /** Rows moving under a still pointer relight from the new geometry. */
    await groupPanel.locator('> div > div').evaluate((rows) => {
      (rows as HTMLElement).style.paddingTop = '12px';
    });
    await expect(groupRail).toHaveAttribute('data-fold-lit');
    await endsAt(litBranch(groupRail), failedCall);
    await groupPanel.locator('> div > div').evaluate((rows) => {
      (rows as HTMLElement).style.removeProperty('padding-top');
    });
    await page.mouse.move(0, 0);
    await expect(groupRail).not.toHaveAttribute('data-fold-lit');
    await expect(phaseRail).not.toHaveAttribute('data-fold-lit');

    /** An earlier message can shift this fold without resizing it or scrolling. */
    const transcript = messagesView(page).getByTestId('screenshot-target');
    const previousAnchor = await transcript.evaluate((content) => {
      const spacer = document.createElement('div');
      spacer.id = 'fold-layout-predecessor';
      spacer.style.height = '0px';
      content.prepend(spacer);
      const scroll = content.closest<HTMLElement>('.scrollbar-gutter-stable')!;
      const anchor = scroll.style.overflowAnchor;
      scroll.style.overflowAnchor = 'none';
      return anchor;
    });
    await failedCall.scrollIntoViewIfNeeded();
    await failedCall.hover();
    await expect(groupRail).toHaveAttribute('data-fold-lit');
    const shift = await failedCall.evaluate((row) => {
      const fold = row.closest<HTMLElement>('[data-testid="activity-phase-card"]')!;
      const message = row.closest<HTMLElement>('.message-render')!;
      const scroll = row.closest<HTMLElement>('.scrollbar-gutter-stable')!;
      const measure = () => ({
        top: fold.getBoundingClientRect().top,
        foldHeight: fold.getBoundingClientRect().height,
        messageHeight: message.getBoundingClientRect().height,
        scrollTop: scroll.scrollTop,
      });
      const before = measure();
      document.getElementById('fold-layout-predecessor')!.style.height = '32px';
      return { before, after: measure() };
    });
    expect(shift.after.top - shift.before.top).toBeCloseTo(32);
    expect(shift.after.foldHeight).toBe(shift.before.foldHeight);
    expect(shift.after.messageHeight).toBe(shift.before.messageHeight);
    expect(shift.after.scrollTop).toBe(shift.before.scrollTop);
    /** 32px further down, the pointer is over the group's header: the path is hit-tested
     *  again and now ends in that header's branch of the phase. */
    await expect(groupRail).not.toHaveAttribute('data-fold-lit');
    await endsAt(litBranch(phaseRail), groupHeader);
    await transcript.evaluate((content, anchor) => {
      content.querySelector('#fold-layout-predecessor')!.remove();
      content.closest<HTMLElement>('.scrollbar-gutter-stable')!.style.overflowAnchor = anchor;
    }, previousAnchor);
    await expect(knobs).toHaveCount(0);
    await groupRail.hover();
    await expect(knobs).toHaveCount(1);
    await expect(groupHeader.getByTestId('fold-rail-knob')).toBeVisible();
    await expect.poll(() => lineColor(groupRail)).not.toBe(restingLine);
    await shot(page, 'group-rail-hover');
    await phaseRail.hover();
    await expect(knobs).toHaveCount(1);
    await expect(header.getByTestId('fold-rail-knob')).toBeVisible();
    await shot(page, 'phase-rail-hover');
    await groupRail.click();
    await expect(groupHeader).toHaveAttribute('aria-expanded', 'false');
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await phaseRail.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(knobs).toHaveCount(0);
    await shot(page, 'rail-collapsed');

    /** Survives a reload from the persisted message. */
    await page.reload();
    const reloaded = messagesView(page).getByRole('button', { name: PHASE_LABEL, exact: true });
    await expect(reloaded).toBeVisible({ timeout: 30000 });
    await expect(messagesView(page).getByTestId('failed-reveal-pill')).toBeVisible();
    await expect(messagesView(page).getByTestId('activity-phase-failed-peek')).toBeVisible();
    await shot(page, 'reloaded-collapsed');
    await messagesView(page).getByTestId('activity-phase-failed-peek').click();
    await expect(
      messagesView(page).locator('[data-tool-call-output-id]').filter({ hasText: /error/i }),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(400);
    await shot(page, 'reloaded-revealed-dark');
    await page.emulateMedia({ colorScheme: 'light' });

    expect(problems.filter((line) => !line.includes('favicon'))).toEqual([]);
  });

  test('a phase without failures shows neither pill nor peek', async ({ page, request }) => {
    test.setTimeout(120000);
    const problems = collectPageProblems(page);
    const label = uniqueLabel();
    const finalText = `E2E activity phase reply done ${label}`;
    await setPhaseLabel(request);

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, PHASE_ENDPOINT);
    await selectEphemeralMCP(page);
    const run = await sendMessage(page, `E2E_ACTIVITY_PHASE_REPLY:${label}`);
    expect(run.ok()).toBeTruthy();
    await expect(messagesView(page).getByText(finalText)).toBeVisible({ timeout: 60000 });
    const header = messagesView(page).getByRole('button', { name: PHASE_LABEL, exact: true });
    await expect(header).toBeVisible({ timeout: 30000 });
    await expect(messagesView(page).getByTestId('failed-reveal-pill')).toHaveCount(0);
    await expect(messagesView(page).getByTestId('activity-phase-failed-peek')).toHaveCount(0);
    await shot(page, 'clean-collapsed');
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await shot(page, 'clean-open');
    /** Groups inside a settled phase start collapsed; the phase summary speaks for them. */
    const group = messagesView(page).getByTestId('tool-call-group-panel').first();
    const groupHeader = group.locator('xpath=preceding-sibling::div[1]//button').first();
    await groupHeader.click();
    await expect(messagesView(page).locator('[data-testid="tool-call"]').first()).toBeVisible();
    await shot(page, 'clean-open-group');

    const phaseRail = messagesView(page)
      .getByTestId('activity-phase-panel')
      .locator('> div > [data-testid="fold-rail"]');
    const groupRail = group.locator('> div > [data-testid="fold-rail"]');
    const phaseLabel = header.getByText(PHASE_LABEL, { exact: true });
    const beforeHover = await phaseLabel.boundingBox();
    await phaseRail.hover();
    await expect(header.getByTestId('fold-rail-knob')).toBeVisible();
    expect(await phaseLabel.boundingBox()).toEqual(beforeHover);

    const groupLabel = groupHeader.locator('[role="status"]');
    const beforeGroupHover = await groupLabel.boundingBox();
    await groupRail.hover();
    await expect(groupHeader.getByTestId('fold-rail-knob')).toBeVisible();
    expect(await groupLabel.boundingBox()).toEqual(beforeGroupHover);

    /** Keep room below the historical fold so collapse cannot clamp away an overlap. */
    const phaseCard = messagesView(page).getByTestId('activity-phase-card');
    await phaseCard.evaluate((card) => {
      const spacer = document.createElement('div');
      spacer.style.height = '1200px';
      card.after(spacer);
    });
    await group.locator('> div > div').evaluate((rows) => {
      (rows as HTMLElement).style.paddingBottom = '1200px';
    });
    await groupRail.click({ position: { x: 12, y: 900 } });
    await expect(groupHeader).toHaveAttribute('aria-expanded', 'false');
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(async () => {
        const phaseBox = await header.boundingBox();
        const groupBox = await groupHeader.boundingBox();
        return phaseBox != null && groupBox != null && groupBox.y >= phaseBox.y + phaseBox.height;
      })
      .toBe(true);
    const isPointerAccessible = (button: typeof header) =>
      button.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.left + 12, box.top + box.height / 2));
      });
    await expect(groupHeader).toBeInViewport();
    await expect.poll(() => isPointerAccessible(groupHeader)).toBe(true);
    await shot(page, 'nested-rail-revealed');

    await phaseRail.locator('..').evaluate((rows) => {
      (rows as HTMLElement).style.paddingBottom = '1200px';
    });
    await phaseRail.click({ position: { x: 12, y: 900 } });
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(header).toBeInViewport();
    await expect.poll(() => isPointerAccessible(header)).toBe(true);
    await shot(page, 'phase-rail-revealed');
    expect(problems.filter((line) => !line.includes('favicon'))).toEqual([]);
  });
});
