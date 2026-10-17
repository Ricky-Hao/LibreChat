import { useCallback, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { Button, disclosureChevronVariants } from '@librechat/client';
import { isReportableRunStepDuration } from 'librechat-data-provider';
import type { ToolCallPhase } from '~/utils/toolCallPhase';
import { cn, getRunStepDurationLabels } from '~/utils';
import { useToolPreparation } from './preparation';
import CancelledIcon from './CancelledIcon';
import { useFailedReveal } from './reveal';
import { ElapsedTimer } from '../Elapsed';
import { ROW_GLYPH_SLOT } from './rows';
import { useLocalize } from '~/hooks';

const wrapperClass =
  'progress-text-wrapper text-text-secondary relative -mt-[0.046875rem] min-h-5 min-w-0 w-full leading-5';

/** Stay in flow so wrapped intents and metadata also size the caller's row.
 *  Overflow remains visible for the disclosure's focus ring. */
const contentClass = 'progress-text-content max-w-full overflow-visible';

/** A failed row is marked at its left edge, in the rail's column when the row
 *  sits under a header and in the gutter when it stands alone, so a failure
 *  is findable by shape before its text is read. A pseudo-element rather than
 *  a border keeps the glyph and label aligned with the other rows. It lies over
 *  the rail's hit area, so it lets the pointer through to the rail. */
const failedStripeClass =
  "before:pointer-events-none before:absolute before:-left-3 before:top-0 before:h-full before:w-0.5 before:rounded-full before:bg-status-error before:content-['']";

const Wrapper = ({
  popover,
  failed,
  rootRef,
  children,
}: {
  popover: boolean;
  failed: boolean;
  rootRef: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
}) => {
  if (popover) {
    return (
      <div className={cn(wrapperClass, failed && failedStripeClass)} ref={rootRef}>
        <Popover.Trigger asChild>
          <div className={contentClass} style={{ opacity: 1, transform: 'none' }}>
            {children}
          </div>
        </Popover.Trigger>
      </div>
    );
  }

  return (
    <div className={cn(wrapperClass, failed && failedStripeClass)} ref={rootRef}>
      <div className={contentClass} style={{ opacity: 1, transform: 'none' }}>
        {children}
      </div>
    </div>
  );
};

export default function ProgressText({
  phase,
  onClick,
  inProgressText,
  finishedText,
  authText,
  icon: iconProp,
  subtitle,
  durationMs,
  toolPreparationDurationMs,
  toolExecutionDurationMs,
  phaseStartAt,
  hasInput = true,
  popover = false,
  isExpanded = false,
  verdict,
}: {
  /**
   * The card's settled state, resolved once by the caller via
   * `resolveToolCallPhase`. Replaces the former `error`+ `errorSuffix`
   * pair, which encoded three terminal states in two booleans — `error`
   * meant cancelled, a present `errorSuffix` meant failed, and every
   * consumer had to reconstruct the distinction. That shape is what let a
   * duration render beside "failed" and a live region announce "completed"
   * over a visibly failed card.
   */
  phase: ToolCallPhase;
  onClick?: () => void;
  inProgressText: string;
  finishedText: string;
  authText?: string;
  icon?: React.ReactNode;
  subtitle?: string;
  /** Total run-step lifetime, not necessarily tool execution. */
  durationMs?: number;
  toolPreparationDurationMs?: number;
  toolExecutionDurationMs?: number;
  phaseStartAt?: number;
  hasInput?: boolean;
  popover?: boolean;
  isExpanded?: boolean;
  /** Why a failed card failed ("exit code 2"), shown after the failure
   *  suffix. Plain text inside the button, so it is part of its name. */
  verdict?: string;
}) {
  const localize = useLocalize();
  /** For locale-aware decimal formatting of the sub-10s duration value. */
  const { i18n } = useTranslation();
  const preparationText = useToolPreparation();
  const isRunning = phase === 'running';
  /** A server-authored phase stamp is an identity, not a browser clock origin.
   * On reconnect we can only time from local receipt, never infer cross-host skew. */
  const phaseTimer = useRef<{ stamp?: number; receivedAt: number } | null>(null);
  if (!isRunning || phaseStartAt == null) {
    phaseTimer.current = null;
  } else if (phaseTimer.current?.stamp !== phaseStartAt) {
    phaseTimer.current = { stamp: phaseStartAt, receivedAt: Date.now() };
  }
  const localPhaseStart = phaseTimer.current?.receivedAt;
  const rootRef = useRef<HTMLDivElement>(null);
  /** A header above asked for its failures. This control is the disclosure
   *  every card renders, so answering here reaches a failed bash, code,
   *  memory or file card the same as a generic one: open through the card's
   *  own toggle, and, for the one row the request lets take focus, land the
   *  reader on the labeled button rather than on a wrapper. */
  const revealFailure = useCallback(
    (claimFocus: () => boolean) => {
      if (!isExpanded) {
        onClick?.();
      }
      if (!claimFocus()) {
        return;
      }
      const button = rootRef.current?.querySelector('button');
      if (button == null) {
        return;
      }
      if (typeof button.scrollIntoView === 'function') {
        button.scrollIntoView({ block: 'nearest' });
      }
      button.focus({ preventScroll: true });
    },
    [isExpanded, onClick],
  );
  useFailedReveal(phase === 'failed' && hasInput, revealFailure);

  /** Every branch below reads `phase`, so the label, the icon, the shimmer,
   *  the failure suffix and the duration cannot disagree about what state
   *  the card is in. */
  const text = isRunning ? (authText ?? preparationText ?? inProgressText) : finishedText;
  const icon = phase === 'cancelled' ? <CancelledIcon /> : (iconProp ?? null);
  const showShimmer = isRunning;
  const errorSuffix = phase === 'failed' ? localize('com_ui_tool_failed') : undefined;
  /**
   * Shown only on a settled, successful card. While the step is still running
   * the number would be stale the instant it rendered, and on a cancelled or
   * failed card "how long it took" is not the fact the reader needs — that
   * slot already carries the cancelled icon or the failure suffix.
   */
  const measured = toolPreparationDurationMs != null || toolExecutionDurationMs != null;
  /** The formatter rounds to tenths below ten seconds. Shorter than 50 ms reads as 0.0s. */
  const showToolCallTime =
    toolExecutionDurationMs != null &&
    Number.isFinite(toolExecutionDurationMs) &&
    toolExecutionDurationMs >= 50;
  const durationParts =
    phase !== 'completed'
      ? []
      : [
          ...(isReportableRunStepDuration(toolPreparationDurationMs)
            ? [
                {
                  label: localize('com_ui_tool_preparation_time'),
                  duration: getRunStepDurationLabels(toolPreparationDurationMs, i18n.language),
                },
              ]
            : []),
          ...(showToolCallTime
            ? [
                {
                  label: localize('com_ui_tool_call_time'),
                  duration: getRunStepDurationLabels(toolExecutionDurationMs, i18n.language),
                },
              ]
            : []),
          ...(!measured && isReportableRunStepDuration(durationMs)
            ? [
                {
                  label: localize('com_ui_tool_total_time'),
                  duration: getRunStepDurationLabels(durationMs, i18n.language),
                },
              ]
            : []),
        ];
  const showTimer = isRunning && phaseStartAt != null && localPhaseStart != null;
  const hasMetadata = subtitle || errorSuffix || showTimer || durationParts.length > 0;

  return (
    <Wrapper popover={popover} failed={phase === 'failed'} rootRef={rootRef}>
      <Button
        type="button"
        variant="disclosure"
        className="group/disclosure items-start text-left whitespace-normal"
        disabled={!hasInput}
        tabIndex={hasInput ? 0 : -1}
        onClick={hasInput ? onClick : undefined}
        aria-expanded={hasInput ? isExpanded : undefined}
      >
        {icon != null && (
          <span className={ROW_GLYPH_SLOT} aria-hidden="true">
            {icon}
          </span>
        )}
        {/* Phones give the intent its own full-width line. Larger layouts
            stay inline when they fit, but can wrap inside nested panels too. */}
        <span className="flex min-w-0 flex-1 flex-col gap-x-2 gap-y-1 sm:flex-initial sm:flex-row sm:flex-wrap sm:items-baseline">
          <span
            className={cn(
              showShimmer ? 'shimmer' : '',
              'max-w-full min-w-0 font-medium [overflow-wrap:anywhere]',
            )}
          >
            {text}
          </span>
          {hasMetadata && (
            <span className="text-text-secondary flex max-w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 font-normal [overflow-wrap:anywhere]">
              {subtitle && <span>{subtitle}</span>}
              {errorSuffix && <span className="text-status-error">· {errorSuffix}</span>}
              {errorSuffix && verdict && <span>· {verdict}</span>}
              {showTimer && <ElapsedTimer start={localPhaseStart} />}
              {durationParts.map(({ label, duration }) => (
                <span key={label}>
                  <span aria-hidden="true">
                    · {label} {localize(duration.key, duration.values)}
                  </span>
                  <span className="sr-only">
                    {label} {localize(duration.announcedKey, duration.announcedValues)}
                  </span>
                </span>
              ))}
            </span>
          )}
        </span>
        {hasInput && (
          <ChevronDown
            className={cn(
              disclosureChevronVariants({ expanded: isExpanded }),
              'size-4 shrink-0 translate-y-[0.0625rem]',
            )}
            aria-hidden="true"
          />
        )}
      </Button>
    </Wrapper>
  );
}
